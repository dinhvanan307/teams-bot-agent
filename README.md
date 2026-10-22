# Teams Bot Agent

Baseline gói 1 phiên bản **0.2.0**. Bộ release, vận hành và bảo vệ secret đã được bổ sung; host thật và tích hợp Teams/AI thật vẫn **NOT_TESTED**. Host/OS chưa chốt.

- [Triển khai và vận hành](docs/DEPLOYMENT.md)
- [Kế hoạch nghiệm thu tích hợp](docs/INTEGRATION-PLAN.md)
- [Lịch sử thay đổi](CHANGELOG.md)
- [Báo cáo chi tiết gói 1 ngày 22/10/2026](docs/reports/Bao_cao_hoan_thien_goi_1_Teams_Bot_Agent_22-10-2026.md)
- [Bằng chứng kiểm thử local](docs/evidence/local-verification.json), [smoke release](docs/evidence/release-smoke.json) và [GitHub CI baseline](docs/evidence/github-ci.json)

Repository riêng: `dinhvanan307/teams-bot-agent`. Dùng Node trong `.nvmrc` cho baseline đã kiểm thử.

Ngày 21/10/2026: đã gỡ hai bot, app Developer Portal, đăng ký Entra và service principal của lần thử trên tài khoản công ty. Server đã dừng; danh sách Dev Tunnels đã được kiểm tra là trống. Các file cấu hình thật, gói cài và ảnh chụp của lần thử đã được xoá.

`teams-bot` là codebase phát triển chính. Backend và preview dùng chung handler; có thể bật AI bằng cấu hình. Chưa đăng ký lại Microsoft hoặc triển khai endpoint công ty trong lần cập nhật này.

## Masterplan sản phẩm và bàn giao

[Masterplan FTB-MP-001 v1.0](docs/MASTERPLAN.md) chốt phạm vi trợ lý Teams kết nối Outlook và app nội bộ, baseline source, các giai đoạn triển khai, backlog, tiêu chí nghiệm thu, kịch bản demo và hồ sơ bàn giao. Đây là kế hoạch phát triển; các chức năng dự kiến trong tài liệu chưa được coi là đã triển khai. Hệ điều hành và cách chạy trên VPS được lựa chọn cùng IT trước khi triển khai.

## Demo trên máy

```sh
npm ci
npm run preview
```

Yêu cầu Node.js >=22.12.0. Mở http://127.0.0.1:3980. Khi chưa có cấu hình đã lưu và `AI_ENABLED=false`, giao diện chỉ thử lệnh/echo cục bộ, không kết nối Teams hay gọi API AI.

## Kết nối AI bằng giao diện

Mở [Cấu hình kết nối AI](http://127.0.0.1:3980/settings):

1. Chọn kiểu API: OpenAI-compatible/Gateway, OpenAI Responses, Google Gemini hoặc Anthropic Claude.
2. Nhập Base URL, model và API key. Với ba API gốc, giao diện điền sẵn URL khi đổi lựa chọn; gateway cần URL được bên cung cấp hướng dẫn.
3. Bấm **Kiểm tra kết nối** để thử chính bản đang nhập. Thao tác này chưa lưu hoặc bật AI. Kiểm tra dùng câu hỏi mẫu, tối đa 10 giây và 200 token đầu ra (hoặc mức đang cấu hình nếu thấp hơn), không retry, tối đa 5 lần/phút, 1 lần đồng thời trong tiến trình preview. Có thể phát sinh phí riêng ngoài hạn mức chat; model suy luận có thể cần đầu ra lớn hơn để trả văn bản.
4. Bấm **Lưu và bật AI**, rồi trở lại chat để thử. Cấu hình lưu nguyên bộ; Teams/preview áp dụng từ câu hỏi tiếp theo, không cần restart. Lượt đang chạy hoàn tất với cấu hình cũ. Đổi model không đặt lại hạn mức đang giữ trong tiến trình.

Mở **Hướng dẫn trả lời và giới hạn** để sửa prompt, timeout, token đầu ra và hạn mức. Key được che khi tải lại; để trống giữ key chỉ khi kiểu API và URL vẫn khớp. Đổi kiểu API/URL bắt buộc nhập key rõ ràng. **Tắt AI, giữ kết nối** chuyển về echo; **Xóa kết nối đã lưu** bỏ thông tin kết nối và tắt AI, không tự kích hoạt lại key từ biến môi trường. Bật lại bằng cách lưu form.

Cách tổ chức kế thừa mẫu cấu hình runtime của Zalo Order Agent: form → kiểm tra → lưu mã hóa → đọc cấu hình mỗi lượt → adapter AI. Teams vẫn dùng bốn adapter HTTP sẵn có, bao gồm OpenAI Responses; không mang theo DB, cookie, tài khoản, agent loop hoặc tool nghiệp vụ của Zalo.

## Lưu cấu hình và quản trị trên host

- Cấu hình đã lưu ưu tiên **toàn bộ profile** so với biến môi trường. Chưa có file lưu mới dùng `AI_*`. Thay biến môi trường cần restart tiến trình và không ghi đè profile đã lưu. Không trộn key/URL của hai nguồn. File hỏng hoặc khóa giải mã sai làm AI ngừng gọi API, không tự chuyển sang credential khác.
- Development mặc định lưu trong `.state`: `ai-settings.enc` mã hóa AES-256-GCM và `ai-settings.key` tự sinh lần đầu nếu không có khóa môi trường. File quyền `0600`, thư mục mới `0700`; đã được Git ignore. Không lưu nội dung chat. Key đặt cùng máy không bảo vệ khỏi người có quyền đọc cả file dữ liệu lẫn file khóa.
- Khi host/container, đặt `AI_SETTINGS_DIR` là đường dẫn tuyệt đối tới volume bền vững dùng chung bởi Teams và trang quản trị. Khi `NODE_ENV=production`, bắt buộc cấp `AI_SETTINGS_ENCRYPTION_KEY` (32 byte, 64 ký tự hex) hoặc file `_FILE` bằng cơ chế secret riêng; cả hai tiến trình phải dùng cùng khóa. Backup/khôi phục phải giữ đúng file dữ liệu và khóa. Không đổi khóa trực tiếp khi còn profile đã mã hóa; hiện chưa có cơ chế xoay khóa. Không đưa các file này vào ZIP Teams hoặc Git.
- Trang quản trị chỉ có trong tiến trình `npm run preview`, bind cố định `127.0.0.1:3980`. Kiểm tra địa chỉ loopback, Host/Origin và token phiên cho API; không có tài khoản/SSO quản trị từ xa. Người dùng cục bộ hoặc có SSH vào máy được coi là quản trị. **Không proxy công khai cổng 3980.** Backend Teams công khai không có `/settings` hoặc `/api/settings`.
- Quản trị host qua SSH: chạy preview trên host với cùng thư mục/khóa cấu hình của backend, mở `ssh -L 3980:127.0.0.1:3980 user@host`, rồi vào `http://127.0.0.1:3980/settings` trên máy cá nhân (cổng local 3980 phải trống). Khi đóng preview, backend vẫn đọc cấu hình đã lưu. Chạy một tiến trình quản trị ghi cấu hình; form cũ bị chặn bằng revision để tránh ghi đè thay đổi từ tab khác.

## Cấu hình ban đầu bằng biến môi trường (tùy chọn)

Sao chép `.env.example` thành `.env` nếu chưa có file cấu hình; không ghi đè file đang chứa credential. Điền nhóm AI và khởi động lại `npm run preview`. Preview không cần `CLIENT_ID`, `CLIENT_SECRET` hoặc `TENANT_ID`.

```dotenv
AI_ENABLED=true
AI_PROVIDER=openai-compatible
AI_BASE_URL=https://gateway.example.com/v1
AI_MODEL=<model được API/gateway của bạn hỗ trợ>
AI_API_KEY=<key của API/gateway đó>
```

URL và model trên là chỗ điền mẫu, không phải dịch vụ để gọi thử. Key, model, chuẩn API và URL phải thuộc cùng cấu hình. Ứng dụng không đoán nhà cung cấp từ key và không dò key bằng cách gửi tới nhiều dịch vụ.

| `AI_PROVIDER` | Giao thức | `AI_BASE_URL` mặc định |
| --- | --- | --- |
| `openai` | Responses (`/responses`) | `https://api.openai.com/v1` |
| `openai-compatible` | Chat Completions (`/chat/completions`) | Bắt buộc tự điền |
| `gemini` | GenerateContent (`/models/{model}:generateContent`) | `https://generativelanguage.googleapis.com/v1beta` |
| `anthropic` | Messages (`/messages`) | `https://api.anthropic.com/v1` |

Với OpenAI, Gemini hoặc Anthropic trực tiếp, chọn provider, điền model/key và để `AI_BASE_URL` trống. Khi chuyển khỏi gateway, phải xóa hoặc đổi URL cũ để key mới không được gửi nhầm. Với API tương thích/gateway, dùng URL gốc theo tài liệu của bên cung cấp, gồm đường dẫn con và phiên bản nếu có, không thêm endpoint cuối. URL dùng HTTPS; HTTP chỉ được chấp nhận cho localhost để thử máy chủ nội bộ trên máy.

`openai-compatible` hỗ trợ API chat văn bản dùng Bearer key và định dạng Chat Completions, không phải mọi API có key. API yêu cầu OAuth, chữ ký cloud, header riêng hoặc định dạng khác cần adapter bổ sung. Model chỉ hỗ trợ hình/âm thanh/embedding không dùng được trong luồng chat văn bản này.

Một số gateway/model Chat Completions dùng `max_completion_tokens`; đặt `AI_CHAT_TOKEN_PARAMETER=max_completion_tokens` khi tài liệu yêu cầu. Mặc định là `max_tokens`, không gửi cả hai và không tự retry đổi tham số. Anthropic có thể yêu cầu `AI_ANTHROPIC_WORKSPACE_ID` tùy loại key; phiên bản mặc định `2026-10-21`, có thể đổi bằng `AI_ANTHROPIC_VERSION` cho gateway tương ứng.

## Luồng và giới hạn

- `help`, `ping`, `count`, `reset` xử lý cục bộ, không gọi AI. Nhóm/kênh vẫn phải @bot.
- Câu hỏi thường đi qua service AI. Mỗi request chỉ gửi hướng dẫn hệ thống và câu hỏi hiện tại; chưa có bộ nhớ hội thoại, file, công cụ hoặc dữ liệu nghiệp vụ.
- `AI_SYSTEM_PROMPT` tùy chỉnh vai trò và cách trả lời; prompt không thay thế phân quyền dữ liệu.
- Mặc định: timeout 20 giây, tối đa 4.000 ký tự đầu vào, 1.024 token đầu ra theo tham số của API, 100 lần gọi/ngày UTC, 5 lần/người/phút, 3 request đồng thời. Các biến nằm trong `.env.example`.
- Hạn mức giữ trong RAM theo từng tiến trình, đặt lại khi restart. Người dùng Teams được giới hạn theo tenant + user ID qua các hội thoại; mọi tab preview dùng chung một user cục bộ. Lượt lỗi vẫn tính vào hạn mức; không tự gọi lại, không chuyển sang provider khác.
- Đây là giới hạn sử dụng, **chưa phải trần chi phí tiền**. Chi phí tùy model, reasoning, cache và giá của nhà cung cấp. Token usage được ghi theo trường nhà cung cấp trả về, không phải hóa đơn; riêng Gemini ghi số token candidate, chưa cộng token suy luận. Cần giới hạn spend tại nhà cung cấp/gateway; nhiều instance cần bộ đếm dùng chung trước khi vận hành chính thức.
- Log AI chỉ có request ID, trạng thái, thời gian và token counts nếu có. Không ghi câu hỏi, câu trả lời, key hoặc raw provider error. Không có database lưu chat; xử lý/lưu dữ liệu phía nhà cung cấp tuân theo chính sách của họ. OpenAI Responses được gọi với `store: false`; điều này không phải cam kết không lưu dữ liệu ở mọi lớp hạ tầng.
- Outgoing Webhook vẫn là demo echo riêng, không sử dụng lớp AI này.

## Chạy backend Teams

Điền credential Microsoft trong `.env` hoặc biến môi trường host, sau đó:

```sh
npm run build
npm start
```

Backend đọc cùng nhóm cấu hình AI; endpoint Teams là `/api/messages`. Cần môi trường Teams thử được cho phép, đăng ký bot, HTTPS/gateway và messaging endpoint hợp lệ để nghiệm thu. Việc thêm AI không tự cấp quyền, đăng ký tài nguyên, host hoặc upload Teams app. Key AI nằm ở backend, không nằm trong ZIP Teams.

## Kiểm tra

```sh
npm run build
npm test
```

Hiện có 41 test dùng key giả, kiểm tra lưu mã hóa/khôi phục, đổi cấu hình khi đang chạy, key/URL, quyền truy cập trang quản trị, mock API của bốn giao thức và HTTP localhost để kiểm tra preview → handler → API → trả lời, xác thực Teams, mention, lỗi/timeout và hạn mức. Không gọi model thật. Cần test tiếp với API/model có quyền sử dụng và Teams thật trước khi xác nhận tích hợp thành công.

Gói 1 bổ sung `/readyz`, shutdown có thời hạn, `_FILE` cho secret và production policy. Xem runbook trước khi host; hướng dẫn tự sinh khóa ở trên chỉ áp dụng development. Chạy build trước test vì các script vận hành được test trên bản compiled.

Các phần chính: `src/ai/config.ts` (cấu hình), `client.ts` (adapter HTTP), `prompt.ts` (hướng dẫn), `service.ts` (điều phối/hạn mức), `runtime-settings.ts` (lưu/nạp/kiểm tra cấu hình), `src/settings-routes.ts` và `public/settings.*` (trang quản trị cục bộ), `src/bot.ts` (handler dùng chung).

## Tài liệu API đối chiếu

- [OpenAI Responses](https://developers.openai.com/api/reference/resources/responses/methods/create), [Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).
- [Gemini GenerateContent](https://ai.google.dev/gemini-api/docs/generate-content/text-generation).
- [Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create), [authentication](https://platform.claude.com/docs/en/api/overview), [API versions](https://platform.claude.com/docs/en/api/versioning).

Các file `.env.example` và `.env.webhook.example` không chứa credential thật. Muốn tích hợp Teams về sau cần một môi trường thử riêng và yêu cầu triển khai mới.

Chi tiết xác nhận gỡ tài nguyên nằm trong hồ sơ cleanup trong workspace cũ (không đóng gói vào repository này). Lệnh đăng xuất Teams CLI đã bị từ chối, nên chưa xác nhận xoá phiên đăng nhập CLI và Dev Tunnels.
