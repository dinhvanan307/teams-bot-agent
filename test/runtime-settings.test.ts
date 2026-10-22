import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, request, type Server } from 'node:http';
import { createAiRuntime, SettingsError } from '../src/ai/runtime-settings.js';
import { AiError } from '../src/ai/client.js';
import { createPreviewServer } from '../src/preview-server.js';
import { createApplication } from '../src/app.js';
import { createMessageHandler } from '../src/bot.js';
import type { IMessageActivity } from '@microsoft/teams.api';

const key = 'fake-provider-key-only-for-tests';
const draft = (extra = {}) => ({ provider: 'openai-compatible', baseUrl: 'https://example.invalid/team/ai/v1', model: 'test-model', apiKey: key, ...extra });
function fixture(t: { after: (fn: () => void) => void }) {
  const directory = mkdtempSync(join(tmpdir(), 'teams-ai-settings-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
async function listen(server: Server) {
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }

test('encrypted settings persist across processes, mask keys, protect file modes and fail closed on corruption or missing key', t => {
  const directory = fixture(t);
  const runtime = createAiRuntime({ directory, env: {} });
  assert.equal(runtime.view().enabled, false);
  const saved = runtime.save(draft(), runtime.view().revision);
  assert.equal(saved.enabled, true); assert.equal(saved.source, 'saved');
  assert.equal('apiKey' in saved, false); assert.ok(!JSON.stringify(saved).includes(key));
  assert.equal(readFileSync(join(directory, 'ai-settings.enc')).includes(Buffer.from(key)), false);
  assert.equal(statSync(join(directory, 'ai-settings.enc')).mode & 0o777, 0o600);
  assert.equal(statSync(join(directory, 'ai-settings.key')).mode & 0o777, 0o600);
  const restart = createAiRuntime({ directory, env: {} });
  assert.equal(restart.currentConfig()?.apiKey, key);
  assert.equal(restart.view().revision, saved.revision);
  const file = readFileSync(join(directory, 'ai-settings.enc'));
  file[file.length - 1] ^= 1; writeFileSync(join(directory, 'ai-settings.enc'), file);
  assert.throws(() => restart.currentConfig(), SettingsError);
  unlinkSync(join(directory, 'ai-settings.key'));
  assert.throws(() => restart.save(draft(), saved.revision), SettingsError);
});

test('saved profile overrides env as a whole; clear disables AI rather than reactivating env credentials', t => {
  const directory = fixture(t);
  const env = { AI_ENABLED: 'true', AI_PROVIDER: 'openai', AI_API_KEY: 'fake-env-key', AI_MODEL: 'env-model', AI_SETTINGS_ENCRYPTION_KEY: 'a'.repeat(64) };
  const runtime = createAiRuntime({ directory, env });
  assert.equal(runtime.view().source, 'environment');
  const saved = runtime.save(draft(), runtime.view().revision);
  assert.equal(runtime.currentConfig()?.provider, 'openai-compatible');
  runtime.clear(saved.revision);
  assert.equal(runtime.currentConfig(), undefined);
  assert.equal(createAiRuntime({ directory, env }).view().hasKey, false);
  assert.throws(() => createAiRuntime({ directory, env: { ...env, AI_SETTINGS_ENCRYPTION_KEY: 'b'.repeat(64) } }).view(), SettingsError);
});

test('endpoint/provider changes require an explicit key; normalized same endpoint may keep key; stale updates are rejected', t => {
  const runtime = createAiRuntime({ directory: fixture(t), env: {} });
  const first = runtime.save(draft(), 'environment');
  for (const extra of [{ baseUrl: 'https://other.example.invalid/v1' }, { provider: 'gemini' }]) {
    assert.throws(() => runtime.save(draft({ apiKey: '', ...extra }), first.revision), /Hãy nhập API key/);
  }
  assert.throws(() => runtime.save(draft(), 'environment'), error => error instanceof SettingsError && error.status === 409);
  const second = runtime.save(draft({ apiKey: '', baseUrl: `${first.baseUrl}/`, model: 'new-model' }), first.revision);
  assert.equal(runtime.currentConfig()?.apiKey, key);
  assert.equal(second.model, 'new-model');
  runtime.save(draft({ provider: 'gemini', baseUrl: '', apiKey: 'explicit-new-key' }), second.revision);
  assert.equal(runtime.currentConfig()?.baseUrl, 'https://generativelanguage.googleapis.com/v1beta');
  assert.throws(() => runtime.save(draft({ baseUrl: `https://x.invalid/?key=${key}` }), runtime.view().revision), error => {
    assert.ok(error instanceof Error); assert.ok(!error.message.includes(key)); return /AI_BASE_URL/.test(error.message);
  });
});

test('live handler picks up settings from another runtime; help/disable change immediately and quotas survive model switches', async t => {
  const directory = fixture(t);
  const admin = createAiRuntime({ directory, env: {} });
  const calls: string[] = [];
  const backend = createAiRuntime({ directory, env: {}, log() {}, clientFactory: config => ({ async generate() { calls.push(config.model); return { text: config.model }; } }) });
  const handle = createMessageHandler(() => backend.assistant());
  const run = async (text: string) => {
    let reply = '';
    await handle({ type: 'message', text, from: { id: 'user' }, recipient: { id: 'bot' }, conversation: { id: 'test', conversationType: 'personal' } } as IMessageActivity, async value => { reply = value; });
    return reply;
  };
  assert.match(await run('question'), /Tôi đã nhận/);
  admin.save(draft({ dailyRequestLimit: 2 }), admin.view().revision);
  assert.match(await run('help'), /AI đang bật/);
  assert.equal(await run('question'), 'test-model');
  admin.save(draft({ apiKey: '', model: 'changed', dailyRequestLimit: 2 }), admin.view().revision);
  assert.equal(await run('question'), 'changed');
  admin.disable(admin.view().revision);
  assert.match(await run('help'), /chưa kết nối AI/);
  assert.match(await run('question'), /Tôi đã nhận/);
  admin.save(draft({ dailyRequestLimit: 2 }), admin.view().revision);
  assert.match(await run('question'), /giới hạn lượt gọi AI trong ngày/);
  assert.deepEqual(calls, ['test-model', 'changed']);
  writeFileSync(join(directory, 'ai-settings.enc'), 'corrupted');
  assert.match(await run('question'), /chưa được gửi tới API/);
  assert.match(await run('ping'), /Pong!/);
});

test('draft connection test is bounded, sanitized, rate limited and never activates or saves', async t => {
  let mode: 'ok' | 'error' = 'error', calls = 0;
  const runtime = createAiRuntime({ directory: fixture(t), env: {}, clientFactory: config => ({ async generate() {
    calls++; assert.equal(config.timeoutMs, 10000); assert.equal(config.maxOutputTokens, 200);
    if (mode === 'error') throw new Error(`raw error containing ${key}`);
    return { text: key };
  } }) });
  await assert.rejects(runtime.test(draft(), 'environment'), error => {
    assert.ok(error instanceof SettingsError); assert.ok(!error.message.includes(key)); return error.status === 502;
  });
  mode = 'ok';
  for (let index = 0; index < 4; index++) {
    const result = await runtime.test(draft(), 'environment');
    assert.ok(!JSON.stringify(result).includes(key));
  }
  await assert.rejects(runtime.test(draft(), 'environment'), error => error instanceof SettingsError && error.status === 429);
  assert.equal(calls, 5); assert.equal(runtime.view().enabled, false); assert.equal(runtime.view().source, 'environment');
});

test('test adapter timeout maps to a safe admin error', async t => {
  const runtime = createAiRuntime({ directory: fixture(t), env: {}, clientFactory: () => ({ async generate() { throw new AiError('timeout'); } }) });
  await assert.rejects(runtime.test(draft(), 'environment'), /Hết thời gian/);
});

test('HTTP settings → test draft → save → preview uses gateway; origin/Host/token blocked, keys never returned', async t => {
  const directory = fixture(t);
  const calls: { url: string | undefined; body: any }[] = [];
  const upstream = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    assert.equal(req.headers.authorization, `Bearer ${key}`);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    calls.push({ url: req.url, body });
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content: 'Đã kết nối qua gateway giả lập' } }] }));
  });
  const gateway = await listen(upstream);
  const preview = createPreviewServer(undefined, undefined, createAiRuntime({ directory, env: {}, log() {} }));
  const base = await listen(preview);
  try {
    const html = await (await fetch(`${base}/settings`)).text();
    assert.ok(!html.includes(key));
    const token = /name="preview-token" content="([^"]+)"/.exec(html)![1];
    const headers = { 'Content-Type': 'application/json', 'X-Preview-Token': token };
    assert.equal((await fetch(`${base}/api/settings`)).status, 403);
    assert.equal((await fetch(`${base}/api/settings`, { headers: { ...headers, Origin: 'https://evil.invalid' } })).status, 403);
    // Node fetch normalizes Host; use raw HTTP to actually exercise rebinding protection.
    const badHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(`${base}/settings`, { headers: { Host: 'rebind.example.invalid' } }, res => {
        res.resume(); res.on('end', () => resolve(res.statusCode));
      }); req.on('error', reject); req.end();
    });
    assert.equal(badHostStatus, 403);
    assert.equal((await fetch(`${base}/settings`, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    const get = () => fetch(`${base}/api/settings`, { headers }).then(r => r.json());
    const post = (name: string, data: unknown) => fetch(`${base}/api/settings/${name}`, { method: 'POST', headers, body: JSON.stringify(data) });
    const original = await get();
    const config = draft({ baseUrl: `${gateway}/company/gateway/v1` });
    const tested = await post('test', { config, revision: original.revision });
    assert.equal(tested.status, 200); assert.equal((await get()).enabled, false);
    const saved = await (await post('save', { config, revision: original.revision })).json();
    assert.equal(saved.enabled, true); assert.ok(!JSON.stringify(saved).includes(key));
    const liveStatus = await fetch(`${base}/api/preview/status`, { headers }).then(r => r.json());
    assert.equal(liveStatus.enabled, true); assert.ok(!JSON.stringify(liveStatus).includes(key));
    assert.equal((await post('save', { config, revision: original.revision })).status, 409);
    const chat = await fetch(`${base}/api/preview`, { method: 'POST', headers, body: JSON.stringify({ text: 'Câu hỏi thật từ preview', conversationId: 'c' }) }).then(r => r.json());
    assert.deepEqual(chat.replies, ['Đã kết nối qua gateway giả lập']);
    assert.equal(calls.length, 2); assert.equal(calls[0].url, '/company/gateway/v1/chat/completions');
    assert.equal(calls[0].body.max_tokens, 200); assert.equal(calls[1].body.messages[1].content, 'Câu hỏi thật từ preview');
    await post('disable', { revision: saved.revision });
    assert.equal((await fetch(`${base}/api/preview/status`, { headers }).then(r => r.json())).enabled, false);
    assert.match(await (await fetch(base)).text(), /AI đang tắt/);
  } finally { await close(preview); await close(upstream); }
});

test('Teams public server has no admin console; runtime privacy reflects enable/disable without restart', async t => {
  const runtime = createAiRuntime({ directory: fixture(t), env: {} });
  const { app, server } = await createApplication({ clientId: '11111111-1111-4111-8111-111111111111', clientSecret: 'fake', tenantId: '22222222-2222-4222-8222-222222222222', port: 3978 }, undefined, runtime);
  try {
    const base = await listen(server);
    for (const path of ['/settings', '/api/settings']) assert.equal((await fetch(`${base}${path}`)).status, 404);
    assert.match(await (await fetch(`${base}/privacy`)).text(), /AI đang tắt/);
    runtime.save(draft(), runtime.view().revision);
    assert.match(await (await fetch(`${base}/privacy`)).text(), /AI đang bật/);
    runtime.disable(runtime.view().revision);
    assert.match(await (await fetch(`${base}/terms`)).text(), /echo/);
  } finally { await app.stop(); }
});
