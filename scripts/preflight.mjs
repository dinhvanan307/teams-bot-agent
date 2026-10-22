import { readFileSync } from 'node:fs';
import { getConfig } from '../dist/config.js';
import { createAiRuntime } from '../dist/ai/runtime-settings.js';
import { shutdownTimeout } from '../dist/lifecycle.js';
try {
  const tested = readFileSync(new URL('../.nvmrc', import.meta.url), 'utf8').trim();
  if (process.versions.node !== tested) throw new Error();
  getConfig(); shutdownTimeout();
  const status = createAiRuntime().readiness();
  console.log(JSON.stringify({ ok: true, node: process.version, ...status, externalAPIsChecked: false }));
} catch {
  console.error('Preflight thất bại: kiểm tra Node theo .nvmrc, config, quyền file, khóa, state và AI_REQUIRE_ENABLED. Không có API ngoài nào được kiểm tra.');
  process.exitCode = 1;
}
