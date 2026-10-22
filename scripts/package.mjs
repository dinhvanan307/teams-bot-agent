import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Ajv from 'ajv-draft-04';
import addFormats from 'ajv-formats';
import { zipSync, strToU8, unzipSync } from 'fflate';

const root = fileURLToPath(new URL('../', import.meta.url));
export function createManifest(env = process.env, version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version) {
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const botId = env.CLIENT_ID;
const appId = env.TEAMS_APP_ID || botId;
if (!uuid.test(botId ?? '') || !uuid.test(appId ?? '')) {
  throw new Error('Chưa có CLIENT_ID / TEAMS_APP_ID thực. Đăng ký Microsoft trước khi đóng gói.');
}
const endpoint = new URL(env.BOT_ENDPOINT || 'http://invalid');
if (endpoint.protocol !== 'https:' || /^(localhost|invalid|127\.0\.0\.1|\[::1\])$/.test(endpoint.hostname) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
  throw new Error('BOT_ENDPOINT phải là URL HTTPS của tunnel hoặc máy chủ đã cấu hình.');
}
if (/\/api\/messages\/?$/i.test(endpoint.pathname)) throw new Error('BOT_ENDPOINT là URL gốc của ứng dụng, không gồm /api/messages.');
const base = endpoint.origin + endpoint.pathname.replace(/\/+$/, '');
const manifest = {
  $schema: 'https://developer.microsoft.com/en-us/json-schemas/teams/v1.25/MicrosoftTeams.schema.json',
  manifestVersion: '1.25', version, id: appId,
  developer: { name: 'Fiin Team Bot (thử nghiệm)', websiteUrl: base, privacyUrl: `${base}/privacy`, termsOfUseUrl: `${base}/terms` },
  icons: { color: 'color.png', outline: 'outline.png' },
  name: { short: 'Fiin Team Bot', full: 'Fiin Team Bot — thử kết nối nội bộ' },
  description: {
    short: 'Bot thử nghiệm cho Team và nhóm chat của công ty.',
    full: 'Bot thử nghiệm nội bộ hỗ trợ chat riêng, nhóm chat và kênh Team. Gửi @Fiin Team Bot help để xem chế độ hiện tại. Backend có thể cấu hình API AI hoặc chạy echo; khi AI bật, câu hỏi được gửi tới API/gateway do quản trị chọn. Chưa kết nối dữ liệu nghiệp vụ FiinGroup. Bộ đếm và hạn mức giữ tạm trong RAM.',
  },
  accentColor: '#2349A4', supportsChannelFeatures: 'tier1',
  bots: [{
    botId, scopes: ['personal', 'team', 'groupChat'], supportsFiles: false, isNotificationOnly: false,
    commandLists: [{ scopes: ['personal', 'team', 'groupChat'], commands: [
      { title: 'help', description: 'Hướng dẫn sử dụng bot thử nghiệm' },
      { title: 'ping', description: 'Kiểm tra bot có nhận tin nhắn không' },
      { title: 'count', description: 'Xem số tin nhắn thử của hội thoại' },
      { title: 'reset', description: 'Đặt lại bộ đếm hội thoại' },
    ] }],
  }],
  staticTabs: [{ entityId: 'conversations', scopes: ['personal'] }, { entityId: 'about', scopes: ['personal'] }],
  permissions: [], validDomains: [endpoint.hostname],
};
return manifest;
}

export function packageTeams({ env = process.env, outputDirectory = resolve(root, 'appPackage/build') } = {}) {
const manifest = createManifest(env);
const ajv = new Ajv({ allErrors: true, strict: false, code: { optimize: false } });
addFormats(ajv);
const validate = ajv.compile(JSON.parse(readFileSync(resolve(root, 'appPackage/MicrosoftTeams.schema.json'), 'utf8')));
if (!validate(manifest)) throw new Error(JSON.stringify(validate.errors, null, 2));
const contents = { 'manifest.json': strToU8(JSON.stringify(manifest, null, 2)) };
for (const [name, size] of [['color.png', 192], ['outline.png', 32]]) {
  const png = readFileSync(resolve(root, `appPackage/${name}`));
  if (!png.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || png.readUInt32BE(16) !== size || png.readUInt32BE(20) !== size) {
    throw new Error(`${name} phải là PNG ${size}x${size}.`);
  }
  contents[name] = png;
}
mkdirSync(outputDirectory, { recursive: true });
const zip = zipSync(contents);
const entries = Object.keys(unzipSync(zip)).sort();
if (entries.join(',') !== 'color.png,manifest.json,outline.png') throw new Error('Gói Teams có file không hợp lệ.');
writeFileSync(resolve(outputDirectory, 'manifest.json'), contents['manifest.json']);
writeFileSync(resolve(outputDirectory, 'Fiin-Team-Bot.zip'), zip);
return { manifest, path: resolve(outputDirectory, 'Fiin-Team-Bot.zip') };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(`Đã kiểm tra schema, icon và ZIP: ${packageTeams().path}`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
