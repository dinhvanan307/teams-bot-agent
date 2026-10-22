import type { AiConfig } from './config.js';

type ErrorCode = 'timeout' | 'auth' | 'rate_limit' | 'configuration' | 'empty' | 'unavailable';
export class AiError extends Error {
  constructor(public readonly code: ErrorCode) { super(`AI: ${code}`); }
}
export interface AiResult { text: string; inputTokens?: number; outputTokens?: number }
export interface AiClient { generate(text: string): Promise<AiResult> }

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const tokenCount = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
function textBlocks(value: unknown, type: string) {
  return array(value).map(object).filter(part => part.type === type && typeof part.text === 'string').map(part => part.text).join('\n');
}

function requestFor(config: AiConfig, text: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  let path: string, body: Record<string, unknown>;
  switch (config.provider) {
    case 'openai':
      path = '/responses';
      headers.Authorization = `Bearer ${config.apiKey}`;
      body = { model: config.model, instructions: config.systemPrompt, input: text,
        max_output_tokens: config.maxOutputTokens, store: false, stream: false };
      break;
    case 'openai-compatible':
      path = '/chat/completions';
      headers.Authorization = `Bearer ${config.apiKey}`;
      body = { model: config.model, messages: [
        { role: 'system', content: config.systemPrompt }, { role: 'user', content: text },
      ], [config.chatTokenParameter]: config.maxOutputTokens, stream: false };
      break;
    case 'gemini':
      path = `/models/${encodeURIComponent(config.model.replace(/^models\//, ''))}:generateContent`;
      headers['x-goog-api-key'] = config.apiKey;
      body = { systemInstruction: { parts: [{ text: config.systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text }] }],
        generationConfig: { maxOutputTokens: config.maxOutputTokens, candidateCount: 1 } };
      break;
    case 'anthropic':
      path = '/messages';
      headers['x-api-key'] = config.apiKey;
      headers['anthropic-version'] = config.anthropicVersion;
      if (config.anthropicWorkspaceId) headers['anthropic-workspace-id'] = config.anthropicWorkspaceId;
      body = { model: config.model, system: config.systemPrompt, messages: [{ role: 'user', content: text }],
        max_tokens: config.maxOutputTokens, stream: false };
      break;
  }
  return { url: `${config.baseUrl}${path}`, headers, body };
}

function decode(config: AiConfig, data: unknown): AiResult {
  const value = object(data);
  if (value.error || value.status === 'failed') throw new AiError('unavailable');
  let text = '', input: unknown, output: unknown;
  const usage = object(value.usage);
  switch (config.provider) {
    case 'openai':
      text = array(value.output).map(object).filter(item => item.type === 'message')
        .map(item => textBlocks(item.content, 'output_text')).join('\n');
      input = usage.input_tokens; output = usage.output_tokens;
      break;
    case 'openai-compatible': {
      const message = object(object(array(value.choices)[0]).message);
      text = typeof message.content === 'string' ? message.content : textBlocks(message.content, 'text');
      input = usage.prompt_tokens; output = usage.completion_tokens;
      break;
    }
    case 'gemini': {
      const content = object(object(array(value.candidates)[0]).content);
      text = array(content.parts).map(object).filter(part => part.thought !== true && typeof part.text === 'string')
        .map(part => part.text).join('\n');
      const metadata = object(value.usageMetadata);
      input = metadata.promptTokenCount;
      // Keep the provider's candidate token count; this is not a billing estimate.
      output = metadata.candidatesTokenCount;
      break;
    }
    case 'anthropic':
      text = textBlocks(value.content, 'text');
      input = usage.input_tokens; output = usage.output_tokens;
      break;
  }
  if (!text.trim()) throw new AiError('empty');
  return { text: text.trim(), inputTokens: tokenCount(input), outputTokens: tokenCount(output) };
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.body) throw new AiError('empty');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024 * 1024) { await reader.cancel(); throw new AiError('unavailable'); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { reader.releaseLock(); }
}

export function createAiClient(config: AiConfig, fetcher: typeof fetch = fetch): AiClient {
  return { async generate(text) {
    const request = requestFor(config, text);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetcher(request.url, {
        method: 'POST', headers: request.headers, body: JSON.stringify(request.body),
        signal: controller.signal, redirect: 'error',
      });
      if (!response.ok) {
        await response.body?.cancel();
        if ([401, 403].includes(response.status)) throw new AiError('auth');
        if (response.status === 429) throw new AiError('rate_limit');
        if ([400, 404, 422].includes(response.status)) throw new AiError('configuration');
        throw new AiError('unavailable');
      }
      return decode(config, await readJson(response));
    } catch (error) {
      if (controller.signal.aborted) throw new AiError('timeout');
      if (error instanceof AiError) throw error;
      // Provider bodies, URLs, raw exceptions and credentials must not reach chat/logs.
      throw new AiError('unavailable');
    } finally { clearTimeout(timer); }
  } };
}
