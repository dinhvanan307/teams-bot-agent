import { createOutgoingWebhookServer, getWebhookConfig } from './outgoing-webhook.js';

try {
  const config = getWebhookConfig();
  const server = createOutgoingWebhookServer(config);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, '127.0.0.1', resolve);
  });
  console.log(`Fiin Demo: http://127.0.0.1:${config.port}/api/outgoing-webhook — xác thực HMAC bật.`);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => server.close(() => process.exit(0)));
  }
} catch (error) {
  console.error(error instanceof Error && /^(TEAMS_WEBHOOK_SECRET|TENANT_ID|PORT)/.test(error.message)
    ? error.message : 'Không khởi động được webhook. Kiểm tra cổng đang sử dụng và cấu hình.');
  process.exitCode = 1;
}
