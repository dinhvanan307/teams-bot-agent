import { createHash } from 'node:crypto';
import { readFileSync, lstatSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

export function verifyRelease(directory) {
  const base = resolve(directory);
  const manifest = JSON.parse(readFileSync(resolve(base, 'checksums.json'), 'utf8'));
  if (manifest.algorithm !== 'sha256' || !Array.isArray(manifest.files) || !manifest.files.length) throw new Error('Invalid checksum manifest');
  const seen = new Set();
  for (const entry of manifest.files) {
    if (typeof entry.path !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Invalid checksum entry');
    const filename = resolve(base, entry.path), rel = relative(base, filename);
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || seen.has(rel)) throw new Error('Unsafe or duplicate release path');
    seen.add(rel);
    const parts = rel.split(/[\\/]/); let current = base;
    for (const part of parts) { current = resolve(current, part); if (lstatSync(current).isSymbolicLink()) throw new Error('Symlinks are not release files'); }
    if (!lstatSync(filename).isFile() || createHash('sha256').update(readFileSync(filename)).digest('hex') !== entry.sha256) throw new Error(`Checksum mismatch: ${entry.path}`);
  }
  return { verified: manifest.files.length };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(verifyRelease(process.argv[2] || '.'), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
