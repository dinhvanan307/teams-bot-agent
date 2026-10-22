import { stripMentionsText, type IMessageActivity } from '@microsoft/teams.api';
import type { AiAssistant } from './ai/service.js';

export const HELP = 'Xin chào! Tôi là Fiin Team Bot, bản thử kết nối Microsoft Teams.\n\n' +
  '• help — hướng dẫn\n• ping — kiểm tra kết nối\n• count — số tin nhắn thử trong hội thoại\n• reset — đặt lại bộ đếm\n\n' +
  'Trong kênh hoặc nhóm chat, hãy @Fiin Team Bot trước câu hỏi. Bot hiện phản hồi lại tin nhắn; chưa kết nối AI hoặc dữ liệu FiinGroup.';

export function createMessageHandler(source?: AiAssistant | (() => AiAssistant | undefined)) {
  const helpFor = (ai?: AiAssistant) => ai ? HELP.replace('bản thử kết nối Microsoft Teams', 'trợ lý AI trên Microsoft Teams')
    .replace('Bot hiện phản hồi lại tin nhắn; chưa kết nối AI hoặc dữ liệu FiinGroup.',
      'AI đang bật: câu hỏi được gửi tới API đã cấu hình. Mỗi câu hỏi được xử lý độc lập; chưa kết nối dữ liệu nội bộ FiinGroup. Reset chỉ xóa bộ đếm.') : HELP;
  // Chỉ giữ bộ đếm trong RAM, không lưu nội dung tin nhắn. Giới hạn số hội thoại.
  const counts = new Map<string, number>();
  return async (activity: IMessageActivity, send: (text: string) => Promise<unknown>) => {
    const personal = activity.conversation.conversationType === 'personal';
    const mentioned = activity.entities?.some((entity) =>
      entity.type === 'mention' && entity.mentioned?.id === activity.recipient.id);
    if (!personal && !mentioned) return;

    const text = (stripMentionsText(activity, { accountId: activity.recipient.id }) ?? '').trim();
    const command = text.replace(/^\//, '').toLowerCase();
    const key = `${activity.channelData?.tenant?.id ?? ''}:${activity.conversation.id}`;
    let ai: AiAssistant | undefined;
    // Keep local diagnostics usable when saved AI settings cannot be read.
    if (!['ping', 'count', 'reset'].includes(command)) {
      try { ai = typeof source === 'function' ? source() : source; }
      catch { await send('Không đọc được cấu hình AI. Vui lòng liên hệ quản trị; câu hỏi chưa được gửi tới API.'); return; }
    }
    if (!text || ['help', 'hi', 'hello', 'xin chào'].includes(command)) {
      await send(helpFor(ai));
    } else if (command === 'ping') {
      await send('Pong! Fiin Team Bot đã nhận được tin nhắn của bạn.');
    } else if (command === 'count') {
      await send(`Hội thoại này có ${counts.get(key) ?? 0} tin nhắn thử. Bộ đếm đặt lại khi bot khởi động lại.`);
    } else if (command === 'reset') {
      counts.delete(key);
      await send('Đã đặt lại bộ đếm của hội thoại này.');
    } else {
      const count = (counts.get(key) ?? 0) + 1;
      counts.delete(key);
      if (counts.size >= 1000) counts.delete(counts.keys().next().value!);
      counts.set(key, count);
      // Quota follows the authenticated Teams user across conversations, not a client-selected thread ID.
      const userKey = JSON.stringify([activity.channelData?.tenant?.id ?? '', activity.from.id]);
      const reply = ai ? await ai.answer(text, userKey)
        : `[${count}] Tôi đã nhận: ${text.slice(0, 2000)}\n\nĐây là phản hồi thử kết nối. Gửi help để xem các lệnh.`;
      // Gửi bằng textFormat=plain ở lớp Teams để nội dung người dùng không thành mention/HTML.
      await send(reply);
    }
  };
}
