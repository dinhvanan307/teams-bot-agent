import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { IMessageActivity } from '@microsoft/teams.api';
import type { AiConfig } from './ai/config.js';
import { createAiService, type AiAssistant } from './ai/service.js';
import { createMessageHandler } from './bot.js';
import type { AiRuntime } from './ai/runtime-settings.js';
import { handleSettings, isLocalRequest, readJsonBody, sendJson } from './settings-routes.js';

export function createPreviewServer(aiConfig?: AiConfig, ai?: AiAssistant, runtime?: AiRuntime) {
  const handleMessage = createMessageHandler(runtime ? () => runtime.assistant() : ai ?? (aiConfig ? createAiService(aiConfig) : undefined));
  const token = randomUUID();
  function status() {
    try {
      const config = runtime ? runtime.currentConfig() : aiConfig;
      return { enabled: !!config, maxInputChars: config?.maxInputChars ?? 2000, notice: config
        ? 'AI đang bật. Câu hỏi được gửi tới API đã cấu hình; mỗi câu hỏi được xử lý độc lập. Chưa kết nối dữ liệu nội bộ FiinGroup.'
        : 'AI đang tắt. Bot chỉ phản hồi lại tin nhắn thử; chưa gửi nội dung tới API AI hoặc dữ liệu FiinGroup.' };
    } catch { return { enabled: false, maxInputChars: 2000, notice: 'Cấu hình AI đang lỗi. Liên hệ quản trị để kiểm tra; câu hỏi chưa được gửi tới API.' }; }
  }
  return createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'self' 'nonce-${token}'; style-src 'nonce-${token}'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`);
    try {
      if (!isLocalRequest(request)) { response.writeHead(403).end(); return; }
      if (await handleSettings(request, response, token, runtime)) return;
      if (request.method === 'GET' && request.url === '/api/preview/status') {
        if (request.headers['x-preview-token'] !== token) { response.writeHead(403).end(); return; }
        sendJson(response, 200, status()); return;
      }
      if (request.method === 'GET' && request.url === '/') {
        const current = status();
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        const html = await readFile(new URL('../public/preview.html', import.meta.url), 'utf8');
        response.end(html.replaceAll('__TOKEN__', token).replace('__AI_NOTICE__', current.notice)
          .replace('__MAX_INPUT__', String(current.maxInputChars)));
        return;
      }
      if (request.method !== 'POST' || request.url !== '/api/preview') { response.writeHead(404).end(); return; }
      if (request.headers['x-preview-token'] !== token) { response.writeHead(403).end(); return; }
      const { text, conversationId } = await readJsonBody(request);
      if (typeof text !== 'string' || typeof conversationId !== 'string' || !conversationId || conversationId.length > 100) {
        response.writeHead(400).end(); return;
      }
      const replies: string[] = [];
      const activity = {
        type: 'message', id: randomUUID(), channelId: 'msteams', serviceUrl: 'http://127.0.0.1',
        from: { id: 'local-user' }, recipient: { id: 'local-bot' },
        conversation: { id: conversationId, conversationType: 'personal' }, text,
      } as IMessageActivity;
      await handleMessage(activity, async reply => { replies.push(reply); });
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ replies }));
    } catch { if (!response.headersSent) response.writeHead(400).end('Yêu cầu không hợp lệ.'); }
  });
}
