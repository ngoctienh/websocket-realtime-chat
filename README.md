# ClassLive Pro 🎓
> Nền tảng Hỏi đáp Realtime, Chấm điểm Thuyết trình theo Rubric & Đồng bộ Thời gian thực qua giao thức WebSocket (RFC 6455).

Dự án thuộc **Bài tập nhóm số 3**: Xây dựng ứng dụng hoàn thiện & đưa lên GitHub cho cộng đồng sử dụng & đánh giá.

---

## 👥 Thành viên nhóm & Phân công nhiệm vụ

| STT | Họ và Tên | MSSV | Vai trò chính | Module phụ trách |
|:---:|:---|:---:|:---|:---|
| 1 | *Thành viên 1* | ... | **Backend & Mạng** | Xây dựng WebSocket Server, cơ chế phòng, đồng bộ thời gian (Timer), Heartbeat, Rate Limit, Docker & CI (`server/`) |
| 2 | *Thành viên 2* | ... | **Frontend Student** | Giao diện Mobile-first cho sinh viên: Đặt câu hỏi Q&A, Upvote câu hỏi, Chấm điểm Rubric 1-5 sao, Tự động kết nối lại (`client/src/views/student/`) |
| 3 | *Thành viên 3* | ... | **Frontend Host & Dữ liệu** | Màn hình Projector (QR to, đếm ngược 15'), Host Dashboard (mở kết quả, biểu đồ cột/radar, xuất CSV), Khảo sát & README (`client/src/views/host/`, `projector/`, `docs/`) |

---

## 🚀 Các tính năng chính

1. **Khán giả / Sinh viên (Mobile Web):**
   - Quét mã QR hoặc nhập mã PIN 4 số để vào phòng ngay lập tức không cần đăng nhập.
   - Gửi câu hỏi nhanh (hỗ trợ ẩn danh), upvote câu hỏi mình quan tâm theo thời gian thực.
   - Chấm điểm bài thuyết trình theo 4 tiêu chí (Nội dung, Trình bày, Demo, Trả lời).
   - Tự động kết nối lại khi mạng 4G/WiFi trong lớp bị chập chờn.

2. **Màn hình Chiếu (Projector View):**
   - Giao diện Full-screen Dark mode chiếu song song với slide báo cáo.
   - Mã QR kích thước lớn để cả lớp ngồi xa vẫn quét được.
   - Đồng hồ đếm ngược 15 phút đồng bộ theo mili-giây từ máy chủ; đổi màu cảnh báo khi còn 3 phút và 1 phút.
   - Tự động đẩy các câu hỏi có nhiều upvote nhất lên vị trí nổi bật.

3. **Màn hình Quản trị (Host / Giảng viên):**
   - Phân quyền bằng Host Token bí mật.
   - Nút bật/tắt nhận câu hỏi và chấm điểm.
   - Nút "Công bố kết quả": Hiển thị biểu đồ phân tích điểm trung bình của nhóm thuyết trình.
   - Xuất toàn bộ dữ liệu bảng điểm và câu hỏi ra file CSV.

---

## 📡 Điểm nhấn Kỹ thuật Giao thức WebSocket (RFC 6455)

- **Handshake & Switching Protocols:** Nâng cấp từ HTTP 1.1 lên kết nối 2 chiều duy nhất (Full-duplex).
- **Server-authoritative Synced Timer:** Đảm bảo toàn bộ thiết bị trong phòng cùng hiển thị 1 số giây duy nhất, có thuật toán bù độ trễ mạng (RTT compensation).
- **Heartbeat & Sequence Sync:** Ping/Pong tự động mỗi 30 giây; hỗ trợ resume tin nhắn bị lỡ qua `lastSeq`.
- **Chống gian lận & Spam:** Giới hạn tốc độ gửi (Rate limiting), cơ chế Client-fingerprint chống vote lặp ẩn danh.

---

## 🛠️ Cài đặt & Chạy thử nghiệm

### 1. Chạy Backend (Server)
```bash
cd server
npm install
npm run dev
```

### 2. Chạy Frontend (Client)
```bash
cd client
npm install
npm run dev
```

### 3. Chạy qua Docker
```bash
docker-compose up --build
```
