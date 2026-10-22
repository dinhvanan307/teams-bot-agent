import { createAiRuntime } from './ai/runtime-settings.js';
import { createPreviewServer } from './preview-server.js';

try {
  const server = createPreviewServer(undefined, undefined, createAiRuntime());
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(3980, '127.0.0.1', resolve);
  });
  console.log('Bản xem thử trên máy: http://127.0.0.1:3980 — chưa xác minh kết nối Teams.');
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => server.close(() => process.exit(0)));
} catch (error) {
  console.error(error instanceof Error && error.message.startsWith('Cấu hình AI:')
    ? error.message : 'Không khởi động được preview. Kiểm tra cổng 3980 và cấu hình.');
  process.exitCode = 1;
}
