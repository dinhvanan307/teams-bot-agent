import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request, type Server } from 'node:http';
import type { IMessageActivity } from '@microsoft/teams.api';
import { getAiConfig, type AiConfig, type AiProvider } from '../src/ai/config.js';
import { AiError, createAiClient } from '../src/ai/client.js';
import { createAiService } from '../src/ai/service.js';
import { createMessageHandler } from '../src/bot.js';
import { createPreviewServer } from '../src/preview-server.js';

const fakeKey = 'fake-key-for-tests-only';
const configFor = (provider: AiProvider = 'openai-compatible', extra: NodeJS.ProcessEnv = {}) => getAiConfig({
  AI_ENABLED: 'true', AI_PROVIDER: provider, AI_MODEL: 'test-model', AI_API_KEY: fakeKey,
  AI_BASE_URL: 'https://gateway.example.invalid/company/ai/v1/', ...extra,
})!;
const fixtures = {
  openai: { output: [{ type: 'reasoning', summary: [] }, { type: 'message', content: [{ type: 'output_text', text: 'Xin chào từ AI' }] }], usage: { input_tokens: 10, output_tokens: 5 } },
  'openai-compatible': { choices: [{ message: { content: 'Xin chào từ AI' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } },
  gemini: { candidates: [{ content: { parts: [{ thought: true, text: 'private thought' }, { text: 'Xin chào từ AI' }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } },
  anthropic: { content: [{ type: 'thinking', thinking: 'private thought' }, { type: 'text', text: 'Xin chào từ AI' }], usage: { input_tokens: 10, output_tokens: 5 } },
};
const providers = Object.keys(fixtures) as AiProvider[];
const paths: Record<AiProvider, string> = { openai: '/responses', 'openai-compatible': '/chat/completions', gemini: '/models/test-model:generateContent', anthropic: '/messages' };

test('AI config: disabled needs no key; enabled requires explicit provider/model/key and a safe base URL', () => {
  assert.equal(getAiConfig({}), undefined);
  for (const field of ['AI_PROVIDER', 'AI_MODEL', 'AI_API_KEY', 'AI_BASE_URL']) {
    assert.throws(() => configFor('openai-compatible', { [field]: '' }), new RegExp(field));
  }
  assert.equal(configFor().baseUrl, 'https://gateway.example.invalid/company/ai/v1');
  assert.equal(configFor('openai', { AI_BASE_URL: '' }).baseUrl, 'https://api.openai.com/v1');
  assert.equal(configFor('gemini', { AI_BASE_URL: '' }).baseUrl, 'https://generativelanguage.googleapis.com/v1beta');
  assert.equal(configFor('anthropic', { AI_BASE_URL: '' }).baseUrl, 'https://api.anthropic.com/v1');
  assert.equal(configFor('openai-compatible', { AI_BASE_URL: 'http://127.0.0.1:1234/v1' }).baseUrl, 'http://127.0.0.1:1234/v1');
  for (const url of ['http://example.invalid/v1', `https://user:${fakeKey}@example.invalid`, `https://example.invalid?key=${fakeKey}`, 'file:///tmp/api']) {
    assert.throws(() => configFor('openai-compatible', { AI_BASE_URL: url }), error => {
      assert.ok(error instanceof Error); assert.ok(!error.message.includes(fakeKey)); return /AI_BASE_URL/.test(error.message);
    });
  }
  for (const name of ['AI_TIMEOUT_MS', 'AI_MAX_OUTPUT_TOKENS', 'AI_DAILY_REQUEST_LIMIT', 'AI_MAX_CONCURRENT', 'AI_MAX_INPUT_CHARS', 'AI_USER_REQUESTS_PER_MINUTE']) {
    assert.throws(() => configFor('gemini', { [name]: '0' }), new RegExp(name));
  }
  assert.throws(() => configFor('openai', { AI_MAX_OUTPUT_TOKENS: '1' }), /AI_MAX_OUTPUT_TOKENS/);
  assert.throws(() => configFor('openai-compatible', { AI_CHAT_TOKEN_PARAMETER: 'wrong' }), /AI_CHAT_TOKEN_PARAMETER/);
});

for (const provider of providers) test(`AI adapter ${provider}: protocol, auth, token cap, usage, no hidden reasoning`, async () => {
  const config = configFor(provider, { AI_ANTHROPIC_WORKSPACE_ID: 'wrkspc_test' });
  const client = createAiClient(config, async (url, init) => {
    assert.equal(String(url), config.baseUrl + paths[provider]);
    assert.ok(!String(url).includes(fakeKey));
    assert.equal(init?.method, 'POST'); assert.equal(init?.redirect, 'error');
    const body = JSON.parse(init?.body as string), headers = new Headers(init?.headers);
    if (provider === 'gemini') {
      assert.equal(headers.get('x-goog-api-key'), fakeKey);
      assert.equal(body.systemInstruction.parts[0].text, config.systemPrompt);
      assert.equal(body.contents[0].parts[0].text, 'Câu hỏi tiếng Việt 👋');
      assert.equal(body.generationConfig.maxOutputTokens, config.maxOutputTokens);
    } else if (provider === 'anthropic') {
      assert.equal(headers.get('x-api-key'), fakeKey);
      assert.equal(headers.get('anthropic-version'), config.anthropicVersion);
      assert.equal(headers.get('anthropic-workspace-id'), 'wrkspc_test');
      assert.equal(body.system, config.systemPrompt);
      assert.equal(body.max_tokens, config.maxOutputTokens);
    } else {
      assert.equal(headers.get('authorization'), `Bearer ${fakeKey}`);
      if (provider === 'openai') {
        assert.equal(body.store, false); assert.equal(body.instructions, config.systemPrompt);
        assert.equal(body.max_output_tokens, config.maxOutputTokens);
      } else {
        assert.equal(body.messages[0].role, 'system');
        assert.equal(body.messages[1].content, 'Câu hỏi tiếng Việt 👋');
        assert.equal(body.max_tokens, config.maxOutputTokens);
      }
    }
    return Response.json(fixtures[provider]);
  });
  assert.deepEqual(await client.generate('Câu hỏi tiếng Việt 👋'), { text: 'Xin chào từ AI', inputTokens: 10, outputTokens: 5 });
});

test('Chat Completions can select max_completion_tokens without sending both limits', async () => {
  const config = configFor('openai-compatible', { AI_CHAT_TOKEN_PARAMETER: 'max_completion_tokens' });
  await createAiClient(config, async (_url, init) => {
    const body = JSON.parse(init!.body as string);
    assert.equal(body.max_completion_tokens, 1024); assert.ok(!('max_tokens' in body));
    return Response.json(fixtures['openai-compatible']);
  }).generate('test');
});

test('API errors are classified without leaking raw responses or automatically retrying', async () => {
  for (const [status, code] of [[401, 'auth'], [403, 'auth'], [429, 'rate_limit'], [400, 'configuration'], [404, 'configuration'], [500, 'unavailable']] as const) {
    let calls = 0;
    const client = createAiClient(configFor(), async () => { calls++; return new Response(`secret: ${fakeKey}`, { status }); });
    await assert.rejects(() => client.generate('confidential question'), error => {
      assert.ok(error instanceof AiError); assert.equal(error.code, code); assert.ok(!String(error).includes(fakeKey)); return true;
    });
    assert.equal(calls, 1);
  }
  await assert.rejects(() => createAiClient(configFor(), async () => new Response('not-json')).generate('test'), /unavailable/);
  await assert.rejects(() => createAiClient(configFor(), async () => Response.json({ choices: [] })).generate('test'), /empty/);
  await assert.rejects(() => createAiClient(configFor(), async () => new Response('x'.repeat(1024 * 1024 + 1))).generate('test'), /unavailable/);
});

test('API timeout aborts the request and returns a sanitized error', async () => {
  const client = createAiClient(configFor('gemini', { AI_TIMEOUT_MS: '10' }), async (_url, init) => new Promise((_resolve, reject) => {
    init!.signal!.addEventListener('abort', () => reject(new Error(`network details ${fakeKey}`)), { once: true });
  }));
  await assert.rejects(() => client.generate('test'), /AI: timeout/);
});

test('AI service rejects long inputs, limits users and daily requests, and resets by UTC day', async () => {
  let time = Date.UTC(2026, 9, 22), calls = 0;
  const logs: unknown[] = [];
  const config = configFor('gemini', { AI_MAX_INPUT_CHARS: '20', AI_USER_REQUESTS_PER_MINUTE: '1', AI_DAILY_REQUEST_LIMIT: '2' });
  const ai = createAiService(config, { now: () => time, log: event => logs.push(event), client: {
    async generate() { calls++; return { text: 'answer', inputTokens: 10, outputTokens: 5 }; },
  } });
  assert.match(await ai.answer('x'.repeat(21), 'u'), /quá dài/); assert.equal(calls, 0);
  assert.equal(await ai.answer('private question', 'u'), 'answer');
  assert.match(await ai.answer('test', 'u'), /quá nhanh/);
  assert.equal(await ai.answer('test', 'v'), 'answer');
  assert.match(await ai.answer('test', 'w'), /trong ngày/); assert.equal(calls, 2);
  time += 24 * 3600000;
  assert.equal(await ai.answer('test', 'u'), 'answer'); assert.equal(calls, 3);
  assert.ok(!JSON.stringify(logs).includes('private question')); assert.ok(!JSON.stringify(logs).includes(fakeKey));
});

test('concurrency is reserved before awaiting; errors release slots but still consume allowance', async () => {
  let release!: () => void, calls = 0;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const config = configFor('openai', { AI_MAX_CONCURRENT: '1', AI_DAILY_REQUEST_LIMIT: '2' });
  const ai = createAiService(config, { log() {}, client: { async generate() { calls++; await blocked; throw new AiError('auth'); } } });
  const first = ai.answer('test', 'u');
  assert.match(await ai.answer('test', 'v'), /nhiều câu hỏi/); assert.equal(calls, 1);
  release(); assert.match(await first, /xác thực AI/);
  assert.match(await ai.answer('test', 'v'), /xác thực AI/); assert.equal(calls, 2);
  assert.match(await ai.answer('test', 'w'), /trong ngày/);
});

test('Teams handler keeps commands local, requires mention, strips it and scopes quota by tenant/user', async () => {
  const calls: [string, string][] = [], replies: string[] = [];
  const handle = createMessageHandler({ async answer(text, key) { calls.push([text, key]); return 'AI answer'; } });
  const activity = (text: string, type = 'personal', mention = false, id = 'conversation-a') => ({
    type: 'message', id: 'message', channelId: 'msteams', serviceUrl: 'http://localhost',
    from: { id: 'user-a' }, recipient: { id: 'bot' }, conversation: { id, conversationType: type },
    channelData: { tenant: { id: 'tenant-a' } }, text: mention ? `<at>Bot</at> ${text}` : text,
    entities: mention ? [{ type: 'mention', mentioned: { id: 'bot', name: 'Bot' }, text: '<at>Bot</at>' }] : [],
  }) as IMessageActivity;
  const send = async (text: string) => { replies.push(text); };
  for (const command of ['ping', 'help', 'count', 'reset']) await handle(activity(command), send);
  assert.equal(calls.length, 0); assert.match(replies[1], /AI đang bật/);
  await handle(activity('hỏi', 'channel'), send); assert.equal(calls.length, 0);
  await handle(activity('hỏi', 'channel', true), send);
  await handle(activity('hỏi tiếp', 'personal', false, 'conversation-b'), send);
  assert.equal(calls[0][0], 'hỏi'); assert.equal(calls[0][1], calls[1][1]);
  assert.equal(replies.at(-1), 'AI answer');
});

async function listen(server: Server) {
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

for (const provider of providers) test(`preview HTTP → handler → mock ${provider} HTTP → reply`, async () => {
  let calls = 0;
  const upstream = createServer(async (req, res) => {
    calls++;
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    assert.equal(req.url, '/gateway/v1' + paths[provider]);
    assert.ok(JSON.stringify(body).includes('tiếng Việt 👋'));
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(fixtures[provider]));
  });
  const upstreamUrl = await listen(upstream);
  const config = configFor(provider, { AI_BASE_URL: `${upstreamUrl}/gateway/v1` });
  const preview = createPreviewServer(config, createAiService(config, { log() {} }));
  try {
    const base = await listen(preview);
    const html = await (await fetch(base)).text();
    assert.match(html, /AI đang bật/); assert.ok(!html.includes(fakeKey)); assert.ok(!html.includes('__AI_NOTICE__'));
    const token = /const token='([^']+)'/.exec(html)![1];
    assert.equal((await fetch(`${base}/api/preview`, { method: 'POST' })).status, 403);
    const raw = Buffer.from(JSON.stringify({ text: 'tiếng Việt 👋', conversationId: 'test-conversation' }));
    const split = raw.indexOf(Buffer.from('ế')) + 1;
    const response = await new Promise<string>((resolve, reject) => {
      const req = request(`${base}/api/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Preview-Token': token } }, res => {
        let body = ''; res.setEncoding('utf8'); res.on('data', chunk => { body += chunk; }); res.on('end', () => resolve(body));
      });
      req.on('error', reject); req.write(raw.subarray(0, split)); setImmediate(() => req.end(raw.subarray(split)));
    });
    assert.deepEqual(JSON.parse(response), { replies: ['Xin chào từ AI'] }); assert.equal(calls, 1);
  } finally { await close(preview); await close(upstream); }
});
