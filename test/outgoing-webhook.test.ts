import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createOutgoingWebhookServer, getWebhookConfig } from '../src/outgoing-webhook.js';

const key = Buffer.from('0123456789abcdef0123456789abcdef'); // Khóa giả chỉ dùng trong test.
const tenantId = '22222222-2222-4222-8222-222222222222';
const activity = { type: 'message', channelId: 'msteams', text: '<at>Fiin Demo</at> ping', channelData: { tenant: { id: tenantId } } };
const sign = (body: string) => `HMAC ${createHmac('sha256', key).update(body, 'utf8').digest('base64')}`;

test('webhook không chạy khi thiếu token, token sai định dạng hoặc thiếu tenant', () => {
  assert.throws(() => getWebhookConfig({}), /TEAMS_WEBHOOK_SECRET/);
  assert.throws(() => getWebhookConfig({ TEAMS_WEBHOOK_SECRET: 'not-a-token' }), /TEAMS_WEBHOOK_SECRET/);
  assert.throws(() => getWebhookConfig({ TEAMS_WEBHOOK_SECRET: key.toString('base64') }), /TENANT_ID/);
  assert.equal(getWebhookConfig({ TEAMS_WEBHOOK_SECRET: key.toString('base64'), TENANT_ID: tenantId }).port, 3978);
});

test('HTTP webhook: @ping, UTF-8 nguyên bản, HMAC, tenant và giới hạn payload', async () => {
  const server = createOutgoingWebhookServer({ key, tenantId, port: 3978 });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const post = (body: string, authorization = sign(body)) => fetch(`${base}/api/outgoing-webhook`, {
      method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8', authorization }, body,
    });
    const body = JSON.stringify(activity);
    const ping = await post(body);
    assert.equal(ping.status, 200);
    assert.match((await ping.json()).text, /^Pong!/);
    const unicode = JSON.stringify({ ...activity, text: '<at>Fiin Demo</at> tiếng Việt 👋' }, null, 2);
    const echo = await (await post(unicode)).json();
    assert.equal(echo.textFormat, 'plain');
    assert.match(echo.text, /tiếng Việt 👋/);
    assert.equal((await post(body, '')).status, 401);
    assert.equal((await post(body, 'HMAC malformed')).status, 401);
    assert.equal((await post(`${body} `, sign(body))).status, 401);
    assert.equal((await post(JSON.stringify({ ...activity, channelData: { tenant: { id: 'other' } } }))).status, 403);
    assert.equal((await post('{')).status, 400);
    assert.equal((await post(JSON.stringify({ ...activity, text: 'x'.repeat(66000) }))).status, 413);
    assert.equal((await fetch(`${base}/api/messages`, { method: 'POST' })).status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
