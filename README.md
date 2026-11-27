# ClassLive Pro 🎓
> Nền tảng Hỏi đáp Realtime, Chấm điểm Thuyết trình theo Rubric & Đồng bộ Thời gian thực qua giao thức WebSocket (RFC 6455).

Dự án thuộc **Bài tập nhóm số 3**: Xây dựng ứng dụng hoàn thiện & đưa lên GitHub cho cộng đồng sử dụng & đánh giá.

---

## 👥 Thành viên nhóm & Phân công nhiệm vụ

| STT | Họ và Tên | Vai trò chính | Module phụ trách |
|:---:|:---|:---|:---|
| 1 | **Hồ Ngọc Tiến** (`@ngoctienh`) | **Backend & Hạ tầng mạng** | Xây dựng WebSocket Server (RFC 6455), quản lý phòng PIN 4 số, Đa nhóm & Bảng xếp hạng (`leaderboard`), Trọng số điểm GV/SV, Đồng bộ Slide & Con trỏ Laser (`slide.sync`, `slide.laser`), Điều khiển Camera PiP (`stage.camera`), Chia pha Timer & Cộng/trừ giờ, Thả cảm xúc (`reaction.send`), Heartbeat, Rate Limit, Test tải 100 CCU, Docker & CI (`server/`) |
| 2 | **Phạm Văn Dũng** (`@chovang1123`) | **Frontend Student** | Giao diện Mobile Companion cho sinh viên: Quét QR/PIN, Xem Slide đồng bộ & Con trỏ Laser trực tiếp trên điện thoại, Đo Ping RTT (`ms`) & Khôi phục gói tin `sync.resume`, Hỏi đáp Q&A gắn Tag + Tìm kiếm + Lọc + Banner Spotlight, Chấm Rubric đa nhóm kèm nhận xét phản biện, Thanh thả cảm xúc bay & Popup khảo sát CSAT (`client/src/views/student/`) |
| 3 | **Nguyễn Hải Long** (`@longnh474-jpg`) | **Frontend Host/Projector & Tài liệu** | Màn hình Projector (Sân khấu Slide đồng bộ + Laser đỏ, Khung Webcam Diễn giả PiP thật qua `getUserMedia`, Mưa Emoji bay, Spotlight câu hỏi ghim, Đồng hồ 15 phút chia pha, Biểu đồ `Chart.js` & Bảng xếp hạng nhóm), Host Dashboard (Tải/gỡ file `.PPTX` bằng `JSZip`, Bàn di Laser, Điều khiển Camera/Timer/Đa nhóm, Chấm điểm GV trọng số 50%, Ghi chú trả lời Q&A, Đẩy khảo sát CSAT, Xuất CSV) & Tài liệu (`client/src/views/host/`, `projector/`, `docs/`) |

---

## 🚀 Các tính năng chính

1. **Khán giả / Sinh viên (`/student` — Mobile Interactive Companion):**
   - Quét mã QR hoặc nhập Họ tên, MSSV và mã PIN 4 số để vào phòng; thay thế toàn bộ `alert()` bằng **Toast Notification** mượt mà.
   - **Khung Xem Slide Đồng Bộ & Con Trỏ Laser Đỏ Realtime:** Tự động lật trang Slide theo diễn giả và hiển thị đốm sáng Laser đỏ di chuyển theo thời gian thực ngay trên màn hình điện thoại.
   - **Hỏi đáp Q&A Thông minh & Spotlight:** Chọn Tag phân loại câu hỏi (Chất vấn, Góp ý, Lỗi Demo, Kỹ thuật), bộ đếm ký tự `0/300`, thanh tìm kiếm và 3 tab lọc (Nhiều Vote, Mới nhất, Đã trả lời). Hiển thị **Banner Spotlight** khi câu hỏi đang được ghim phản biện kèm nội dung trả lời từ nhóm.
   - **Chấm điểm Rubric Đa Nhóm & Nhận xét:** Tự động chuyển tên nhóm đang thuyết trình & reset phiếu sao khi sang nhóm mới; chấm 1–5 sao theo 4 tiêu chí kèm ô nhập nhận xét ưu/nhược điểm.
   - **Tương tác Khán giả & Giám sát Mạng RFC 6455:** Thanh thả biểu tượng cảm xúc trực tiếp lên màn chiếu; Popup khảo sát CSAT tự động bật khi Host kích hoạt; hiển thị trực tiếp độ trễ `Online · RTT ms · Seq #` và tự động kéo bù sự kiện bị lỡ qua `sync.resume` khi mạng chập chờn.

2. **Màn hình Chiếu Sân Khấu (`/projector` — Stage Projector View):**
   - Giao diện Full-screen Dark mode chiếu trực tiếp trên bục giảng với mã QR tự động và tiêu đề Nhóm đang thuyết trình.
   - **Sân khấu Slide Đồng Bộ + Con Trỏ Laser Đỏ + Khung Webcam Diễn Giả (PiP):** Trình chiếu trực tiếp nội dung Slide (hoặc file `.PPTX` do Host tải lên), hiển thị đốm sáng Laser đỏ thời gian thực và khung nổi **Camera Diễn giả (Picture-in-Picture)** thu hình trực tiếp từ Webcam (`getUserMedia`).
   - **Đồng hồ Đếm ngược 15 phút Chia Pha:** Hiển thị nhãn Pha hiện tại (*Pha: Trình bày* / *Pha: Phản biện*), tự động chuyển **Vàng** khi còn `< 3 phút` và **Đỏ nhấp nháy** khi còn `< 1 phút`.
   - **Khung Spotlight Phản Biện, Tương tác Cảm xúc & Bảng Xếp Hạng Đa Nhóm:** Làm nổi bật câu hỏi đang được ghim trả lời, hiệu ứng biểu tượng cảm xúc bay từ đáy màn hình lên, biểu đồ cột `Chart.js` và **Bảng Xếp Hạng Các Nhóm Thuyết Trình**.

3. **Bảng Điều Khiển Quản Trị (`/host` — Host Dashboard):**
   - Tạo phòng mới mã PIN 4 số hoặc kết nối quản trị bằng `hostToken`; theo dõi trực tiếp số thiết bị online, số lượt đỉnh (Peak), tổng cảm xúc, câu hỏi chờ, phiếu Rubric và điểm khảo sát CSAT.
   - **Tải trực tiếp file PowerPoint (`.PPTX`), Bàn di Laser & Điều khiển Camera PiP:** Tích hợp `JSZip` đọc và tách tự động từng trang slide từ file `.pptx` trên máy tính để phát đồng bộ qua WebSocket; nút gỡ PPT (hoặc tự động gỡ khi đổi nhóm); bàn di chuột chiếu con trỏ Laser (`0..1`) và điều khiển bật/tắt, chọn góc hiển thị khung Camera Diễn giả.
   - **Quản lý Đa Nhóm & Chấm điểm Giảng viên (Trọng số 50%):** Thêm/chuyển đổi giữa các nhóm thuyết trình, bảng chấm điểm Rubric dành riêng cho Giảng viên (kết hợp trọng số 50% GV + 50% SV) và bảng xếp hạng trực tiếp.
   - **Điều phối Sân khấu Toàn diện:** Chuyển pha đồng hồ (*Trình bày* / *Phản biện*) và cộng/trừ `+1p` / `-1p` ngay khi đang đếm; Ghim Spotlight / Ghi chú câu trả lời phản biện / Đánh dấu đã trả lời / Xóa câu hỏi; Nút **Đẩy Survey** mở popup CSAT xuống toàn bộ điện thoại sinh viên và xuất báo cáo **CSV/Excel** chuẩn tiếng Việt UTF-8 BOM.

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
