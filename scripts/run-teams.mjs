import { spawn } from 'node:child_process';
import { accessSync } from 'node:fs';

if (!process.env.DEV_TUNNEL_ID || !process.env.CLIENT_ID || !process.env.CLIENT_SECRET || !process.env.TENANT_ID) {
  console.error('Thiếu cấu hình .env. Đăng ký bot và Dev Tunnels trước.'); process.exit(1);
}
accessSync('.tools/devtunnel/devtunnel');
accessSync('dist/index.js');
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 1000).unref();
}
function start(command, args, env) {
  const child = spawn(command, args, { stdio: 'inherit', env });
  children.push(child);
  child.once('error', () => { console.error('Không khởi chạy được bot hoặc tunnel.'); stop(1); });
  child.once('exit', code => stop(code ?? 1));
  return child;
}
const bot = start(process.execPath, ['--env-file=.env', 'dist/index.js'], process.env);
let ready = false;
for (let attempt = 0; attempt < 50; attempt++) {
  if (stopping || bot.exitCode !== null) break;
  try {
    const response = await fetch(`http://127.0.0.1:${process.env.PORT ?? 3978}/healthz`, { signal: AbortSignal.timeout(500) });
    ready = response.ok && (await response.json()).app === 'fiin-team-bot';
    if (ready) break;
  } catch {}
  await new Promise(resolve => setTimeout(resolve, 200));
}
if (!ready || stopping) stop(1);
else {
  // Tunnel không cần client secret của bot.
  const tunnelEnv = { ...process.env };
  delete tunnelEnv.CLIENT_SECRET;
  start('.tools/devtunnel/devtunnel', ['host', process.env.DEV_TUNNEL_ID], tunnelEnv);
  console.log('Giữ cửa sổ này mở khi thử trên Teams. Ctrl+C dừng bot và tunnel.');
}
process.once('SIGINT', () => stop());
process.once('SIGTERM', () => stop());
