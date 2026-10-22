# Triển khai và vận hành gói 1

## Phạm vi và trạng thái

Host, OS, domain, tenant và cấu hình AI thật chưa được chốt. Bộ release chạy Node được chuẩn bị độc lập hệ điều hành; `deploy/teams-bot.service` và gateway Nginx là **mẫu triển khai Linux dự kiến**, chưa được nghiệm thu trên host. Windows Service chưa được cung cấp hoặc kiểm thử. Không coi kiểm thử macOS/CI là bằng chứng crash/reboot hoặc vận hành Linux/Windows thật.

Gói 1 vẫn là chat văn bản từng lượt. History, quota bền vững, dedup và phục hồi job sau crash thuộc gói 2; dừng có thời hạn không bảo đảm lưu lại công việc bị ngắt đột ngột.

## Chuẩn bị release

Tại repository độc lập, dùng đúng Node ghi trong `.nvmrc` (24.14.0 cho baseline này):

```sh
npm ci
npm run build
npm test
git status --short
npm run release
```

`release` yêu cầu source đã commit và working tree sạch, build lại `dist`, rồi tạo ZIP cùng SHA-256 tại `artifacts/`. `release.json` ghi commit, version, Node và nền tảng build. ZIP chỉ lấy danh sách file được khai báo: `dist`, `public`, cấu hình mẫu, runbook, lockfile và script vận hành; không chứa `.env` thật, state, khóa, `node_modules`, log hoặc cấu hình tài khoản thử. Node và dependencies được cài trên host đích. Không tuyên bố bộ này chạy hoàn toàn offline.

Đối chiếu SHA-256 của ZIP qua kênh tin cậy trước khi giải nén; checksum đi kèm phát hiện hỏng dữ liệu, không thay chữ ký của đơn vị phát hành. Sau khi giải nén vào thư mục release mới:

```sh
node scripts/verify-release.mjs .
npm ci --omit=dev
```

Verifier đối chiếu từng file trong `checksums.json`, từ chối đường dẫn vượt thư mục, file sửa nội dung và symlink. Thực hiện trước cài dependencies. Lưu kết quả, release ID, checksum và môi trường đích vào hồ sơ nghiệm thu. Không bỏ qua checksum mismatch.

## Cấu hình và secret

1. Production dùng `NODE_ENV=production`, thư mục state tuyệt đối được cấp riêng và khóa mã hóa 32 byte dạng 64 ký tự hex. Không tự sinh khóa local trong production.
2. Ba secret được hỗ trợ trực tiếp hoặc qua file tuyệt đối: `CLIENT_SECRET`, `AI_API_KEY`, `AI_SETTINGS_ENCRYPTION_KEY`; dùng hậu tố `_FILE` nếu nhận từ file. Không đặt đồng thời cả hai dạng cho cùng secret.
3. File secret tối đa 8 KiB, không rỗng; trên POSIX production phải không có quyền group/other (thường `0600` hoặc `0400`). Thư mục state thường `0700`. File khóa mã hóa phải nằm ngoài thư mục state, kể cả khi đi qua symlink. Windows cần IT thiết lập và kiểm tra ACL riêng trước nghiệm thu.
4. Khóa phải được lưu tại secret manager/kênh quản lý khóa của công ty và có người được quyền khôi phục. Không đưa khóa vào Git, chat, PDF, log, ZIP hay cùng snapshot cấu hình. `AI_API_KEY_FILE` không làm profile hết chứa key: nếu lưu qua UI, API key được mã hóa trong profile.
5. `AI_REQUIRE_ENABLED=true` yêu cầu cấu hình AI đang bật khi startup và `/readyz`; dùng `false` chỉ cho smoke test echo được ghi nhãn. Readiness không kiểm chứng key có quyền gọi provider.
6. File profile đã lưu ghi đè toàn bộ cấu hình AI từ env. Xóa kết nối trong UI giữ trạng thái AI tắt, không tự kích hoạt credential từ env. File hỏng/sai khóa không fallback sang credential khác.

Nếu đã có profile development dùng khóa local, cần chuyển khóa hiện có bằng kênh secret và cấu hình khóa tương ứng trước khi dùng production. Không tạo khóa mới rồi dùng nó để đọc profile cũ. Chưa có chức năng xoay khóa mã hóa tự động; xoay khóa cần quy trình migration riêng và thử restore trước.

## Mẫu host Linux để IT đối chiếu

Giả định cần xác nhận: Linux có systemd >=245 để dùng journal namespace; Node đúng `.nvmrc` tại `/usr/bin/node`; TLS gateway do IT quản lý. Chỉ thực hiện trên host đã được cấp phép. Các đường dẫn chuẩn của mẫu:

| Thành phần | Đường dẫn dự kiến |
| --- | --- |
| Release bất biến | `/opt/teams-bot/releases/<release-id>` |
| Symlink release đang chạy | `/opt/teams-bot/current` |
| Env không chứa secret | `/etc/teams-bot/bot.env` |
| File secret | `/etc/teams-bot/secrets/` |
| State được giữ qua release | `/var/lib/teams-bot` |
| Snapshot mã hóa | Nơi backup riêng do Ops chỉ định |

IT tạo user/group dịch vụ `teams-bot` không có quyền đăng nhập; code chỉ cần đọc, state được ghi. Cấp secret đọc riêng cho user này. Cài service, env mẫu đã điền, `journald@teams-bot.conf` đúng vị trí trong comment. Mặc định service tự tạo state `0700`, umask `0077`, filesystem chỉ đọc trừ state, chạy không root và không nâng quyền. `MemoryMax=512M`, `TasksMax=128`, retention log 7 ngày và 200 MiB là giá trị mẫu phải hiệu chỉnh theo tải; chưa phải năng lực đo được.

Trước bật service, chạy dưới cùng user/env với service:

```sh
node scripts/preflight.mjs
```

Preflight kiểm tra Node, config, secret, state và yêu cầu AI; không gọi Microsoft/provider. `systemd` chạy lại preflight trước mỗi lần start. Sau khi IT cài file mẫu:

```sh
sudo systemd-analyze verify /etc/systemd/system/teams-bot.service
sudo systemctl daemon-reload
sudo systemctl enable --now teams-bot
sudo systemctl status teams-bot
sudo journalctl --namespace=teams-bot -u teams-bot -n 100 --no-pager
curl --fail http://127.0.0.1:3978/healthz
curl --fail http://127.0.0.1:3978/readyz
```

Không lưu output có dữ liệu nhạy cảm vào báo cáo. Nếu start bị giới hạn sau nhiều lần lỗi, sửa nguyên nhân rồi dùng `systemctl reset-failed teams-bot`; không tăng retry để che lỗi cấu hình.

## Gateway và quản trị

`BOT_ENDPOINT` là URL gốc ứng dụng, ví dụ `https://bot.example.com/teams-bot`, không gồm `/api/messages`, query, fragment hoặc credential. Messaging endpoint đăng ký với Microsoft là URL gốc cộng `/api/messages`; website/privacy/terms giữ nguyên prefix này. Khi dùng domain gốc, IT điều chỉnh location tương ứng. Chạy `nginx -t` trước reload trên host được phép.

Mẫu Nginx chỉ công khai messaging, trang gốc, privacy và terms. Header `Authorization` được chuyển nguyên cho SDK. Health/readiness kiểm tra từ mạng quản trị; không mở preview cổng 3980 ra Internet. Token hết hạn/sai tenant phải được kiểm thử thật theo kế hoạch tích hợp.

Trang quản trị dùng `node dist/preview.js` trong release, cùng user, env, state và khóa với backend; chỉ bind loopback. Mở qua SSH tunnel tới cổng 3980. Production preview cũng cần khóa cấp riêng. Người có SSH vào host được coi là quản trị; gói 1 chưa cung cấp SSO/RBAC web từ xa. Chỉ chạy một tiến trình quản trị ghi profile. Khi tắt AI để xử lý sự cố, `/readyz` trả 503 nếu yêu cầu AI đang bật; `/healthz` vẫn 200.

## Readiness và dừng dịch vụ

- `/healthz`: tiến trình HTTP còn sống, trả version từ `package.json`.
- `/readyz`: SDK đã initialize, không đang drain, profile đọc được, state production truy cập được, AI bật nếu được yêu cầu. Không gọi API trả phí hoặc kiểm tra kết nối Microsoft.
- SIGTERM/SIGINT: ngừng nhận công việc mới, chờ HTTP server dừng và tất cả handler đã nhận. Hết `SHUTDOWN_TIMEOUT_MS` (mặc định 30 giây) sẽ đóng kết nối còn lại, ghi `drained=false` và thoát mã 1. Dừng đủ trả mã 0.
- Mẫu systemd có `TimeoutStopSec=40`, lớn hơn grace 30 giây; giữ quan hệ này khi đổi cấu hình. `Restart=on-failure` phục hồi crash, không tự khởi động lại sau lệnh `systemctl stop` chủ động.
- Quota/count chỉ nằm trong RAM và reset khi restart. Crash/SIGKILL không có drain; gói 1 không phục hồi lượt AI dang dở và chưa chống activity lặp.

## Backup và restore cấu hình

Gói 1 chỉ có profile cấu hình mã hóa; không có DB hội thoại. Snapshot gồm `ai-settings.enc` và metadata/checksum, không có khóa. Cấp env/secret bằng cùng cơ chế của service; không truyền giá trị secret qua tham số dòng lệnh.

```sh
node scripts/state.mjs backup /absolute/backup/new-snapshot
node scripts/state.mjs verify /absolute/backup/new-snapshot
```

Backup đọc một snapshot byte và kiểm tra giải mã đúng trước khi lưu; profile được ghi atomic nên backup thấy bản cũ hoặc mới hoàn chỉnh. Thư mục snapshot phải chưa tồn tại. Kiểm tra backup định kỳ, hạn chế người đọc và giữ khóa riêng. Tần suất/retention/RPO/RTO do Ops chốt; chưa có lịch backup host được cài tự động.

Restore: dừng cả bot và preview; chọn thư mục state mới chưa có profile; đặt `AI_SETTINGS_DIR` tới đó; cấp đúng khóa của snapshot rồi chạy:

```sh
node scripts/state.mjs restore /absolute/backup/new-snapshot --offline
node scripts/preflight.mjs
```

`--offline` là xác nhận của người vận hành đã dừng các writer, không tự kiểm tra hoặc dừng service. Script từ chối ghi đè profile hiện hữu, checksum sai, khóa sai và cấu hình production không an toàn. Điều chỉnh service path/ACL cho state mới, start, kiểm tra readiness và smoke test rồi mới mở lưu lượng. Giữ state cũ và snapshot để rollback.

## Update và rollback

Tạo snapshot đã verify; giải nén release mới vào thư mục riêng; xác minh checksum và cài production dependencies bằng lockfile; dừng bot/preview; đổi symlink `current` sang release mới theo quy trình IT; chạy preflight và start. Giữ state ở ngoài thư mục release.

Nếu smoke test lỗi, dừng service rồi trả symlink về release trước. Baseline 0.2.0 giữ định dạng profile mã hóa v1; vẫn phải thử rollback thực tế trên host, không suy luận khả năng rollback của mọi version tương lai. Bản thay schema/format cần kế hoạch migration/restore riêng.

## Nghiệm thu host còn dự kiến

Ghi kết quả `NOT_TESTED` cho đến khi có môi trường: cài trên host sạch; không root và quyền file đúng; HTTPS/header/prefix; crash bằng tín hiệu tiến trình trong môi trường thử; reboot tự chạy; manual stop không restart; drain khi có lượt đang chạy; dung lượng/retention journal; restore và rollback bằng người nhận bàn giao. Lưu OS/systemd/Node, release ID, input, expected, actual, thời gian, bằng chứng và reviewer cho từng ca. Không dùng kết quả local để tự chuyển các mục này sang PASS.

## Tài liệu nền tảng đối chiếu

- [systemd execution environment](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html): service isolation, state directory và journal namespace; cần đối chiếu phiên bản cài trên host.
- [journald configuration](https://www.freedesktop.org/software/systemd/man/latest/journald.conf.html): cấu hình namespace, giới hạn dung lượng và retention.
- [Node HTTP server lifecycle](https://nodejs.org/api/http.html#serverclosecallback): đóng HTTP server/kết nối. Baseline đã kiểm thử thực tế trên Node 24.14.0, không suy từ bản tài liệu latest sang khả năng của mọi runtime.
