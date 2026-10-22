import test from 'node:test';
import assert from 'node:assert/strict';
import type { IMessageActivity } from '@microsoft/teams.api';
import { createMessageHandler } from '../src/bot.js';
import { getConfig } from '../src/config.js';
import { createApplication } from '../src/app.js';

function message(text: string, conversation = 'a', type = 'personal', mention = false, tenant = 'tenant-a'): IMessageActivity {
  return {
    type: 'message', id: 'msg', channelId: 'msteams', serviceUrl: 'https://smba.trafficmanager.net/teams',
    from: { id: 'user' }, recipient: { id: 'bot' }, text: mention ? `<at>Fiin Team Bot</at> ${text}` : text,
    conversation: { id: conversation, conversationType: type }, channelData: { tenant: { id: tenant } },
    entities: mention ? [{ type: 'mention', mentioned: { id: 'bot', name: 'Fiin Team Bot' }, text: '<at>Fiin Team Bot</at>' }] : [],
  } as IMessageActivity;
}
test('chào hỏi và lệnh có khoảng trắng/dấu slash/chữ hoa', async () => {
  const handle = createMessageHandler(), replies: string[] = [];
  await handle(message('  /PING  '), async x => { replies.push(x); });
  await handle(message('help'), async x => { replies.push(x); });
  assert.match(replies[0], /Pong!/);
  assert.match(replies[1], /chưa kết nối AI/);
});
test('kênh và nhóm chat chỉ trả lời khi được @bot; SDK bỏ mention', async () => {
  for (const type of ['channel', 'groupChat']) {
    const handle = createMessageHandler(), replies: string[] = [];
    await handle(message('ping', 'a', type), async x => { replies.push(x); });
    assert.equal(replies.length, 0);
    await handle(message('ping', 'a', type, true), async x => { replies.push(x); });
    assert.match(replies[0], /^Pong!/);
  }
});
test('bộ đếm tách hội thoại/tenant và reset không ảnh hưởng hội thoại khác', async () => {
  const handle = createMessageHandler();
  const run = async (text: string, id = 'a', tenant = 'tenant-a') => {
    let result = ''; await handle(message(text, id, 'personal', false, tenant), async x => { result = x; }); return result;
  };
  assert.match(await run('một'), /^\[1\]/);
  assert.match(await run('hai'), /^\[2\]/);
  assert.match(await run('khác', 'b'), /^\[1\]/);
  assert.match(await run('khác tenant', 'a', 'tenant-b'), /^\[1\]/);
  await run('reset');
  assert.match(await run('count'), /có 0 tin nhắn/);
  assert.match(await run('count', 'b'), /có 1 tin nhắn/);
});
test('không khởi động chế độ Teams khi thiếu cấu hình hoặc cổng sai', () => {
  assert.throws(() => getConfig({}), /Chưa đăng ký/);
  assert.throws(() => getConfig({ CLIENT_ID: 'bad', CLIENT_SECRET: 'test', TENANT_ID: 'bad' }), /UUID/);
  assert.throws(() => getConfig({ CLIENT_ID: '11111111-1111-4111-8111-111111111111', CLIENT_SECRET: 'test', TENANT_ID: '22222222-2222-4222-8222-222222222222', PORT: 'NaN' }), /PORT/);
});
test('endpoint Teams thật của SDK chặn request thiếu JWT, kể cả env yêu cầu tắt auth', async () => {
  const original = process.env.DANGEROUSLY_ALLOW_UNAUTHENTICATED_REQUESTS;
  process.env.DANGEROUSLY_ALLOW_UNAUTHENTICATED_REQUESTS = 'true';
  const { app, server } = await createApplication({
    clientId: '11111111-1111-4111-8111-111111111111', clientSecret: 'not-a-real-secret',
    tenantId: '22222222-2222-4222-8222-222222222222', port: 3978,
  });
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    assert.equal((await fetch(`${base}/healthz`)).status, 200);
    const denied = await fetch(`${base}/api/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(message('ping')) });
    assert.equal(denied.status, 401);
  } finally {
    await app.stop();
    if (original === undefined) delete process.env.DANGEROUSLY_ALLOW_UNAUTHENTICATED_REQUESTS;
    else process.env.DANGEROUSLY_ALLOW_UNAUTHENTICATED_REQUESTS = original;
  }
});
