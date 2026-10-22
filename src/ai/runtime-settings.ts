import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { accessSync, constants, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAiConfig, type AiConfig } from './config.js';
import { AiError, createAiClient, type AiClient } from './client.js';
import { createAiService, createAiUsageState, type AiAssistant } from './service.js';
import { resolveSecrets } from '../secrets.js';

export class SettingsError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}
const fields = {
  provider: 'AI_PROVIDER', baseUrl: 'AI_BASE_URL', model: 'AI_MODEL', apiKey: 'AI_API_KEY',
  systemPrompt: 'AI_SYSTEM_PROMPT', timeoutMs: 'AI_TIMEOUT_MS', maxOutputTokens: 'AI_MAX_OUTPUT_TOKENS',
  maxInputChars: 'AI_MAX_INPUT_CHARS', dailyRequestLimit: 'AI_DAILY_REQUEST_LIMIT',
  userRequestsPerMinute: 'AI_USER_REQUESTS_PER_MINUTE', maxConcurrent: 'AI_MAX_CONCURRENT',
  chatTokenParameter: 'AI_CHAT_TOKEN_PARAMETER', anthropicVersion: 'AI_ANTHROPIC_VERSION',
  anthropicWorkspaceId: 'AI_ANTHROPIC_WORKSPACE_ID',
} as const;
type Profile = { enabled: boolean; config?: AiConfig };
const aad = Buffer.from('fiin-team-bot/ai-settings/v1');
const failStorage = () => new SettingsError('Không đọc hoặc lưu được cấu hình AI. Kiểm tra thư mục cấu hình và khóa mã hóa trên máy chủ.', 503);
function validate(input: Record<string, unknown>): AiConfig {
  const env: NodeJS.ProcessEnv = { AI_ENABLED: 'true' };
  for (const [field, name] of Object.entries(fields)) {
    const value = input[field];
    if (value === undefined) continue;
    if (typeof value !== 'string' && typeof value !== 'number') throw new SettingsError('Cấu hình AI có trường không hợp lệ.');
    if (String(value).length > 8192) throw new SettingsError('Giá trị cấu hình AI quá dài.');
    env[name] = String(value);
  }
  try { return getAiConfig(env)!; }
  catch (error) { throw new SettingsError(error instanceof Error ? error.message : 'Cấu hình AI không hợp lệ.'); }
}
const defaults = () => validate({ provider: 'openai-compatible', baseUrl: 'https://example.invalid/v1', model: 'placeholder', apiKey: 'placeholder' });

/** Encrypted, atomic local settings. No dependency on Zalo accounts, DB or credentials. */
export function createAiRuntime(options: {
  directory?: string; env?: NodeJS.ProcessEnv;
  clientFactory?: (config: AiConfig) => AiClient;
  log?: (event: Record<string, string | number>) => void;
} = {}) {
  const env = resolveSecrets(options.env ?? process.env, ['AI_API_KEY', 'AI_SETTINGS_ENCRYPTION_KEY']);
  const production = env.NODE_ENV === 'production';
  const directory = options.directory ?? env.AI_SETTINGS_DIR ?? fileURLToPath(new URL('../../.state', import.meta.url));
  if (!isAbsolute(directory)) throw new SettingsError('AI_SETTINGS_DIR phải là đường dẫn tuyệt đối.');
  if (production) {
    if (!(options.directory || env.AI_SETTINGS_DIR) || !/^[a-f\d]{64}$/i.test(env.AI_SETTINGS_ENCRYPTION_KEY ?? '')) {
      throw new SettingsError('Production cần AI_SETTINGS_DIR tuyệt đối và khóa mã hóa 32 byte được cấp riêng.');
    }
    try {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      if (process.platform !== 'win32' && (statSync(directory).mode & 0o077)) throw new Error();
      if (env.AI_SETTINGS_ENCRYPTION_KEY_FILE) {
        const rel = relative(realpathSync(directory), realpathSync(env.AI_SETTINGS_ENCRYPTION_KEY_FILE));
        if (!rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && rel !== '..' && !isAbsolute(rel)) throw new Error();
      }
      accessSync(directory, constants.R_OK | constants.W_OK);
    } catch { throw new SettingsError('Production cần thư mục state riêng tư, ghi được và tách khỏi file khóa.'); }
  }
  if (env.AI_REQUIRE_ENABLED && !['true', 'false'].includes(env.AI_REQUIRE_ENABLED)) throw new SettingsError('AI_REQUIRE_ENABLED phải là true hoặc false.');
  const file = join(directory, 'ai-settings.enc');
  const keyFile = join(directory, 'ai-settings.key');
  const clientFactory = options.clientFactory ?? createAiClient;
  const usage = createAiUsageState();
  let cachedFingerprint = '', cachedService: AiAssistant | undefined;
  let testActive = false, testResetAt = 0, tests = 0;

  function key(create: boolean): Buffer {
    if (env.AI_SETTINGS_ENCRYPTION_KEY) {
      if (!/^[a-f\d]{64}$/i.test(env.AI_SETTINGS_ENCRYPTION_KEY)) throw failStorage();
      return Buffer.from(env.AI_SETTINGS_ENCRYPTION_KEY, 'hex');
    }
    if (!existsSync(keyFile) && create && !existsSync(file)) {
      try { writeFileSync(keyFile, randomBytes(32), { mode: 0o600, flag: 'wx' }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    }
    const bytes = readFileSync(keyFile);
    if (bytes.length !== 32) throw failStorage();
    return bytes;
  }
  function read(): Profile & { revision: string; source: 'saved' | 'environment' } {
    try {
      if (!existsSync(file)) return { enabled: !!getAiConfig(env), config: getAiConfig(env), revision: 'environment', source: 'environment' };
      if (statSync(file).size > 65536) throw failStorage();
      const packed = readFileSync(file);
      if (packed.length < 30 || packed[0] !== 1) throw failStorage();
      const decipher = createDecipheriv('aes-256-gcm', key(false), packed.subarray(1, 13));
      decipher.setAAD(aad);
      decipher.setAuthTag(packed.subarray(13, 29));
      const decoded = JSON.parse(Buffer.concat([decipher.update(packed.subarray(29)), decipher.final()]).toString('utf8'));
      if (typeof decoded.enabled !== 'boolean' || (decoded.enabled && !decoded.config)) throw failStorage();
      return { enabled: decoded.enabled, config: decoded.config ? validate(decoded.config) : undefined,
        revision: createHash('sha256').update(packed).digest('hex'), source: 'saved' };
    } catch { throw failStorage(); } // A broken saved profile never falls back to another provider/key.
  }
  function checkRevision(revision: unknown) {
    const current = read();
    if (revision !== current.revision) throw new SettingsError('Cấu hình đã thay đổi ở cửa sổ khác. Tải lại trang trước khi lưu hoặc kiểm tra.', 409);
    return current;
  }
  function write(profile: Profile) {
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key(true), iv);
      cipher.setAAD(aad);
      const encrypted = Buffer.concat([cipher.update(JSON.stringify(profile), 'utf8'), cipher.final()]);
      writeFileSync(temp, Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), encrypted]), { mode: 0o600, flag: 'wx' });
      renameSync(temp, file);
    } catch { throw failStorage(); }
    finally { if (existsSync(temp)) unlinkSync(temp); }
  }
  function draft(input: unknown, revision: unknown): AiConfig {
    const current = checkRevision(revision);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new SettingsError('Cấu hình AI không hợp lệ.');
    const value = input as Record<string, unknown>;
    if (Object.keys(value).some(field => !Object.hasOwn(fields, field))) throw new SettingsError('Cấu hình AI có trường không hỗ trợ.');
    if (value.apiKey !== undefined && typeof value.apiKey !== 'string') throw new SettingsError('API key phải là chuỗi ký tự.');
    const suppliedKey = typeof value.apiKey === 'string' ? value.apiKey.trim() : '';
    // Validate the target before deciding whether an existing secret may be reused.
    const candidate = validate({ ...value, apiKey: suppliedKey || 'pending-key' });
    if (!suppliedKey) {
      if (!current.config || current.config.provider !== candidate.provider || current.config.baseUrl !== candidate.baseUrl) {
        throw new SettingsError('Hãy nhập API key cho kết nối này. Khi đổi kiểu API hoặc Base URL, không được dùng lại key cũ bằng cách để trống.');
      }
      candidate.apiKey = current.config.apiKey;
    }
    return candidate;
  }
  function view() {
    const profile = read();
    const { apiKey, ...config } = profile.config ?? { ...defaults(), model: '', baseUrl: '', apiKey: '' };
    return { ...config, enabled: profile.enabled, source: profile.source, revision: profile.revision,
      hasKey: !!apiKey, apiKeyMasked: apiKey ? (apiKey.length >= 12 ? `••••${apiKey.slice(-4)}` : '••••') : 'Chưa có key' };
  }
  return {
    view,
    readiness() {
      const profile = read();
      if (production) {
        accessSync(directory, constants.R_OK | constants.W_OK);
        if (process.platform !== 'win32' && (statSync(directory).mode & 0o077)) throw failStorage();
      }
      if (env.AI_REQUIRE_ENABLED === 'true' && !profile.enabled) throw new SettingsError('AI chưa được bật theo yêu cầu triển khai.');
      return { aiEnabled: profile.enabled };
    },
    currentConfig() { const profile = read(); return profile.enabled ? profile.config : undefined; },
    assistant(): AiAssistant | undefined {
      const profile = read();
      if (!profile.enabled || !profile.config) return undefined;
      const fingerprint = JSON.stringify(profile.config);
      if (fingerprint !== cachedFingerprint) {
        cachedService = createAiService(profile.config, { client: clientFactory(profile.config), usage, log: options.log });
        cachedFingerprint = fingerprint;
      }
      return cachedService;
    },
    save(input: unknown, revision: unknown) { write({ enabled: true, config: draft(input, revision) }); return view(); },
    disable(revision: unknown) { const current = checkRevision(revision); write({ enabled: false, config: current.config }); return view(); },
    // Removing a saved connection explicitly disables AI; it does not reactivate an env key.
    clear(revision: unknown) { checkRevision(revision); write({ enabled: false }); return view(); },
    async test(input: unknown, revision: unknown) {
      const config = draft(input, revision);
      const now = Date.now();
      if (now >= testResetAt) { testResetAt = now + 60000; tests = 0; }
      if (testActive || tests >= 5) throw new SettingsError('Hãy chờ trước khi kiểm tra tiếp. Tối đa 5 lần/phút và 1 lần đồng thời.', 429);
      tests++; testActive = true;
      try {
        // Test the unsaved form with a fixed prompt, bounded cost and no raw provider output.
        await clientFactory({ ...config, timeoutMs: Math.min(config.timeoutMs, 10000),
          maxOutputTokens: Math.min(config.maxOutputTokens, 200), systemPrompt: 'Trả lời ngắn gọn bằng một từ: OK.' }).generate('Kiểm tra kết nối.');
        return { ok: true, message: 'API đã trả về văn bản. Cấu hình thử chưa được lưu; chọn Lưu và bật AI để áp dụng.' };
      } catch (error) {
        const messages: Record<string, string> = {
          auth: 'Key chưa hợp lệ hoặc không có quyền dùng API/model này.',
          configuration: 'Kiểm tra kiểu API, Base URL, model và tham số của nhà cung cấp.',
          rate_limit: 'Nhà cung cấp đang giới hạn lượt gọi hoặc tài khoản hết quota.',
          timeout: 'Hết thời gian kiểm tra kết nối (tối đa 10 giây).',
          empty: 'API chưa trả về văn bản; model có thể cần giới hạn đầu ra lớn hơn hoặc cấu hình khác.',
          unavailable: 'Không kết nối được API. Kiểm tra mạng, Base URL và dịch vụ.',
        };
        throw new SettingsError(messages[error instanceof AiError ? error.code : 'unavailable'], 502);
      } finally { testActive = false; }
    },
  };
}
export type AiRuntime = ReturnType<typeof createAiRuntime>;
