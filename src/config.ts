import { resolveSecrets } from './secrets.js';

export function getConfig(input: NodeJS.ProcessEnv = process.env) {
  const env = resolveSecrets(input, ['CLIENT_SECRET']);
  const required = ['CLIENT_ID', 'CLIENT_SECRET', 'TENANT_ID'] as const;
  const missing = required.filter((key) => !env[key]?.trim());
  if (missing.length) {
    throw new Error(`Chưa đăng ký bot Teams. Thiếu ${missing.join(', ')} trong .env. Dùng npm run preview để thử trên máy.`);
  }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const key of ['CLIENT_ID', 'TENANT_ID']) {
    if (!uuid.test(env[key]!)) throw new Error(`${key} phải là UUID do Microsoft cấp.`);
  }
  const port = Number(env.PORT ?? 3978);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT không hợp lệ.');
  return { clientId: env.CLIENT_ID!, clientSecret: env.CLIENT_SECRET!, tenantId: env.TENANT_ID!, port };
}
