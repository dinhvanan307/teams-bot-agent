import { readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';

/** Resolve only declared secrets. Never include file paths, contents or raw IO errors in messages. */
export function resolveSecrets(input: NodeJS.ProcessEnv, names = ['CLIENT_SECRET', 'AI_API_KEY', 'AI_SETTINGS_ENCRYPTION_KEY']) {
  const env = { ...input };
  for (const name of names) {
    const filename = env[`${name}_FILE`]?.trim();
    if (!filename) continue;
    if (env[name]?.trim()) throw new Error(`Cấu hình secret: chỉ đặt ${name} hoặc ${name}_FILE.`);
    try {
      if (!isAbsolute(filename)) throw new Error();
      const info = statSync(filename);
      if (!info.isFile() || info.size > 8192) throw new Error();
      if (env.NODE_ENV === 'production' && process.platform !== 'win32' && (info.mode & 0o077)) throw new Error();
      const value = readFileSync(filename, 'utf8').trim();
      if (!value || value.includes('\0')) throw new Error();
      env[name] = value;
    } catch { throw new Error(`Cấu hình secret: không đọc được ${name}_FILE hoặc quyền file chưa an toàn.`); }
  }
  return env;
}
