# ClassLive Pro 🎓
> Nền tảng Hỏi đáp Realtime, Chấm điểm Thuyết trình theo Rubric & Đồng bộ Thời gian thực qua giao thức WebSocket (RFC 6455).

Dự án thuộc **Bài tập nhóm số 3**: Xây dựng ứng dụng hoàn thiện & đưa lên GitHub cho cộng đồng sử dụng & đánh giá.

---

## 👥 Thành viên nhóm & Phân công nhiệm vụ

| STT | Họ và Tên | Vai trò chính | Module phụ trách |
|:---:|:---|:---|:---|
| 1 | **Hồ Ngọc Tiến** (`@ngoctienh`) | **Backend & Hạ tầng mạng** | Xây dựng WebSocket Server (RFC 6455), quản lý phòng PIN 4 số, đồng bộ thời gian (Timer), Heartbeat, Rate Limit, Test tải 100 CCU, Docker & CI (`server/`) |
| 2 | **Phạm Văn Dũng** (`@chovang1123`) | **Frontend Student** | Giao diện Mobile-first cho sinh viên: Nhập Họ tên/MSSV & mã PIN, Đặt câu hỏi Q&A (ẩn danh), Upvote câu hỏi, Chấm điểm Rubric 1–5 sao, Tự động kết nối lại (`client/src/views/student/`) |
| 3 | **Nguyễn Hải Long** (`@longnh474-jpg`) | **Frontend Host/Projector & Tài liệu** | Màn hình Projector (QR động, đếm ngược 15 phút đổi màu cảnh báo, Top câu hỏi, Biểu đồ Chart.js), Host Dashboard (điều phối, công bố kết quả, khảo sát CSAT, xuất CSV) & Tài liệu (`client/src/views/host/`, `projector/`, `docs/`) |

---

## 🚀 Các tính năng chính

1. **Khán giả / Sinh viên (`/student` — Mobile Web):**
   - Quét mã QR hoặc nhập Họ tên, MSSV và mã PIN 4 số để vào phòng nhanh chóng.
   - Gửi câu hỏi chất vấn (hiển thị tên thật hoặc ẩn danh), bấm Upvote đẩy câu hỏi hay lên đầu theo thời gian thực.
   - Chấm điểm bài thuyết trình từ 1–5 sao theo 4 tiêu chí (*Nội dung, Trình bày, Demo thực tế, Trả lời phản biện*).
   - Đèn báo trạng thái mạng (Xanh / Vàng / Đỏ) và tự động kết nối lại khi mạng 4G/WiFi chập chờn.

2. **Màn hình Chiếu Sân Khấu (`/projector` — Projector View):**
   - Giao diện Full-screen Dark mode chiếu trực tiếp trên bục giảng.
   - Tự động sinh mã QR kích thước lớn trỏ thẳng tới phòng sinh viên.
   - Đồng hồ đếm ngược 15 phút đồng bộ theo giờ máy chủ: tự động chuyển **Vàng** khi còn `< 3 phút` và **Đỏ nhấp nháy** khi còn `< 1 phút`.
   - Hiển thị Top câu hỏi nhiều lượt Upvote nhất (ưu tiên câu hỏi được Host ghim) và bung biểu đồ cột `Chart.js` khi Host công bố điểm.

3. **Bảng Điều Khiển Quản Trị (`/host` — Host Dashboard):**
   - Xác thực quyền điều phối bằng `hostToken`.
   - Theo dõi trực tiếp số thiết bị online, số câu hỏi chờ và số phiếu chấm Rubric.
   - Nút Khóa/Mở nhận câu hỏi & chấm điểm; Ghim / Đánh dấu đã trả lời / Xóa câu hỏi; Bắt đầu / Tạm dừng / Đặt lại đồng hồ 15 phút.
   - Nút **🚀 Mở Kết Quả** công bố biểu đồ điểm trung bình lên màn chiếu, khảo sát độ hài lòng CSAT và xuất báo cáo **CSV/Excel** chuẩn tiếng Việt UTF-8.

---

## 📡 Điểm nhấn Kỹ thuật Giao thức WebSocket (RFC 6455)

- **HTTP Upgrade → 101 Switching Protocols:** Duy trì kết nối song công toàn phần (Full-duplex) độ trễ thấp (`P95 ~ 27ms` cho 100 kết nối đồng thời).
- **Server-authoritative Synced Timer:** Đồng bộ thời gian từ máy chủ không bị trôi giờ (clock drift) giữa các thiết bị.
- **Heartbeat & Sequence Sync (`sync.resume`):** Ping/Pong tự động chu kỳ 30 giây phát hiện kết nối đứt ngầm; khôi phục các bản tin bị lỡ qua `lastSeq`.
- **Bảo mật & Chống gian lận:** Giới hạn tốc độ gửi 3 câu hỏi/phút (Sliding-window Rate Limiting), lọc từ ngữ thô tục, băm ẩn danh thiết bị (Salted SHA-256) chống vote lặp mà không lộ danh tính.

---

## 🛠️ Cài đặt & Chạy ứng dụng

### Cách 1: Chạy trực tiếp bằng Node.js (Khuyên dùng)
Server tích hợp sẵn phục vụ cả WebSocket lẫn 3 màn hình giao diện trên cùng một cổng `8080`:

```bash
cd server
npm install
npm start
```

Sau khi khởi động, mở trình duyệt tại:
- **Màn hình Chiếu (Projector):** `http://localhost:8080/projector`
- **Bảng điều khiển Host:** `http://localhost:8080/host`
- **Giao diện Sinh viên (Mobile):** `http://localhost:8080/student` (nhập mã PIN `4829` hoặc quét mã QR trên màn hình Projector)

Kiểm thử tự động & đo tải 100 kết nối đồng thời:
```bash
cd server
npm run check
```

### Cách 2: Chạy qua Docker Compose
```bash
docker-compose up --build
```
