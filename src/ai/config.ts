import { DEFAULT_SYSTEM_PROMPT } from './prompt.js';

export type AiProvider = 'openai' | 'openai-compatible' | 'gemini' | 'anthropic';
export interface AiConfig {
  provider: AiProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  timeoutMs: number;
  maxOutputTokens: number;
  maxInputChars: number;
  dailyRequestLimit: number;
  userRequestsPerMinute: number;
  maxConcurrent: number;
  chatTokenParameter: 'max_tokens' | 'max_completion_tokens';
  anthropicVersion: string;
  anthropicWorkspaceId?: string;
}

function invalid(field: string, reason: string): never {
  // Never include configuration values: they may contain credentials.
  throw new Error(`Cấu hình AI: ${field} ${reason}.`);
}

export function getAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig | undefined {
  const enabled = env.AI_ENABLED?.trim().toLowerCase() || 'false';
  if (!['true', 'false'].includes(enabled)) invalid('AI_ENABLED', 'phải là true hoặc false');
  if (enabled === 'false') return undefined;

  const provider = env.AI_PROVIDER?.trim() as AiProvider;
  if (!['openai', 'openai-compatible', 'gemini', 'anthropic'].includes(provider)) {
    invalid('AI_PROVIDER', 'phải là openai, openai-compatible, gemini hoặc anthropic');
  }
  const apiKey = env.AI_API_KEY?.trim();
  const model = env.AI_MODEL?.trim();
  if (!apiKey || /[\r\n]/.test(apiKey)) invalid('AI_API_KEY', 'bị thiếu hoặc không hợp lệ');
  if (!model || model.length > 200 || /[\r\n]/.test(model)) invalid('AI_MODEL', 'bị thiếu hoặc không hợp lệ');

  const defaults: Partial<Record<AiProvider, string>> = {
    openai: 'https://api.openai.com/v1',
    gemini: 'https://generativelanguage.googleapis.com/v1beta',
    anthropic: 'https://api.anthropic.com/v1',
  };
  let url: URL;
  try { url = new URL(env.AI_BASE_URL?.trim() || defaults[provider] || ''); }
  catch { invalid('AI_BASE_URL', 'phải là URL API đầy đủ, gồm tiền tố phiên bản nếu có'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash) {
    invalid('AI_BASE_URL', 'phải dùng HTTPS (HTTP chỉ cho localhost), không chứa key, query hoặc fragment');
  }
  const integer = (name: string, fallback: number, max: number) => {
    const value = Number(env[name] ?? fallback);
    if (!Number.isSafeInteger(value) || value < 1 || value > max) invalid(name, `phải là số nguyên từ 1 đến ${max}`);
    return value;
  };
  const chatTokenParameter = env.AI_CHAT_TOKEN_PARAMETER?.trim() || 'max_tokens';
  if (chatTokenParameter !== 'max_tokens' && chatTokenParameter !== 'max_completion_tokens') {
    invalid('AI_CHAT_TOKEN_PARAMETER', 'phải là max_tokens hoặc max_completion_tokens');
  }
  const systemPrompt = env.AI_SYSTEM_PROMPT?.trim() || DEFAULT_SYSTEM_PROMPT;
  if (systemPrompt.length > 8000) invalid('AI_SYSTEM_PROMPT', 'không được quá 8000 ký tự');
  const anthropicVersion = env.AI_ANTHROPIC_VERSION?.trim() || '2026-10-21';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anthropicVersion)) invalid('AI_ANTHROPIC_VERSION', 'phải có dạng YYYY-MM-DD');
  const anthropicWorkspaceId = env.AI_ANTHROPIC_WORKSPACE_ID?.trim() || undefined;
  if (anthropicWorkspaceId && !/^[\w-]{1,200}$/.test(anthropicWorkspaceId)) invalid('AI_ANTHROPIC_WORKSPACE_ID', 'không hợp lệ');
  const maxOutputTokens = integer('AI_MAX_OUTPUT_TOKENS', 1024, 32768);
  if (provider === 'openai' && maxOutputTokens < 16) invalid('AI_MAX_OUTPUT_TOKENS', 'phải từ 16 trở lên với OpenAI Responses');

  return {
    provider, apiKey, model, baseUrl: url.href.replace(/\/+$/, ''), systemPrompt,
    timeoutMs: integer('AI_TIMEOUT_MS', 20000, 120000),
    maxOutputTokens,
    maxInputChars: integer('AI_MAX_INPUT_CHARS', 4000, 20000),
    dailyRequestLimit: integer('AI_DAILY_REQUEST_LIMIT', 100, 1000000),
    userRequestsPerMinute: integer('AI_USER_REQUESTS_PER_MINUTE', 5, 1000),
    maxConcurrent: integer('AI_MAX_CONCURRENT', 3, 100),
    chatTokenParameter, anthropicVersion, anthropicWorkspaceId,
  };
}
