"""Rebuild the package 1 PDF from checked-in evidence; requires ReportLab and bundled fonts."""
import json
import os
from pathlib import Path
from xml.sax.saxutils import escape
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak

ROOT = Path(__file__).resolve().parents[1]
FONT_DIR = Path(os.environ.get('REPORT_FONT_DIR', '/Users/andinh307/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/libreoffice-headless/libreoffice/LibreOfficeDev.app/Contents/Resources/fonts/truetype'))
pdfmetrics.registerFont(TTFont('Body', str(FONT_DIR / 'NotoSans-Regular.ttf')))
pdfmetrics.registerFont(TTFont('BodyBold', str(FONT_DIR / 'NotoSans-Bold.ttf')))
pdfmetrics.registerFontFamily('Body', normal='Body', bold='BodyBold', italic='Body', boldItalic='BodyBold')
local = json.loads((ROOT / 'docs/evidence/local-verification.json').read_text())
smoke = json.loads((ROOT / 'docs/evidence/release-smoke.json').read_text())
ci = json.loads((ROOT / 'docs/evidence/github-ci.json').read_text())
assert local['localStatus'] == 'PASS' and smoke['status'] == 'PASS' and ci['conclusion'] == 'success'
assert ci['headSha'] == smoke['releaseCommit']
OUT = ROOT / 'output/pdf/Bao_cao_hoan_thien_goi_1_Teams_Bot_Agent_22-10-2026.pdf'
OUT.parent.mkdir(parents=True, exist_ok=True)
WIDTH = A4[0] - 100
blue = colors.HexColor('#173E5B')
styles = {
 'title': ParagraphStyle('title', fontName='BodyBold', fontSize=23, leading=29, textColor=colors.black, spaceAfter=15),
 'h1': ParagraphStyle('h1', fontName='BodyBold', fontSize=17, leading=23, textColor=colors.black, spaceAfter=12),
 'h2': ParagraphStyle('h2', fontName='BodyBold', fontSize=11.5, leading=16, spaceBefore=10, spaceAfter=5),
 'body': ParagraphStyle('body', fontName='Body', fontSize=10, leading=15, spaceAfter=8),
 'small': ParagraphStyle('small', fontName='Body', fontSize=8.6, leading=12, spaceAfter=6),
 'cell': ParagraphStyle('cell', fontName='Body', fontSize=8.7, leading=12),
 'head': ParagraphStyle('head', fontName='BodyBold', fontSize=8.8, leading=12, textColor=colors.white),
}
story = []
def p(text, kind='body'):
    story.append(Paragraph(text, styles[kind]))
def h(text): p(text, 'h2')
def page(title):
    if story: story.append(PageBreak())
    p(title, 'h1')
def table(headers, rows, widths):
    data = [[Paragraph(escape(str(x)), styles['head']) for x in headers]]
    data += [[Paragraph(escape(str(x).replace('→', ' -> ')).replace('\n','<br/>'), styles['cell']) for x in row] for row in rows]
    t = Table(data, colWidths=[WIDTH*x for x in widths], repeatRows=1, hAlign='LEFT')
    t.setStyle(TableStyle([
      ('BACKGROUND',(0,0),(-1,0),blue), ('VALIGN',(0,0),(-1,-1),'TOP'),
      ('LEFTPADDING',(0,0),(-1,-1),8), ('RIGHTPADDING',(0,0),(-1,-1),8),
      ('TOPPADDING',(0,0),(-1,-1),7), ('BOTTOMPADDING',(0,0),(-1,-1),7),
      ('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.HexColor('#F0F4F7'), colors.white]),
      ('LINEBELOW',(0,0),(-1,0),0.5,blue),
    ]))
    story.extend([t,Spacer(1,9)])
def bullet(text): p('• ' + text)
def link(url, label): return f'<link href="{escape(url)}" color="#175A8A">{escape(label)}</link>'

p('Báo cáo hoàn thiện gói 1<br/>Teams Bot Agent', 'title')
p('Baseline 0.2.0 | Ngày 22/10/2026 | Múi giờ Asia/Ho_Chi_Minh', 'small')
p('<b>Kết luận:</b> đã hoàn thiện phần kỹ thuật của bốn đầu việc được giao, kiểm thử local và tạo repository riêng. Source đã push lên GitHub; CI của baseline thành công. Chưa có bằng chứng host đích hoặc tích hợp Teams với AI thật, vì vậy <b>G1 chưa được nghiệm thu</b>.')
table(['Đầu việc', 'Kết quả thực hiện', 'Giới hạn nghiệm thu'], [
 ['1. Đóng gói', 'Sửa gateway prefix, đồng bộ version; release ZIP có checksum và commit.', 'Gói Teams dùng ID giả để kiểm thử; chưa upload vào tenant thật.'],
 ['2. Vận hành', 'Readiness, drain, shutdown có thời hạn; mẫu service, journal và Nginx.', 'Process local đã thử; host/OS chưa chốt. Mẫu Linux chưa chạy trên host đích.'],
 ['3. Quản lý khóa', 'Secret qua file; production bắt buộc khóa ngoài; backup/restore profile mã hóa.', 'Fixture local đã thử; secret manager, ACL host và người giữ khóa chưa chốt.'],
 ['4. Git và GitHub', 'Repository private, baseline commit, branch và workflow build/test/release.', 'Không triển khai Microsoft hoặc mua/cấu hình hạ tầng trong phạm vi này.'],
], [.18,.43,.39])
table(['Chỉ số đã quan sát', 'Kết quả'], [
 ['Build và kiểm thử local', f"PASS | {local['pass']}/{local['tests']} test | 0 lỗi | 0 bỏ qua"],
 ['Môi trường local', f"Node {local['node']} | macOS arm64 | Darwin {local['osRelease']}"],
 ['Release độc lập', '53 file được đối chiếu checksum; cài 114 production packages; smoke test PASS'],
 ['GitHub CI', 'SUCCESS: npm ci, build, test và release trên runner Ubuntu'],
 ['Host và Teams/AI thật', 'NOT_TESTED; kế hoạch nghiệm thu trình bày ở trang 6 và 7'],
], [.37,.63])
p('Đối tượng sử dụng báo cáo: chủ dự án, người phát triển và IT/Ops. Báo cáo phân biệt kết quả đã đo, cấu hình mẫu và công việc chờ đầu vào. Các trạng thái PASS chỉ có giá trị trong môi trường và phạm vi ghi kèm.', 'small')

page('1 Đóng gói và truy vết bản phát hành')
h('Vấn đề trước khi sửa')
p('Script cũ lấy riêng origin của BOT_ENDPOINT nên bỏ mất đường dẫn con khi triển khai qua gateway. Manifest ghi version 1.0.2, khác package 0.1.0; codebase chưa có Git baseline riêng để gắn với artifact.')
h('Hành vi hiện tại')
bullet('Giữ prefix của URL ứng dụng. Ví dụ BOT_ENDPOINT=https://example.invalid/teams-bot tạo privacy URL kết thúc bằng /teams-bot/privacy và terms URL kết thúc bằng /teams-bot/terms.')
bullet('Từ chối HTTP, localhost, URL có credential/query/fragment và URL đã chứa /api/messages. BOT_ENDPOINT là URL gốc ứng dụng; messaging endpoint được cấu hình riêng bằng cách nối /api/messages.')
bullet('Manifest và /healthz lấy version từ package.json. Baseline mới là 0.2.0. Gói ZIP Teams chỉ có manifest.json, color.png và outline.png, được kiểm tra schema và kích thước icon.')
bullet('Release Node yêu cầu repository riêng, commit và working tree sạch; build lại dist, ghi provenance và SHA-256. Chỉ đóng gói danh sách file đã khai báo, loại cấu hình thật, state, key, log và node_modules.')
table(['Thông tin release đã kiểm tra', 'Giá trị'], [
 ['Phiên bản', '0.2.0'], ['Code commit', smoke['releaseCommit']],
 ['Artifact', Path(smoke['artifact']).name], ['Số entry trong ZIP', '54, gồm checksums.json và 53 file được kiểm tra'],
 ['Runtime được pin', 'Node 24.14.0 trong .nvmrc; không kèm Node hoặc node_modules'],
 ['Cài production từ lockfile', 'npm ci --omit=dev --no-audit --no-fund; exit 0; 114 packages'],
], [.32,.68])
p('<b>SHA-256 của ZIP</b><br/>' + smoke['artifactSha256'][:32] + '<br/>' + smoke['artifactSha256'][32:], 'small')
h('Ý nghĩa và giới hạn')
p('Bản ZIP đã giải nén, kiểm tra checksum, cài production dependencies và khởi động trên macOS riêng biệt với thư mục development. Đây là bằng chứng artifact đủ file để chạy local. Chưa chứng minh cài đặt trên VPS đã chọn, Linux systemd hoặc Windows Service. Checksum bảo vệ việc đối chiếu tính toàn vẹn; không thay chữ ký của đơn vị phát hành.')
p('File chính: scripts/package.mjs, scripts/release.mjs, scripts/verify-release.mjs, .nvmrc, package.json và package-lock.json.', 'small')

page('2 Vận hành và vòng đời dịch vụ')
table(['Khả năng', 'Hành vi đã triển khai', 'Bằng chứng'], [
 ['/healthz', 'Phản ánh tiến trình HTTP còn sống và version; không gọi AI.', 'Local và bản ZIP trả 200.'],
 ['/readyz', 'Kiểm tra initialize, trạng thái drain, profile/state và điều kiện AI_REQUIRE_ENABLED.', '503 khi yêu cầu AI nhưng chưa bật, profile hỏng hoặc drain; 200 khi hợp lệ.'],
 ['Ngừng nhận việc', 'Middleware chặn /api/messages khi drain; lifecycle từ chối task mới.', 'Kiểm thử local trả 503 và task mới bị từ chối.'],
 ['Chờ lượt đang chạy', 'Theo dõi handler đến khi hoàn tất, kể cả HTTP được transport ACK sớm.', 'Test giữ một task chưa hoàn tất, xác nhận shutdown tiếp tục chờ.'],
 ['Giới hạn dừng', 'Mặc định 30 giây; hết hạn đóng kết nối, báo drained=false và thoát 1.', 'Test timeout có force-close; process bình thường SIGTERM thoát 0.'],
 ['Quản trị', 'Preview bind loopback; backend Teams không có API/settings UI.', 'Bản release trả 404 cho /settings và /api/settings.'],
], [.21,.52,.27])
h('Mẫu Linux được bàn giao')
p('Service dự kiến chạy bằng user teams-bot, đọc code trong release bất biến và ghi state ngoài release. Có Restart=on-failure, giới hạn restart, TimeoutStopSec=40, umask 0077, filesystem hạn chế ghi, giới hạn RAM/process và preflight trước start. Mẫu dùng journal namespace riêng với dung lượng/retention mẫu; Nginx chỉ công khai messaging, trang gốc, privacy và terms.')
p('<b>Trạng thái mẫu host: NOT_TESTED.</b> Host chưa chốt theo xác nhận của người dùng. systemd, namespace journal, đường dẫn Node, DNS/TLS và ACL phải được IT kiểm tra trên môi trường thật. Giá trị 512 MiB RAM, 128 task, retention 7 ngày và 200 MiB log là cấu hình đề xuất, chưa phải năng lực đo được.')
h('Giới hạn còn lại của gói 1')
p('Crash/SIGKILL không có cơ hội drain. History, quota bền vững, chống activity lặp và khôi phục job đang chạy thuộc gói 2. Quota/count hiện vẫn reset khi restart. Mẫu service phục hồi tiến trình không đồng nghĩa phục hồi nghiệp vụ dang dở.')
p('File chính: src/lifecycle.ts, src/app.ts, src/index.ts, scripts/preflight.mjs và deploy/. Runbook hướng dẫn cài đặt, kiểm tra gateway, update, rollback và diễn tập host.', 'small')

page('3 Quản lý secret và phục hồi cấu hình')
h('Chính sách production được thực thi bằng code')
bullet('Hỗ trợ CLIENT_SECRET_FILE, AI_API_KEY_FILE và AI_SETTINGS_ENCRYPTION_KEY_FILE. Từ chối cấu hình đồng thời giá trị trực tiếp và file cho cùng secret; file phải là đường dẫn tuyệt đối, không rỗng và không vượt 8 KiB.')
bullet('NODE_ENV=production bắt buộc thư mục state tuyệt đối được cấp riêng và khóa mã hóa 32 byte. Không tự sinh khóa cạnh profile. File khóa phải ở ngoài state, kể cả thông qua symlink.')
bullet('Trên POSIX production, file secret và thư mục state không được có quyền group/other. Mặc định dùng file 0600/0400 và thư mục 0700. Windows cần nghiệm thu ACL riêng.')
bullet('Profile vẫn mã hóa AES-256-GCM. Sai khóa hoặc dữ liệu hỏng làm hệ thống báo lỗi; không tự fallback sang provider/key khác. Thông báo lỗi không trả raw file contents hoặc secret.')
table(['Tình huống kiểm thử', 'Kết quả quan sát'], [
 ['Thiếu khóa production hoặc thiếu state rõ ràng', 'Bị chặn; process thiếu khóa thoát mã 1 trước khi mở cổng.'],
 ['Secret file quá lớn, thiếu file, đường dẫn tương đối', 'Bị từ chối; thông báo không chứa giá trị secret.'],
 ['File secret có quyền group/other hoặc khóa nằm trong state', 'Bị chặn trong môi trường POSIX đã thử.'],
 ['Profile lưu và nạp lại bằng cùng khóa', 'Giải mã đúng; không tạo file khóa local ở production.'],
 ['Snapshot bị sửa hoặc dùng khóa khác', 'Verify/restore bị chặn.'],
 ['Restore không --offline hoặc state đã có profile', 'Bị chặn, tránh ghi đè state đang dùng.'],
], [.51,.49])
h('Backup và restore được cung cấp')
p('Script state.mjs có ba lệnh backup, verify và restore. Snapshot gồm file profile mã hóa và metadata/checksum, không kèm khóa. Restore chỉ vào state mới; người vận hành dừng cả bot và preview, cấp đúng khóa rồi xác nhận --offline. Flag này là xác nhận của người vận hành, không tự kiểm tra trạng thái service.')
p('Đã chạy backup, verify và restore bằng fixture trong test suite và trên bản ZIP đã giải nén. Chưa cài lịch backup host, chưa đo RPO/RTO, chưa nghiệm thu secret manager hoặc người được quyền khôi phục. Chưa có tự động xoay khóa; phải có migration và diễn tập riêng trước khi đổi khóa production.')
p('File chính: src/secrets.ts, src/ai/runtime-settings.ts, scripts/state.mjs, deploy/bot.env.example. Không có credential thật trong báo cáo hoặc snapshot kiểm thử được bàn giao.', 'small')

page('4 Bằng chứng kiểm thử đã thực hiện')
table(['Nhóm kiểm thử', 'Số ca', 'Kết quả và phạm vi'], [
 ['AI và preview HTTP', '15', 'PASS; bốn giao thức API mô phỏng, lỗi/timeout, hạn mức, Unicode và luồng chat.'],
 ['Handler và auth Teams local', '5', 'PASS; personal/mention/count/config và chặn thiếu JWT tại endpoint SDK.'],
 ['Operations mới', '9', 'PASS; package, secret, readiness, drain, deadline, snapshot và checksum.'],
 ['Outgoing webhook riêng', '2', 'PASS hồi quy; không dùng làm bằng chứng tích hợp Teams/AI chính.'],
 ['Tiến trình compiled', '2', 'PASS; startup/probes/SIGTERM và fail trước listen khi thiếu khóa production.'],
 ['Runtime settings', '8', 'PASS; mã hóa, nạp lại, profile priority, draft test, guard quản trị và cập nhật runtime.'],
 ['Tổng', str(local['tests']), f"{local['pass']} PASS, {local['fail']} FAIL, {local['skipped']} SKIPPED"],
], [.31,.10,.59])
h('Smoke test trên bản release độc lập')
p('Kiểm thử sau khi giải nén ZIP và chạy npm ci --omit=dev trong thư mục tạm mới; dùng Node 24.14.0 trên macOS arm64, credential Microsoft giả, AI tắt cho smoke HTTP. Không gửi dữ liệu tới Microsoft hoặc provider thật.')
table(['Kiểm tra', 'Kết quả'], [
 ['53 checksum file / preflight', 'PASS / ok=true, externalAPIsChecked=false'],
 ['/healthz và /readyz', '200 / 200; aiEnabled=false được ghi rõ'],
 ['/api/messages thiếu JWT', '401'],
 ['/settings và /api/settings trên backend Teams', '404 / 404'],
 ['SIGTERM và phục hồi profile mã hóa', 'Exit 0, drained=true / backup-verify-restore PASS'],
], [.66,.34])
h('GitHub Actions của code baseline')
p('Workflow trên runner Ubuntu đã thành công cho npm ci, build, test và tạo release. Đây là bằng chứng chạy trong CI độc lập; không phải kiểm thử systemd hoặc Teams tenant thật. ' + link(ci['url'], 'Mở CI run 39759471800') + '.')
p('Bằng chứng: docs/evidence/local-verification.json và .txt; release-smoke.json; github-ci.json. Log local ghi thời gian bắt đầu 16:52:32 và kết thúc 16:52:33 ngày 22/10/2026 theo giờ Việt Nam; smoke release hoàn tất 17:01:52.', 'small')

page('5 Kế hoạch tích hợp và đầu vào còn thiếu')
p('<b>Tất cả ca tích hợp trong trang này và trang tiếp theo là dự kiến, trạng thái NOT_TESTED.</b> Expected mô tả điều kiện sẽ kiểm chứng; không được đưa vào cột actual hoặc coi là bằng chứng hoàn thành.')
table(['Đầu vào', 'Owner dự kiến', 'Cần xác nhận'], [
 ['Host và gateway', 'IT/Ops', 'OS, domain/TLS, service account, tuyến mạng, đường quản trị.'],
 ['Tenant và registration', 'M365 admin', 'Tenant thử được phép, app/bot ID và policy upload.'],
 ['Tài khoản và nơi thử', 'M365 admin/QA', 'Hai user, chat riêng, nhóm và kênh thử.'],
 ['Một cấu hình AI thật', 'PO/IT', 'Provider/model/gateway, key, ngân sách và dữ liệu được phép gửi.'],
 ['Release và người nghiệm thu', 'DEV/QA/Ops', 'Commit/checksum, người thực hiện, reviewer và người nhận vận hành.'],
], [.29,.22,.49])
h('Các ca dự kiến L01 đến L06')
table(['ID', 'Kịch bản và điều kiện PASS dự kiến', 'Bằng chứng cần thu'], [
 ['L01', 'Cài host sạch, checksum đúng, dependencies từ lockfile, preflight/start thành công.', 'Release ID, OS/Node, log đã che.'],
 ['L02', 'HTTPS và prefix đúng; Authorization tới backend; privacy/terms đúng URL.', 'Gateway config đã che, URL/status.'],
 ['L03', 'Teams chấp nhận app trong tenant thử; bot nhận activity.', 'Ảnh Teams, app/tenant ID theo quyền lưu.'],
 ['L04', 'Chat riêng ping và câu hỏi AI đi đủ Teams → backend → AI → Teams.', 'Ảnh/video hai chiều, model, thời gian và log.'],
 ['L05', 'Nhóm/kênh chỉ xử lý khi mention đúng bot.', 'Cặp thử có/không mention và mention bot khác.'],
 ['L06', 'Thiếu/sai JWT hoặc tenant khác bị chặn, không khởi tạo lượt AI.', 'Status, fixture và log không secret.'],
], [.09,.57,.34])
p('Không xin quyền Outlook/Graph mail hoặc app nội bộ để thử gói 1. Không tái sử dụng tài nguyên Microsoft demo đã dọn nếu chưa được xác nhận. Credential chuyển qua kênh secret của công ty, không điền vào báo cáo.', 'small')

page('6 Kế hoạch vận hành và điều kiện nghiệm thu G1')
table(['ID', 'Kịch bản và điều kiện PASS dự kiến', 'Bằng chứng cần thu'], [
 ['L07', 'AI 401/429/timeout báo đúng loại lỗi, không lộ key/raw error và không retry ngầm.', 'Ca lỗi trên gateway thử, mã tra cứu.'],
 ['L08', 'Không công khai quản trị; SSH UI đúng phạm vi; key/state và ACL đúng.', 'Public/private status, ACL đã che.'],
 ['L09', 'Dừng có lượt chạy: hoàn tất trong grace; quá grace báo undrained, không treo.', 'PID, timestamp, shutdown log và Teams.'],
 ['L10', 'Crash được service phục hồi; reboot tự chạy; manual stop vẫn dừng.', 'Journal trước/sau, readiness.'],
 ['L11', 'Người nhận restore/rollback được; sai khóa bị chặn; smoke test đạt.', 'Biên bản, thời gian đo và release ID.'],
 ['L12', 'Giới hạn tài nguyên và journal hoạt động theo cấu hình đã chốt.', 'Dung lượng/retention và đo trên host.'],
], [.09,.57,.34])
h('Trình tự thực hiện khi có môi trường')
bullet('IT/Ops, M365 admin và PO chốt đầu vào, phạm vi tài khoản thử và cấu hình AI; chỉ dùng dữ liệu được phép.')
bullet('Làm L01–L02 và L08 trước khi mở cho người thử. Lỗi auth/secret hoặc public admin phải được xử lý trước.')
bullet('Chạy L03–L07 để xác nhận luồng sử dụng thật; sau đó L09–L12 theo lịch thử được Ops đồng ý.')
bullet('DEV sửa lỗi; QA thực hiện lại ca bị ảnh hưởng; Ops chạy lại runbook. PO/QA/Ops đối chiếu bằng chứng trước ký G1.')
h('Quy tắc ghi nhận')
p('Mỗi ca có test_id, release_commit, artifact_sha256, môi trường, Node, provider/model, actor_role, input, expected, actual, status, timestamp, evidence_path, issue_id và reviewer. PASS phải có kết quả thực; FAIL là đã thử nhưng sai; NOT_TESTED là chưa thử. BLOCKED cần nguyên nhân, owner và điều kiện mở khóa cụ thể.')
p('<b>G1 chỉ được đánh dấu PASS khi các ca bắt buộc đã đạt và không còn lỗi chặn về auth, secret hoặc vận hành.</b> Không đặt deadline cố định khi host/tenant/provider chưa chốt. Khi đủ đầu vào, các bên ước lượng lại thời gian triển khai và thử nghiệm.')
p('RPO/RTO, tải, SLA và retention cuối cùng cần được chốt theo masterplan. Kết quả local và CI không tự chứng minh các chỉ tiêu này. Gói 2–6 giữ nguyên phạm vi phát triển sau gói 1.', 'small')

page('7 GitHub hồ sơ bàn giao và việc tiếp theo')
p('<b>Repository:</b> ' + link('https://github.com/dinhvanan307/teams-bot-agent', 'dinhvanan307/teams-bot-agent') + ' (private). Tài khoản được người dùng xác nhận là dinhvanan307. Nhánh baseline: codex/package-one. Code đã push thành công; CI baseline có kết quả success.')
p('<b>Code baseline commit</b><br/>' + smoke['releaseCommit'], 'small')
p('Repository được khởi tạo độc lập trong teams-bot/, không kế thừa lịch sử Git của mẫu Microsoft ở thư mục cha. Không đưa node_modules, dist, file .env thật, state, key, log hay artifact tạm vào source history. Đã rà soát danh sách file được stage, ignore rules và mẫu secret phổ biến; đây không phải một cuộc kiểm toán bảo mật đầy đủ.')
table(['Hồ sơ', 'Mục đích'], [
 ['README.md và CHANGELOG.md', 'Phạm vi baseline, cách chạy và thay đổi 0.2.0.'],
 ['docs/DEPLOYMENT.md', 'Release, secret, mẫu Linux/gateway, quản trị, backup/restore, update/rollback.'],
 ['docs/INTEGRATION-PLAN.md', 'Đầu vào, 12 ca L01–L12, expected, bằng chứng và điều kiện ký G1.'],
 ['docs/MASTERPLAN.md mục 18', 'Cập nhật phần đã làm, giữ trạng thái host/integration NOT_TESTED.'],
 ['docs/evidence/', 'Log và JSON build/test, release smoke và CI gắn với baseline.'],
 ['artifacts/ ZIP và .sha256', 'Bộ chạy Node riêng để Ops tiếp nhận; được tạo local, không commit binary vào source.'],
 ['NOTICE.md', 'Nguồn gốc code và dependency; chưa cấp giấy phép open source cho project.'],
], [.40,.60])
h('Việc cần làm sau báo cáo')
p('1. Chọn host/OS và người nhận vận hành; đối chiếu mẫu Linux nếu phù hợp. Nếu chọn Windows, cần bổ sung Windows Service và thử ACL/lifecycle riêng.<br/>2. Cấp tenant thử, domain và một cấu hình AI chính; thực hiện L01–L12.<br/>3. Ghi actual và evidence, xử lý lỗi rồi ký G1. Sau đó triển khai history/quota bền vững và chống lặp ở gói 2.')
h('Nguồn kiểm chứng và giới hạn')
p('Kết quả thực lấy từ source baseline, log local, release-smoke.json và GitHub Actions. Tham khảo nền tảng: ' + link('https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html','systemd execution environment') + ', ' + link('https://www.freedesktop.org/software/systemd/man/latest/journald.conf.html','journald configuration') + ' và ' + link('https://nodejs.org/api/http.html#serverclosecallback','Node HTTP lifecycle') + '. Hành vi runtime được thử trên Node 24.14.0; mẫu host vẫn cần đối chiếu phiên bản thực.', 'small')
p('PDF ghi nhận code baseline nêu trên. Commit bổ sung báo cáo/bằng chứng sau baseline không thay đổi kết quả code đã kiểm thử; khi sửa code tiếp, cần kiểm thử và phát hành artifact mới.', 'small')

def frame(canvas, doc):
    canvas.saveState()
    canvas.setFont('Body', 8)
    canvas.setFillColor(colors.HexColor('#56616A'))
    canvas.drawString(50, A4[1]-28, 'FIIN TEAM BOT  |  GÓI 1  |  BASELINE 0.2.0')
    canvas.setStrokeColor(colors.HexColor('#D2DCE4'))
    canvas.line(50, A4[1]-35, A4[0]-50, A4[1]-35)
    canvas.drawString(50, 25, '22/10/2026  •  Kết quả local và kế hoạch nghiệm thu tích hợp')
    canvas.drawRightString(A4[0]-50, 25, f'Trang {doc.page}')
    canvas.restoreState()

doc = SimpleDocTemplate(str(OUT), pagesize=A4, rightMargin=50, leftMargin=50, topMargin=51, bottomMargin=45,
                        title='Báo cáo hoàn thiện gói 1 Teams Bot Agent', author='Codex', subject='Baseline 0.2.0 và kế hoạch nghiệm thu tích hợp')
doc.build(story, onFirstPage=frame, onLaterPages=frame)
print(OUT)
