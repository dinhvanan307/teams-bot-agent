const form = document.querySelector('#settings-form');
const fields = document.querySelector('#fields');
const feedback = document.querySelector('#feedback');
const token = document.querySelector('meta[name="preview-token"]').content;
const defaults = { openai: 'https://api.openai.com/v1', gemini: 'https://generativelanguage.googleapis.com/v1beta', anthropic: 'https://api.anthropic.com/v1', 'openai-compatible': '' };
const hints = {
  'openai-compatible': 'Dùng cho dịch vụ hỗ trợ chuẩn Chat Completions và Bearer API key.',
  openai: 'Gọi Responses API. Model và key phải có quyền sử dụng API này.',
  gemini: 'Gọi API GenerateContent gốc của Google Gemini.',
  anthropic: 'Gọi Messages API gốc của Anthropic Claude.',
};
const numeric = ['timeoutMs', 'maxOutputTokens', 'maxInputChars', 'dailyRequestLimit', 'userRequestsPerMinute', 'maxConcurrent'];
let saved, busy = false;
const field = name => form.elements.namedItem(name);
function message(text, tone = '') { feedback.textContent = text; feedback.className = tone; }
function updateProvider() {
  const provider = field('provider').value;
  document.querySelector('#provider-hint').textContent = hints[provider];
  document.querySelector('#chat-options').hidden = provider !== 'openai-compatible';
  document.querySelector('#anthropic-options').hidden = provider !== 'anthropic';
  field('maxOutputTokens').min = provider === 'openai' ? '16' : '1';
}
const normalized = value => { try { return new URL(value).href.replace(/\/+$/, ''); } catch { return value; } };
function updateKeyHint() {
  const canKeep = saved?.hasKey && saved.provider === field('provider').value && normalized(saved.baseUrl) === normalized(field('baseUrl').value);
  field('apiKey').required = !canKeep;
  field('apiKey').placeholder = canKeep ? 'Để trống để giữ key đang lưu' : 'Nhập key cho kết nối này';
  document.querySelector('#key-hint').textContent = canKeep
    ? `Key hiện tại: ${saved.apiKeyMasked}. Để trống để giữ key. Key được lưu mã hóa trên máy chủ.`
    : 'Cần nhập key cho kết nối này. Khi đổi kiểu API hoặc URL, key cũ không được tự dùng lại.';
}
function fill(value) {
  saved = value;
  for (const input of form.querySelectorAll('[name]')) input.value = input.name === 'apiKey' ? '' : String(value[input.name] ?? '');
  document.querySelector('#current').textContent = value.hasKey
    ? `${value.provider} · ${value.model} · ${value.source === 'saved' ? 'Cấu hình đã lưu' : 'Biến môi trường'}` : 'Chưa có kết nối. Điền thông tin bên dưới để bắt đầu.';
  const badge = document.querySelector('#badge');
  badge.textContent = value.enabled ? 'AI đang bật' : 'AI đang tắt';
  badge.className = value.enabled ? 'badge on' : 'badge';
  document.querySelector('#disable').disabled = !value.enabled;
  document.querySelector('#clear').disabled = !value.hasKey;
  updateProvider(); updateKeyHint();
}
async function request(path, body) {
  const response = await fetch(path, { method: body ? 'POST' : 'GET', headers: { 'X-Preview-Token': token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Không xử lý được yêu cầu.');
  return result;
}
async function run(action) {
  if (busy) return;
  busy = true; fields.disabled = true; document.querySelector('#reload').disabled = true;
  try { await action(); }
  catch (error) { message(error instanceof Error ? error.message : 'Không kết nối được trang quản trị.', 'error'); }
  finally { busy = false; fields.disabled = !saved; document.querySelector('#reload').disabled = false; }
}
function draft() {
  const result = {};
  // Read named inputs directly: FormData excludes a disabled fieldset during a request.
  for (const input of form.querySelectorAll('[name]')) result[input.name] = numeric.includes(input.name) ? Number(input.value) : input.value;
  return result;
}
field('provider').addEventListener('change', () => {
  field('baseUrl').value = defaults[field('provider').value]; field('model').value = ''; field('apiKey').value = '';
  field('anthropicWorkspaceId').value = ''; updateProvider(); updateKeyHint(); message('Đã đổi kiểu API. Nhập model và key tương ứng.');
});
field('baseUrl').addEventListener('input', () => { field('apiKey').value = ''; updateKeyHint(); });
form.addEventListener('input', () => { if (!busy) message('Có thay đổi chưa lưu.'); });
document.querySelector('#test').addEventListener('click', () => {
  if (!form.reportValidity()) return;
  const config = draft();
  run(async () => { message('Đang kiểm tra API…'); const result = await request('/api/settings/test', { config, revision: saved.revision }); message(result.message, 'success'); });
});
form.addEventListener('submit', event => {
  event.preventDefault(); if (!form.reportValidity()) return;
  const config = draft();
  run(async () => { fill(await request('/api/settings/save', { config, revision: saved.revision })); message('Đã lưu và bật AI. Áp dụng từ câu hỏi tiếp theo.', 'success'); });
});
document.querySelector('#disable').addEventListener('click', () => run(async () => {
  fill(await request('/api/settings/disable', { revision: saved.revision })); message('Đã tắt AI. Bot chuyển về phản hồi thử; kết nối được giữ để bật lại.', 'success');
}));
document.querySelector('#clear').addEventListener('click', () => {
  if (!confirm('Xóa kết nối AI đã lưu và tắt AI? Thao tác này không tự bật lại key trong biến môi trường.')) return;
  run(async () => { fill(await request('/api/settings/clear', { revision: saved.revision })); message('Đã xóa kết nối đã lưu và tắt AI.', 'success'); });
});
document.querySelector('#reload').addEventListener('click', () => run(async () => { fill(await request('/api/settings')); message('Đã tải lại cấu hình đang lưu.'); }));
run(async () => fill(await request('/api/settings')));
