import { createApplication } from './app.js';
import { getConfig } from './config.js';
import { createAiRuntime } from './ai/runtime-settings.js';
import { shutdownTimeout } from './lifecycle.js';

try {
  const config = getConfig();
  const graceMs = shutdownTimeout();
  const runtime = createAiRuntime();
  runtime.readiness();
  const { server, lifecycle } = await createApplication(config, undefined, runtime);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, process.env.BOT_HOST ?? '127.0.0.1', resolve);
  });
  console.log(`Fiin Team Bot đang chạy tại http://127.0.0.1:${config.port}; endpoint /api/messages, xác thực Teams bật.`);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, async () => {
      console.info(JSON.stringify({ event: 'shutdown_started', signal, active: lifecycle.active }));
      const { drained } = await lifecycle.shutdown(graceMs);
      console.info(JSON.stringify({ event: 'shutdown_finished', drained }));
      process.exit(drained ? 0 : 1);
    });
  }
} catch (error) {
  console.error(error instanceof Error && /Chưa đăng ký|phải là UUID|PORT không hợp lệ|^Cấu hình AI:|^Cấu hình secret:|^Production cần|^SHUTDOWN_TIMEOUT_MS/.test(error.message)
    ? error.message : 'Không khởi động được bot. Kiểm tra cấu hình và cổng đang sử dụng.');
  process.exitCode = 1;
}
