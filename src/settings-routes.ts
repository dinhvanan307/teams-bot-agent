import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { SettingsError, type AiRuntime } from './ai/runtime-settings.js';

// This console is intentionally loopback-only. Teams JWTs do not authorize admin operations.
export function isLocalRequest(request: IncomingMessage): boolean {
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '')) return false;
  try {
    const host = new URL(`http://${request.headers.host}`);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host.hostname) || Number(host.port || 80) !== request.socket.localPort) return false;
    if (request.headers.origin && request.headers.origin !== host.origin) return false;
    if (request.headers['sec-fetch-site'] === 'cross-site') return false;
    return true;
  } catch { return false; }
}
export async function readJsonBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > 128 * 1024) throw new SettingsError('Yêu cầu quá lớn.', 413);
    chunks.push(bytes);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new SettingsError('Yêu cầu JSON không hợp lệ.'); }
}
export function sendJson(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(value));
}
export async function handleSettings(request: IncomingMessage, response: ServerResponse, token: string, runtime?: AiRuntime): Promise<boolean> {
  const path = request.url;
  if (path !== '/settings' && path !== '/settings.js' && !path?.startsWith('/api/settings')) return false;
  if (!runtime) { response.writeHead(404).end(); return true; }
  try {
    if (request.method === 'GET' && (path === '/settings' || path === '/settings.js')) {
      const html = path === '/settings';
      const content = await readFile(new URL(`../public/settings.${html ? 'html' : 'js'}`, import.meta.url), 'utf8');
      response.setHeader('Content-Type', html ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8');
      response.end(html ? content.replaceAll('__TOKEN__', token) : content);
      return true;
    }
    if (request.headers['x-preview-token'] !== token) { sendJson(response, 403, { error: 'Phiên quản trị không hợp lệ. Tải lại trang.' }); return true; }
    if (request.method === 'GET' && path === '/api/settings') sendJson(response, 200, runtime.view());
    else if (request.method === 'POST' && ['/api/settings/save', '/api/settings/test', '/api/settings/disable', '/api/settings/clear'].includes(path ?? '')) {
      if (!request.headers['content-type']?.startsWith('application/json')) throw new SettingsError('Cần gửi JSON.');
      const body = await readJsonBody(request);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new SettingsError('Yêu cầu không hợp lệ.');
      const result = path === '/api/settings/test' ? await runtime.test(body.config, body.revision)
        : path === '/api/settings/save' ? runtime.save(body.config, body.revision)
        : path === '/api/settings/disable' ? runtime.disable(body.revision) : runtime.clear(body.revision);
      sendJson(response, 200, result);
    } else response.writeHead(404).end();
  } catch (error) {
    sendJson(response, error instanceof SettingsError ? error.status : 500,
      { error: error instanceof SettingsError ? error.message : 'Không xử lý được cấu hình AI.' });
  }
  return true;
}
