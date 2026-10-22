import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer, type ServerResponse } from 'node:http';

export function getWebhookConfig(env: NodeJS.ProcessEnv = process.env) {
  const secret = env.TEAMS_WEBHOOK_SECRET?.trim() ?? '';
  const key = Buffer.from(secret, 'base64');
  if (!secret || key.length < 16 || key.toString('base64') !== secret) {
    throw new Error('TEAMS_WEBHOOK_SECRET phải là security token Base64 do Teams cấp khi tạo Outgoing Webhook.');
  }
  const tenantId = env.TENANT_ID ?? '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) {
    throw new Error('TENANT_ID phải là UUID của công ty.');
  }
  const port = Number(env.PORT ?? 3978);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT không hợp lệ.');
  return { key, tenantId, port };
}

function json(response: ServerResponse, status: number, body: object) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

export function createOutgoingWebhookServer(config: ReturnType<typeof getWebhookConfig>) {
  return createServer({ requestTimeout: 5000, headersTimeout: 5000 }, async (request, response) => {
    if (request.method === 'GET' && request.url === '/healthz') {
      json(response, 200, { ok: true, app: 'fiin-demo-webhook', mode: 'outgoing-webhook' });
      return;
    }
    if (request.method !== 'POST' || request.url !== '/api/outgoing-webhook') {
      json(response, 404, { error: 'Not found' }); return;
    }
    // Xác thực trên đúng byte nhận từ Teams, trước khi parse JSON.
    const signature = /^HMAC ([A-Za-z0-9+/]{43}=)$/i.exec(request.headers.authorization ?? '');
    if (!signature) { json(response, 401, { error: 'Unauthorized' }); return; }
    if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      json(response, 415, { error: 'Expected application/json' }); return;
    }
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 65536) { json(response, 413, { error: 'Payload too large' }); return; }
        chunks.push(Buffer.from(chunk));
      }
      const raw = Buffer.concat(chunks);
      const expected = createHmac('sha256', config.key).update(raw).digest();
      if (!timingSafeEqual(expected, Buffer.from(signature[1], 'base64'))) {
        json(response, 401, { error: 'Unauthorized' }); return;
      }
      const activity = JSON.parse(raw.toString('utf8'));
      if (activity?.channelData?.tenant?.id !== config.tenantId) {
        json(response, 403, { error: 'Tenant not allowed' }); return;
      }
      if (activity.type !== 'message' || activity.channelId !== 'msteams' || typeof activity.text !== 'string') {
        json(response, 400, { error: 'Expected a Teams message' }); return;
      }
      const text = activity.text.replace(/^\s*<at\b[^>]*>[\s\S]*?<\/at>\s*/i, '').trim();
      const command = text.replace(/^\//, '').toLowerCase();
      const reply = command === 'ping'
        ? 'Pong! Fiin Demo đã nhận được @mention của bạn trong Teams.'
        : !text || ['help', 'hi', 'hello', 'xin chào'].includes(command)
          ? 'Tôi là Fiin Demo. Gửi @Fiin Demo ping để kiểm tra kết nối hoặc @Fiin Demo kèm nội dung để nhận phản hồi thử. Đây là demo echo, chưa kết nối AI hay dữ liệu FiinGroup.'
          : `Tôi đã nhận: ${text.slice(0, 2000)}\n\nĐây là phản hồi thử kết nối, chưa phải câu trả lời từ AI.`;
      json(response, 200, { type: 'message', textFormat: 'plain', text: reply });
    } catch {
      if (!response.headersSent) json(response, 400, { error: 'Invalid request' });
    }
  });
}
