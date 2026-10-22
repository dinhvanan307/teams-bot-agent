import { createServer } from 'node:http';
import { App, ExpressAdapter } from '@microsoft/teams.apps';
import { createMessageHandler } from './bot.js';
import type { getConfig } from './config.js';
import type { AiConfig } from './ai/config.js';
import { createAiService } from './ai/service.js';
import type { AiRuntime } from './ai/runtime-settings.js';
import { createLifecycle } from './lifecycle.js';
import { VERSION } from './version.js';

export async function createApplication(config: ReturnType<typeof getConfig>, aiConfig?: AiConfig, runtime?: AiRuntime) {
  const currentAi = () => runtime ? runtime.currentConfig() : aiConfig;
  const server = createServer();
  const quietLogger: App['log'] = {
    debug() {}, info() {}, warn() {}, trace() {}, log() {}, error() {},
    child() { return quietLogger; },
  };
  const adapter = new ExpressAdapter(server, { logger: quietLogger });
  let initialized = false;
  const lifecycle = createLifecycle(async () => {
    await app.stop();
    if (server.listening) throw new Error('HTTP server did not stop.');
  }, () => server.closeAllConnections());
  adapter.use((request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    if (request.path === '/api/messages' && !lifecycle.accepting) {
      response.setHeader('Retry-After', '5');
      response.status(503).json({ error: 'shutting_down' }); return;
    }
    next();
  });
  adapter.get('/healthz', (_request, response) => response.json({ ok: true, app: 'fiin-team-bot', mode: 'teams', version: VERSION }));
  adapter.get('/readyz', (_request, response) => {
    try {
      if (!initialized || !lifecycle.accepting) throw new Error();
      const status = runtime ? runtime.readiness() : { aiEnabled: !!aiConfig };
      response.json({ ok: true, app: 'fiin-team-bot', version: VERSION, ...status });
    } catch { response.status(503).json({ ok: false, reason: 'not_ready' }); }
  });
  adapter.get('/', (_request, response) => response.type('text').send('Fiin Team Bot — bản thử nghiệm. Thêm ứng dụng vào Teams và gửi @Fiin Team Bot ping.'));
  adapter.get('/privacy', (_request, response) => response.type('text').send(
    'Fiin Team Bot nhận tin nhắn bạn gửi trực tiếp hoặc @bot; không chủ động đọc lịch sử chat. Không lưu nội dung chat vào database. Bộ đếm và hạn mức chỉ giữ trong RAM. ' +
    (currentAi() ? 'AI đang bật: câu hỏi ngoài các lệnh được gửi cùng hướng dẫn hệ thống tới API AI/gateway do quản trị cấu hình. Log chỉ ghi mã truy vết, trạng thái, thời gian và token usage nếu có; không ghi nội dung chat hoặc key. ' : 'AI đang tắt: bot chỉ echo, không gửi câu hỏi tới API AI. ') +
    'Microsoft và nhà cung cấp/gateway xử lý dữ liệu theo chính sách tương ứng; ứng dụng không quyết định chính sách lưu trữ phía nhà cung cấp.'));
  adapter.get('/terms', (_request, response) => response.type('text').send(
    `Fiin Team Bot là bản thử nghiệm nội bộ. ${currentAi() ? 'Phản hồi AI có thể sai và cần được kiểm chứng; bot chưa kết nối dữ liệu nội bộ. ' : 'Phản hồi là echo thử kết nối. '}Bộ đếm/hạn mức không lưu bền; dịch vụ phụ thuộc máy chủ và kết nối API.`));

  const app = new App({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    tenantId: config.tenantId,
    logger: quietLogger,
    httpServerAdapter: adapter,
    dangerouslyAllowUnauthenticatedRequests: false,
    telemetry: { agent365: false },
  });
  const handleMessage = createMessageHandler(runtime ? () => runtime.assistant() : aiConfig ? createAiService(aiConfig) : undefined);
  app.on('message', async ({ activity, send }) => {
    if (activity.channelData?.tenant?.id !== config.tenantId) return;
    await lifecycle.run(() => handleMessage(activity, async (text) => {
      const result = await send({ type: 'message', text, textFormat: 'plain' });
      console.info(`[${new Date().toISOString()}] Đã trả lời một tin nhắn Teams.`);
      return result;
    }));
  });
  // Không ghi toàn bộ activity hoặc SDK error vì có thể chứa tin nhắn/credentials.
  app.event('error', () => console.error('Không xử lý được một lượt Teams. Kiểm tra cấu hình và kết nối Microsoft.'));
  await app.initialize();
  initialized = true;
  return { app, server, lifecycle };
}
