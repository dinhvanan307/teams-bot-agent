import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, lstatSync, mkdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
if (git('rev-parse', '--show-toplevel') !== root) throw new Error('Release cần repository riêng tại teams-bot.');
if (git('status', '--porcelain').length) throw new Error('Commit các thay đổi trước khi tạo release.');
const commit = git('rev-parse', 'HEAD');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const entries = {};
const add = path => {
  const filename = resolve(root, path), info = lstatSync(filename);
  if (info.isSymbolicLink()) throw new Error(`Release không nhận symlink: ${path}`);
  if (info.isDirectory()) for (const item of readdirSync(filename).sort()) add(`${path}/${item}`);
  else if (info.isFile()) entries[path] = readFileSync(filename);
};
for (const path of ['dist', 'public', 'deploy', 'package.json', 'package-lock.json', '.nvmrc', '.env.example', 'README.md', 'NOTICE.md',
  'scripts/verify-release.mjs', 'scripts/state.mjs', 'scripts/preflight.mjs', 'docs/DEPLOYMENT.md', 'docs/INTEGRATION-PLAN.md']) add(path);
entries['release.json'] = strToU8(JSON.stringify({ version: pkg.version, commit, builtAt: new Date().toISOString(), node: process.version,
  builderPlatform: process.platform, builderArch: process.arch, integrationStatus: 'NOT_TESTED', hostStatus: 'NOT_TESTED',
  dependencies: 'Install on target with npm ci --omit=dev; node_modules and Node runtime are not bundled.' }, null, 2));
entries['checksums.json'] = strToU8(JSON.stringify({ algorithm: 'sha256', files: Object.entries(entries).map(([path, bytes]) => ({ path,
  sha256: createHash('sha256').update(bytes).digest('hex') })) }, null, 2));
const out = resolve(root, 'artifacts'); mkdirSync(out, { recursive: true });
const name = `teams-bot-agent-${pkg.version}-${commit.slice(0, 12)}.zip`;
const zip = zipSync(entries, { level: 6 });
writeFileSync(resolve(out, name), zip);
writeFileSync(resolve(out, `${name}.sha256`), `${createHash('sha256').update(zip).digest('hex')}  ${name}\n`);
console.log(JSON.stringify({ artifact: relative(root, resolve(out, name)), commit, files: Object.keys(entries).length, sha256: createHash('sha256').update(zip).digest('hex') }, null, 2));
