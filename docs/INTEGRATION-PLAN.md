# Kế hoạch nghiệm thu tích hợp gói 1

## Kết luận hiện tại

**Trạng thái tích hợp thật: NOT_TESTED. Trạng thái host thật: NOT_TESTED.** Chưa chốt host, tenant thử, domain/gateway hoặc provider/model thật. Các mục dưới đây là kế hoạch có thể thực hiện khi đủ đầu vào; không phải kết quả quan sát. Code, mock, ZIP hợp lệ, readiness hoặc CI PASS không thay thế bằng chứng Teams thật.

## Đầu vào cần chốt

| ID | Đầu vào | Owner dự kiến | Điều kiện sẵn sàng |
| --- | --- | --- | --- |
| I01 | Host, OS, network, service user, domain/TLS | IT/Ops | Host được phép, đường quản trị và route đã chốt |
| I02 | Tenant/app/bot registration và policy upload | M365 admin | Một tenant thử được phép; không tái dùng tài nguyên demo đã dọn nếu chưa xác nhận |
| I03 | Hai tài khoản thử và Teams personal/group/channel | M365 admin/QA | User A/B đăng nhập được và có nơi thử riêng |
| I04 | Một provider/model/gateway và secret | PO/IT | Có quyền dùng, ngân sách thử, loại dữ liệu được gửi đã rõ |
| I05 | Release và tiêu chí nghiệm thu | DEV/QA | Commit, checksum, cấu hình không bí mật, bộ ca và reviewer |
| I06 | Người nhận vận hành | Ops/PO | Có người chạy lại runbook và ký kết quả |

Credential cấp qua secret manager của công ty, không điền vào tài liệu. Gói 1 không yêu cầu Outlook/Graph mail, lịch hoặc quyền app nội bộ; không xin các quyền đó chỉ để thử chat AI.

## Ma trận kiểm thử dự kiến

| ID | Kịch bản | Điều kiện PASS | Bằng chứng cần thu | Hiện tại |
| --- | --- | --- | --- | --- |
| L01 | Cài release trên host sạch | Checksum đúng, dependencies từ lockfile, preflight/start thành công | Log cài đặt đã che, release ID, OS/Node | NOT_TESTED |
| L02 | HTTPS với gateway prefix | Messaging đi đúng backend; privacy/terms mở đúng URL; header auth được giữ | Cấu hình gateway đã che, HTTP status và URL | NOT_TESTED |
| L03 | Cài app trong tenant thử | Teams chấp nhận app, bot nhận được hoạt động | Ảnh Teams, app ID/tenant thử theo quyền lưu | NOT_TESTED |
| L04 | Chat riêng ping và câu hỏi AI | Đúng bot phản hồi, AI trả văn bản với cấu hình đã chốt | Video/ảnh hai chiều, provider/model, thời điểm và log | NOT_TESTED |
| L05 | Nhóm/kênh với và không mention | Chỉ xử lý khi mention đúng bot; không đáp khi mention bot khác | Cặp tình huống có/không mention | NOT_TESTED |
| L06 | JWT sai, thiếu, tenant khác | Request bị chặn/không xử lý; không gọi AI cho request không hợp lệ | HTTP status, token giả/fixture, log không có secret | NOT_TESTED |
| L07 | API AI 401, 429, timeout | Thông báo đúng loại lỗi, không lộ key/raw error, không retry ngầm | Ca lỗi được phép trên gateway thử, mã tra cứu | NOT_TESTED |
| L08 | Quản trị và secret | Public endpoint không có settings; SSH UI đúng quyền; state/khóa tách riêng | Status public/private, kiểm tra ACL, cấu hình đã che | NOT_TESTED |
| L09 | Dừng có lượt đang xử lý | Trong grace hoàn tất rồi dừng; quá grace báo undrained, không treo vô hạn | PID, timestamp, shutdown log và kết quả Teams | NOT_TESTED |
| L10 | Crash và reboot host | Crash được service phục hồi; reboot tự chạy; manual stop vẫn dừng | Nhật ký service trước/sau, readiness | NOT_TESTED |
| L11 | Khôi phục và rollback | Snapshot giải mã đúng, sai khóa bị chặn, người nhận tự phục hồi | Biên bản, thời gian đo, readiness và smoke test | NOT_TESTED |
| L12 | Giới hạn log và tài nguyên | Journal có retention/dung lượng theo quyết định; không log nội dung/key | Kiểm tra cấu hình và đo thực tế trên host | NOT_TESTED |

L06 local đã có test request thiếu JWT; hàng này vẫn NOT_TESTED vì kiểm thử qua gateway/tenant thật còn thiếu. Khi test sai tenant với JWT hợp lệ, dùng tenant và tài khoản thử được cấp phép; không tắt xác thực hoặc giả mạo credential thật để đạt ca thử.

## Trình tự và tiêu chí ký G1

1. Chốt I01–I06 và ghi tên người chịu trách nhiệm; xác nhận không dùng dữ liệu khách hàng thật cho smoke test.
2. Thực hiện L01–L02, L08 trước khi cho người dùng thử. Quyền cấu hình sai hoặc public admin là lỗi phải sửa trước bước tiếp theo.
3. L03–L07 xác minh cả luồng Teams → backend → AI → Teams, không chỉ endpoint trả 200.
4. L09–L12 xác minh vận hành. Reboot/crash chỉ thực hiện trên môi trường thử, theo lịch được Ops đồng ý.
5. QA và Ops đối chiếu từng bằng chứng; PO chốt phạm vi cấu hình được hỗ trợ. G1 chỉ PASS khi các ca bắt buộc đã PASS và không còn lỗi chặn về auth, secret hoặc vận hành.

Không đặt ngày hoàn thành cố định khi chưa có đầu vào. Sau khi đủ I01–I06, DEV/IT/QA ước lượng lại thời gian đăng ký, cài app, thử và sửa lỗi. Các nền tảng khác tiếp tục giữ NOT_TESTED đến khi thử riêng.

## Mẫu ghi bằng chứng

Sử dụng các trường: `test_id`, `release_commit`, `artifact_sha256`, `environment`, `node_version`, `provider_model`, `actor_role`, `input_fixture`, `expected`, `actual`, `status`, `timestamp_with_timezone`, `evidence_path`, `issue_id`, `reviewer`.

Quy tắc: `PASS` là đã thực hiện và có bằng chứng; `FAIL` là đã thực hiện nhưng sai; `NOT_TESTED` là chưa thực hiện; `BLOCKED` chỉ dùng khi có điều kiện chặn, owner và cách mở khóa cụ thể. Không điền kết quả dự kiến vào cột actual. Phân biệt ảnh/video live với bản mock hoặc bản ghi trước. Che token, key, dữ liệu cá nhân và thông tin không cần thiết.
