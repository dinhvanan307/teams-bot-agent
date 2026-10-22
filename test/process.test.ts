import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';

test('compiled production process starts with fake credentials, serves probes and exits on SIGTERM', { timeout: 15000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'teams-process-'));
  const reserve = createServer(); await new Promise<void>(resolve => reserve.listen(0, '127.0.0.1', resolve));
  const address = reserve.address(); assert.ok(address && typeof address === 'object');
  const port = String(address.port); await new Promise<void>(resolve => reserve.close(() => resolve()));
  const child = spawn(process.execPath, ['dist/index.js'], { env: { PATH: process.env.PATH, NODE_ENV: 'production',
    CLIENT_ID: '11111111-1111-4111-8111-111111111111', TENANT_ID: '22222222-2222-4222-8222-222222222222', CLIENT_SECRET: 'fake-not-real',
    AI_SETTINGS_DIR: directory, AI_SETTINGS_ENCRYPTION_KEY: 'f'.repeat(64), AI_ENABLED: 'false', AI_REQUIRE_ENABLED: 'false', PORT: port, SHUTDOWN_TIMEOUT_MS: '1000' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; child.stdout.on('data', x => { logs += x; }); child.stderr.on('data', x => { logs += x; });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); rmSync(directory, { recursive: true, force: true }); });
  const exit = once(child, 'exit');
  for (let attempt = 0; attempt < 100 && !logs.includes('đang chạy'); attempt++) {
    if (child.exitCode !== null) assert.fail(logs);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.match(logs, /đang chạy/);
  const base = `http://127.0.0.1:${port}`;
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
  const ready = await fetch(`${base}/readyz`); assert.equal(ready.status, 200); assert.equal((await ready.json()).aiEnabled, false);
  assert.equal((await fetch(`${base}/api/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
  child.kill('SIGTERM'); const [code, signal] = await exit;
  assert.equal(code, 0); assert.equal(signal, null); assert.match(logs, /"drained":true/);
  assert.ok(!logs.includes('fake-not-real')); assert.ok(!logs.includes('f'.repeat(64)));
});

test('compiled production process fails before listening when the external encryption key is absent', t => {
  const directory = mkdtempSync(join(tmpdir(), 'teams-process-invalid-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, ['dist/index.js'], { timeout: 5000, encoding: 'utf8', env: { PATH: process.env.PATH,
    NODE_ENV: 'production', CLIENT_ID: '11111111-1111-4111-8111-111111111111', TENANT_ID: '22222222-2222-4222-8222-222222222222',
    CLIENT_SECRET: 'fake-not-real', AI_SETTINGS_DIR: directory } });
  assert.equal(result.status, 1); assert.match(result.stderr, /Production cần/);
  assert.ok(!result.stdout.includes('đang chạy')); assert.ok(!result.stderr.includes('fake-not-real'));
});
