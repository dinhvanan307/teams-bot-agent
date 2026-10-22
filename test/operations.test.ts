import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveSecrets } from '../src/secrets.js';
import { createAiRuntime } from '../src/ai/runtime-settings.js';
import { createApplication } from '../src/app.js';
import { createLifecycle, shutdownTimeout } from '../src/lifecycle.js';
import { VERSION } from '../src/version.js';
import { createManifest, packageTeams } from '../scripts/package.mjs';
import { verifyRelease } from '../scripts/verify-release.mjs';
import { snapshotState } from '../scripts/state.mjs';
import { unzipSync } from 'fflate';

function temp(t: { after: (fn: () => void) => void }) {
  const directory = mkdtempSync(join(tmpdir(), 'teams-operations-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
const ids = { CLIENT_ID: '11111111-1111-4111-8111-111111111111', TEAMS_APP_ID: '22222222-2222-4222-8222-222222222222' };
const bot = { clientId: ids.CLIENT_ID, tenantId: ids.TEAMS_APP_ID, clientSecret: 'fake-secret', port: 3978 };
const profile = { provider: 'openai-compatible', baseUrl: 'https://example.invalid/v1', model: 'fixture', apiKey: 'fake-test-key-only' };

test('Teams manifest preserves gateway prefix, aligns version and rejects ambiguous base URLs', () => {
  for (const [endpoint, base] of [['https://example.invalid', 'https://example.invalid'], ['https://example.invalid/teams-bot/', 'https://example.invalid/teams-bot']]) {
    const manifest = createManifest({ ...ids, BOT_ENDPOINT: endpoint });
    assert.equal(manifest.version, VERSION);
    assert.equal(manifest.developer.privacyUrl, `${base}/privacy`);
    assert.equal(manifest.developer.termsOfUseUrl, `${base}/terms`);
  }
  for (const endpoint of ['http://example.invalid', 'https://localhost', 'https://example.invalid/?token=x', 'https://example.invalid/#x', 'https://a:b@example.invalid', 'https://example.invalid/teams-bot/api/messages']) {
    assert.throws(() => createManifest({ ...ids, BOT_ENDPOINT: endpoint }));
  }
});

test('Teams ZIP validates schema and contains only manifest and icons with fake IDs', t => {
  const { path, manifest } = packageTeams({ env: { ...ids, BOT_ENDPOINT: 'https://example.invalid/teams-bot' }, outputDirectory: temp(t) });
  const entries = unzipSync(readFileSync(path));
  assert.deepEqual(Object.keys(entries).sort(), ['color.png', 'manifest.json', 'outline.png']);
  assert.deepEqual(JSON.parse(Buffer.from(entries['manifest.json']).toString()), manifest);
});

test('secret file loader rejects ambiguous, missing, oversized or broad-access files without leaking content', t => {
  const root = temp(t), file = join(root, 'secret');
  writeFileSync(file, 'fake-secret-value\n', { mode: 0o600 });
  assert.equal(resolveSecrets({ CLIENT_SECRET_FILE: file }).CLIENT_SECRET, 'fake-secret-value');
  assert.throws(() => resolveSecrets({ CLIENT_SECRET: 'other', CLIENT_SECRET_FILE: file }), /chỉ đặt/);
  assert.throws(() => resolveSecrets({ CLIENT_SECRET_FILE: 'relative' }), /CLIENT_SECRET_FILE/);
  assert.throws(() => resolveSecrets({ CLIENT_SECRET_FILE: join(root, 'absent') }), /CLIENT_SECRET_FILE/);
  chmodSync(file, 0o644);
  if (process.platform !== 'win32') assert.throws(() => resolveSecrets({ NODE_ENV: 'production', CLIENT_SECRET_FILE: file }), /quyền file/);
  chmodSync(file, 0o600); writeFileSync(file, 'private-value'.repeat(1000));
  assert.throws(() => resolveSecrets({ CLIENT_SECRET_FILE: file }), error => !String(error).includes('private-value'));
});

test('production requires explicit state and external key, forbids key inside state and never generates a local key', t => {
  const root = temp(t), state = join(root, 'state');
  assert.throws(() => createAiRuntime({ env: { NODE_ENV: 'production', AI_SETTINGS_DIR: state } }), /Production cần/);
  assert.throws(() => createAiRuntime({ env: { NODE_ENV: 'production', AI_SETTINGS_ENCRYPTION_KEY: 'a'.repeat(64) } }), /Production cần/);
  mkdirSync(state, { mode: 0o700 });
  const keyFile = join(state, 'insecure-key'); writeFileSync(keyFile, 'a'.repeat(64), { mode: 0o600 });
  assert.throws(() => createAiRuntime({ env: { NODE_ENV: 'production', AI_SETTINGS_DIR: state, AI_SETTINGS_ENCRYPTION_KEY_FILE: keyFile } }), /tách khỏi/);
  const env = { NODE_ENV: 'production', AI_SETTINGS_DIR: state, AI_SETTINGS_ENCRYPTION_KEY: 'b'.repeat(64) };
  const runtime = createAiRuntime({ env }); runtime.save(profile, runtime.view().revision);
  assert.equal(existsSync(join(state, 'ai-settings.key')), false);
  assert.equal(createAiRuntime({ env }).currentConfig()?.apiKey, profile.apiKey);
  assert.throws(() => createAiRuntime({ env: { ...env, AI_SETTINGS_ENCRYPTION_KEY: 'c'.repeat(64) } }).readiness());
  if (process.platform !== 'win32') { chmodSync(state, 0o755); assert.throws(() => runtime.readiness()); chmodSync(state, 0o700); }
});

test('readiness and liveness differ on corrupt config, disabled required AI and drain; probes never call AI', async t => {
  const directory = temp(t); let calls = 0;
  const runtime = createAiRuntime({ directory, env: { AI_REQUIRE_ENABLED: 'true' }, clientFactory: () => ({ async generate() { calls++; return { text: 'mock' }; } }) });
  const { server, app, lifecycle } = await createApplication(bot, undefined, runtime);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(`${base}/healthz`)).status, 200);
    assert.equal((await fetch(`${base}/readyz`)).status, 503);
    runtime.save(profile, runtime.view().revision);
    const response = await fetch(`${base}/readyz`); assert.equal(response.status, 200);
    assert.equal((await response.json()).version, VERSION); assert.equal(calls, 0);
    writeFileSync(join(directory, 'ai-settings.enc'), 'broken');
    assert.equal((await fetch(`${base}/healthz`)).status, 200);
    const unavailable = await fetch(`${base}/readyz`); assert.equal(unavailable.status, 503);
    assert.deepEqual(await unavailable.json(), { ok: false, reason: 'not_ready' });
    lifecycle.beginDrain();
    assert.equal((await fetch(`${base}/api/messages`, { method: 'POST' })).status, 503);
    assert.equal(calls, 0);
  } finally { await app.stop(); }
});

test('shutdown waits for active handlers, rejects new work and is idempotent', async () => {
  let finish!: () => void, stops = 0, forced = 0;
  const lifecycle = createLifecycle(async () => { stops++; }, () => { forced++; });
  const job = lifecycle.run(() => new Promise<void>(resolve => { finish = resolve; }));
  const shutdown = lifecycle.shutdown(2000);
  assert.equal(lifecycle.accepting, false); assert.equal(lifecycle.active, 1);
  assert.equal(lifecycle.shutdown(2000), shutdown);
  await assert.rejects(lifecycle.run(async () => 'new work'), /đang dừng/);
  let stopped = false; void shutdown.then(() => { stopped = true; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(stopped, false);
  finish(); await job; assert.deepEqual(await shutdown, { drained: true });
  assert.equal(stops, 1); assert.equal(forced, 0);
});

test('shutdown deadline forces transport closure and reports undrained work', async () => {
  let force = 0, finish!: () => void;
  const lifecycle = createLifecycle(async () => {}, () => { force++; });
  const job = lifecycle.run(() => new Promise<void>(resolve => { finish = resolve; }));
  assert.deepEqual(await lifecycle.shutdown(20), { drained: false });
  assert.equal(force, 1); finish(); await job;
  assert.throws(() => shutdownTimeout({ SHUTDOWN_TIMEOUT_MS: 'NaN' }));
  assert.throws(() => shutdownTimeout({ SHUTDOWN_TIMEOUT_MS: '999999' }));
  assert.equal(shutdownTimeout({}), 30000);
});

test('backup and offline restore preserve encrypted configuration; wrong keys and corrupt snapshots are rejected', t => {
  const root = temp(t), state = join(root, 'state'), backup = join(root, 'snapshot'), restored = join(root, 'restored');
  const env = { NODE_ENV: 'production', AI_SETTINGS_DIR: state, AI_SETTINGS_ENCRYPTION_KEY: 'd'.repeat(64) };
  const runtime = createAiRuntime({ env }); runtime.save(profile, runtime.view().revision);
  assert.equal(snapshotState('backup', backup, env).ok, true);
  assert.equal(existsSync(join(backup, 'ai-settings.key')), false);
  assert.equal(snapshotState('verify', backup, env).ok, true);
  assert.throws(() => snapshotState('verify', backup, { ...env, AI_SETTINGS_ENCRYPTION_KEY: 'e'.repeat(64) }));
  assert.throws(() => snapshotState('restore', backup, { ...env, AI_SETTINGS_DIR: restored }), /offline/);
  snapshotState('restore', backup, { ...env, AI_SETTINGS_DIR: restored }, true);
  assert.equal(createAiRuntime({ env: { ...env, AI_SETTINGS_DIR: restored } }).currentConfig()?.apiKey, profile.apiKey);
  assert.throws(() => snapshotState('restore', backup, { ...env, AI_SETTINGS_DIR: restored }, true), /state mới/);
  writeFileSync(join(backup, 'ai-settings.enc'), 'tampered');
  assert.throws(() => snapshotState('verify', backup, env), /Checksum/);
});

test('release verifier detects modification and refuses traversal paths', t => {
  const root = temp(t), file = join(root, 'sample.txt'); writeFileSync(file, 'original');
  const sha256 = createHash('sha256').update('original').digest('hex');
  const checksums = join(root, 'checksums.json');
  writeFileSync(checksums, JSON.stringify({ algorithm: 'sha256', files: [{ path: 'sample.txt', sha256 }] }));
  assert.deepEqual(verifyRelease(root), { verified: 1 });
  writeFileSync(file, 'tampered'); assert.throws(() => verifyRelease(root), /Checksum mismatch/);
  writeFileSync(checksums, JSON.stringify({ algorithm: 'sha256', files: [{ path: '../outside', sha256 }] }));
  assert.throws(() => verifyRelease(root), /Unsafe/);
});
