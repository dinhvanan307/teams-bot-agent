import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform, release, arch } from 'node:os';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = resolve(root, 'docs/evidence'); mkdirSync(out, { recursive: true });
const startedAt = new Date().toISOString();
const build = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], { cwd: root, encoding: 'utf8', timeout: 120000 });
const testFiles = readdirSync(resolve(root, 'test')).filter(x => x.endsWith('.test.ts')).sort().map(x => `test/${x}`);
const test = build.status === 0 ? spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-reporter=tap', ...testFiles],
  { cwd: root, encoding: 'utf8', timeout: 180000, maxBuffer: 4 * 1024 * 1024 }) : undefined;
const log = `BUILD\n${build.stdout ?? ''}${build.stderr ?? ''}\nTEST\n${test?.stdout ?? ''}${test?.stderr ?? ''}`;
writeFileSync(resolve(out, 'local-verification.txt'), log);
const files = [];
const add = path => {
  const full = resolve(root, path);
  if (statSync(full).isDirectory()) for (const item of readdirSync(full).sort()) add(`${path}/${item}`);
  else files.push({ path, sha256: createHash('sha256').update(readFileSync(full)).digest('hex') });
};
for (const path of ['src', 'test', 'scripts', 'deploy', 'public', 'package.json', 'package-lock.json', 'tsconfig.json', '.nvmrc']) add(path);
const count = key => Number(new RegExp(`^# ${key} (\\d+)$`, 'm').exec(test?.stdout ?? '')?.[1] ?? 0);
const report = { startedAt, finishedAt: new Date().toISOString(), timezone: 'Asia/Ho_Chi_Minh', node: process.version,
  platform: platform(), osRelease: release(), arch: arch(), version: JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version,
  commands: ['npm run build', `node --import tsx --test --test-reporter=tap ${testFiles.join(' ')}`],
  buildExitCode: build.status, testExitCode: test?.status ?? null, tests: count('tests'), pass: count('pass'), fail: count('fail'), skipped: count('skipped'),
  localStatus: build.status === 0 && test?.status === 0 && count('tests') > 0 ? 'PASS' : 'FAIL',
  liveTeamsAI: 'NOT_TESTED', targetHost: 'NOT_TESTED', note: 'Fake credentials, mock providers and localhost only; no tenant or provider acceptance.',
  sourceSha256: createHash('sha256').update(JSON.stringify(files)).digest('hex'), sourceFiles: files };
writeFileSync(resolve(out, 'local-verification.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, sourceFiles: `${files.length} files; see docs/evidence/local-verification.json` }, null, 2));
if (report.localStatus !== 'PASS') { console.error(log.slice(-10000)); process.exitCode = 1; }
