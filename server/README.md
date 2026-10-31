# ClassLive Pro – Backend WebSocket Server (RFC 6455)

> **Phụ trách:** Tiến (Nhiệm vụ 1 – Backend, Giao thức Mạng & Hạ tầng)

---

## 1. Kiến trúc thư mục `server/`

```text
server/
├── src/
│   ├── config/
│   │   └── constants.js          # Cấu hình cổng, timeout, ngưỡng Rate Limit, Close Codes RFC 6455
│   ├── managers/
│   │   ├── RoomManager.js        # Quản lý phòng PIN 4 số, Host Token, Presence, Q&A, Rubric, Sync Seq, Xuất CSV
│   │   └── TimerManager.js       # Đồng hồ đếm ngược 15 phút đồng bộ theo giờ máy chủ (Server-authoritative)
│   ├── middlewares/
│   │   ├── rateLimiter.js        # Giới hạn chống spam (3 câu hỏi/phút, chống flood frame, chống dò PIN)
│   │   └── badWordsFilter.js     # Lọc từ ngữ không phù hợp trong lớp học (***)
│   ├── protocols/
│   │   ├── messageTypes.js       # Tập hằng số sự kiện WebSocket chuẩn
│   │   └── payloadValidator.js   # Kiểm tra khung JSON & làm sạch dữ liệu đầu vào
│   └── index.js                  # HTTP + WebSocket Server (ws)
├── tests/
│   ├── protocol.test.js          # Kiểm thử tích hợp tự động toàn bộ nghiệp vụ & giao thức
│   └── load-test.js              # Kịch bản kiểm thử tải 100 kết nối đồng thời (100 CCU)
├── Dockerfile                    # Đóng gói container Node 20 Alpine kèm Healthcheck
└── package.json
```

---

## 2. Hướng dẫn khởi chạy & Kiểm thử

```bash
cd server
npm install

# Chạy chế độ phát triển (tự động reload khi sửa code)
npm run dev

# Chạy kiểm thử giao thức tự động
npm test

# Chạy kiểm thử tải 100 kết nối WebSocket đồng thời
npm run load-test
```

---

## 3. Hướng dẫn kết nối nhanh cho Frontend (Dũng & Long)

Khi Server đang chạy ở cổng `8080`:

* **Endpoint WebSocket:**
  * Cách 1 (vào thẳng qua query URL): `ws://localhost:8080/ws?pin=4829&role=student&deviceId=abc`
  * Cách 2 (gửi bản tin `room.join` sau khi mở kết nối): `ws://localhost:8080/ws`
* **Đường dẫn mở trực tiếp giao diện trên cùng cổng Server:**
  * Giao diện Sinh viên: `http://localhost:8080/student`
  * Giao diện Host Dashboard: `http://localhost:8080/host`
  * Giao diện Màn hình Chiếu: `http://localhost:8080/projector`
* **REST API hỗ trợ:**
  * `GET /health` – Kiểm tra trạng thái server
  * `GET /api/stats` – Thống kê tổng quan số phòng, số kết nối đỉnh, khảo sát hài lòng
  * `POST /api/rooms` – Khởi tạo phòng mới nhận mã PIN 4 số + `hostToken`
  * `GET /api/rooms/:pin/export.csv` – Tải file báo cáo câu hỏi & bảng điểm Rubric (chuẩn UTF-8 mở bằng Excel)
  * `POST /api/survey` – Ghi nhận phiếu khảo sát hài lòng thực tế (Bài 3)

---

## 4. Kết quả Kiểm thử tải thực tế (100 Kết nối đồng thời)

Kết quả đo đạc bằng `npm run load-test` (1 Host + 1 Projector + 98 Sinh viên trong cùng 1 phòng):

| Chỉ số đo đạc | Kết quả thực tế | Mục tiêu đề tài | Đánh giá |
| :--- | :---: | :---: | :---: |
| Số kết nối đồng thời trong 1 phòng | **100 / 100 (100%)** | 50 – 100 kết nối | Đạt |
| Thời gian thiết lập đồng loạt 100 kết nối | **~185 ms** | < 1000 ms | Đạt |
| Độ trễ Ping/Pong trung bình (RTT) | **~8.1 ms** | < 100 ms | Đạt |
| Độ trễ Broadcast 1 ➔ 100 thiết bị (P95) | **~17.0 ms** | < 300 ms | Vượt chuẩn |
| Xử lý đồng thời 50 Upvote + 50 phiếu Rubric | **Chính xác 100%, 0% mất gói** | Không sai lệch | Đạt |
