import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, rmSync, mkdtempSync, statSync } from 'node:fs';
import { resolve, join, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createAiRuntime } from '../dist/ai/runtime-settings.js';

export function snapshotState(command, snapshot, env = process.env, offline = false) {
  if (!snapshot || !isAbsolute(snapshot) || !env.AI_SETTINGS_DIR || !isAbsolute(env.AI_SETTINGS_DIR)) throw new Error('Cần snapshot và AI_SETTINGS_DIR là đường dẫn tuyệt đối.');
  const state = env.AI_SETTINGS_DIR, config = join(state, 'ai-settings.enc');
  if (!env.AI_SETTINGS_ENCRYPTION_KEY && !env.AI_SETTINGS_ENCRYPTION_KEY_FILE) throw new Error('Cần khóa được cấp riêng; không sao chép khóa local vào backup.');
  const checkBytes = bytes => {
    const temp = mkdtempSync(join(tmpdir(), 'teams-state-verify-'));
    try {
      writeFileSync(join(temp, 'ai-settings.enc'), bytes, { mode: 0o600 });
      createAiRuntime({ env, directory: temp }).view();
    } finally { rmSync(temp, { recursive: true, force: true }); }
  };
  if (command === 'backup') {
    createAiRuntime({ env }).view();
    const bytes = readFileSync(config); checkBytes(bytes);
    mkdirSync(snapshot, { mode: 0o700 }); // No overwrite or accidental merge with a previous snapshot.
    writeFileSync(join(snapshot, 'ai-settings.enc'), bytes, { mode: 0o600, flag: 'wx' });
    writeFileSync(join(snapshot, 'snapshot.json'), JSON.stringify({ format: 1, createdAt: new Date().toISOString(),
      sha256: createHash('sha256').update(bytes).digest('hex'), includesKey: false }, null, 2), { mode: 0o600, flag: 'wx' });
    return { ok: true, operation: 'backup', includesKey: false };
  }
  if (!['verify', 'restore'].includes(command)) throw new Error('Dùng backup, verify hoặc restore.');
  if (statSync(join(snapshot, 'ai-settings.enc')).size > 65536) throw new Error('Snapshot quá lớn.');
  const bytes = readFileSync(join(snapshot, 'ai-settings.enc'));
  const meta = JSON.parse(readFileSync(join(snapshot, 'snapshot.json'), 'utf8'));
  if (meta.format !== 1 || meta.includesKey !== false || meta.sha256 !== createHash('sha256').update(bytes).digest('hex')) throw new Error('Checksum snapshot không khớp.');
  checkBytes(bytes);
  if (command === 'restore') {
    if (!offline) throw new Error('Dừng bot và preview, sau đó dùng --offline để xác nhận khôi phục ngoại tuyến.');
    if (existsSync(config)) throw new Error('Chỉ khôi phục vào state mới chưa có profile. Giữ nguyên state cũ để rollback.');
    createAiRuntime({ env }); // Enforce production directory/key rules before writing.
    mkdirSync(state, { recursive: true, mode: 0o700 });
    const temp = join(state, `.restore-${randomUUID()}`);
    try { writeFileSync(temp, bytes, { mode: 0o600, flag: 'wx' }); renameSync(temp, config); }
    finally { if (existsSync(temp)) rmSync(temp); }
  }
  return { ok: true, operation: command, includesKey: false };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(snapshotState(process.argv[2], process.argv[3], process.env, process.argv.includes('--offline')))); }
  catch { console.error('Thao tác state thất bại. Kiểm tra lệnh, đường dẫn, quyền, checksum, khóa và điều kiện offline theo runbook.'); process.exitCode = 1; }
}
