import { randomUUID } from 'node:crypto';
import type { AiConfig } from './config.js';
import { AiError, createAiClient, type AiClient } from './client.js';

export interface AiAssistant {
  answer(text: string, userKey: string): Promise<string>;
}

// Shared across configuration reloads; changing a model must not reset quotas.
export const createAiUsageState = () => ({
  active: 0, day: '', dailyRequests: 0,
  users: new Map<string, { resetAt: number; count: number }>(),
});

export function createAiService(config: AiConfig, options: {
  client?: AiClient;
  now?: () => number;
  log?: (event: Record<string, string | number>) => void;
  usage?: ReturnType<typeof createAiUsageState>;
} = {}): AiAssistant {
  const client = options.client ?? createAiClient(config);
  const now = options.now ?? Date.now;
  const log = options.log ?? ((event) => console.info(JSON.stringify(event)));
  const usageState = options.usage ?? createAiUsageState();
  const { users } = usageState;

  return { async answer(text, userKey) {
    text = text.trim();
    if (!text) return 'Bạn hãy nhập câu hỏi.';
    if (text.length > config.maxInputChars) return `Câu hỏi quá dài. Vui lòng giới hạn trong ${config.maxInputChars} ký tự.`;
    const start = now();
    const today = new Date(start).toISOString().slice(0, 10);
    if (usageState.day !== today) { usageState.day = today; usageState.dailyRequests = 0; }
    if (usageState.dailyRequests >= config.dailyRequestLimit) return 'Đã đạt giới hạn lượt gọi AI trong ngày. Vui lòng thử lại ngày sau hoặc liên hệ quản trị.';
    if (usageState.active >= config.maxConcurrent) return 'Bot đang xử lý nhiều câu hỏi. Bạn thử lại sau ít giây nhé.';
    for (const [key, usage] of users) if (usage.resetAt <= start) users.delete(key);
    const usage = users.get(userKey) ?? { resetAt: start + 60000, count: 0 };
    if (usage.count >= config.userRequestsPerMinute) return 'Bạn đang gửi câu hỏi quá nhanh. Vui lòng chờ khoảng một phút.';
    // Fail closed rather than evicting active limits when many distinct users arrive.
    if (!users.has(userKey) && users.size >= 10000) return 'Bot đang bận. Bạn thử lại sau ít giây nhé.';
    usage.count++;
    users.set(userKey, usage);
    usageState.dailyRequests++;
    usageState.active++;
    // Reserve synchronously before awaiting; failures still consume the request allowance.
    const requestId = randomUUID();
    try {
      const result = await client.generate(text);
      log({ event: 'ai_completed', requestId, durationMs: now() - start,
        ...(result.inputTokens === undefined ? {} : { inputTokens: result.inputTokens }),
        ...(result.outputTokens === undefined ? {} : { outputTokens: result.outputTokens }) });
      return result.text.length > 12000
        ? `${result.text.slice(0, 12000)}\n\n[Phản hồi đã được rút gọn. Hãy yêu cầu một câu trả lời ngắn hơn.]` : result.text;
    } catch (error) {
      const code = error instanceof AiError ? error.code : 'unavailable';
      log({ event: 'ai_failed', requestId, code, durationMs: now() - start });
      const messages: Record<string, string> = {
        timeout: 'AI phản hồi quá thời gian chờ. Bạn có thể thử lại sau.',
        auth: 'Cấu hình xác thực AI chưa hợp lệ. Vui lòng liên hệ quản trị.',
        rate_limit: 'API AI đang giới hạn lượt gọi hoặc đã hết quota. Vui lòng thử lại sau hoặc liên hệ quản trị.',
        configuration: 'Model hoặc cấu hình API chưa phù hợp. Vui lòng liên hệ quản trị.',
        empty: 'AI chưa trả về nội dung có thể hiển thị. Bạn hãy thử diễn đạt lại câu hỏi.',
        unavailable: 'Dịch vụ AI tạm thời không phản hồi được. Vui lòng thử lại sau.',
      };
      return `${messages[code] ?? messages.unavailable}\nMã tra cứu: ${requestId}`;
    } finally { usageState.active--; }
  } };
}
