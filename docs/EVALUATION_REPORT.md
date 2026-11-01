# Báo Cáo Kiểm Thử Tải & Đánh Giá Thực Tế — ClassLive Pro

Tài liệu tổng hợp kết quả kiểm thử kỹ thuật giao thức **WebSocket (RFC 6455)** và khung thu thập số liệu người dùng thực tế cho **Bài tập nhóm số 3**.

---

## 1. Kết Quả Kiểm Thử Giao Thức Tự Động (`protocol.test.js`)

Lệnh thực thi:
```bash
cd server
npm test
```

| STT | Kịch bản kiểm thử giao thức | Kết quả |
|:---:|:---|:---:|
| 1 | Cấp mã phòng PIN 4 số ngẫu nhiên & chống giả mạo quyền Host (`hostToken`) | ✅ PASS |
| 2 | Hỏi đáp Q&A realtime, tự động lọc từ ngữ xấu (`***`) & Rate Limit tối đa 3 câu/phút | ✅ PASS |
| 3 | Bình chọn Upvote & chống vote lặp ẩn danh trên cùng thiết bị (SHA-256 salted hash) | ✅ PASS |
| 4 | Chấm điểm Rubric 4 tiêu chí (1–5 sao) & công bố biểu đồ tổng hợp (`rating.publish`) | ✅ PASS |
| 5 | Đồng bộ đồng hồ 15 phút (`timer.sync`), khôi phục tin bị lỡ (`sync.resume`) & xuất CSV UTF-8 | ✅ PASS |
| 6 | Đồng bộ trạng thái Khóa/Mở (`question.toggle`, `rating.toggle`) & khảo sát CSAT (`survey.submit`) | ✅ PASS |

---

## 2. Kết Quả Kiểm Thử Chịu Tải 100 Kết Nối Đồng Thời (`load-test.js`)

Lệnh thực thi:
```bash
cd server
npm run load-test
```

| Chỉ số đo đạc | Mục tiêu đề ra | Kết quả thực tế | Đánh giá |
|:---|:---:|:---:|:---:|
| **Số kết nối WebSocket đồng thời (CCU)** | 50 – 100 kết nối | **100 / 100 (100%)** | ✅ Đạt |
| **Độ trễ Ping/Pong trung bình** | < 100 ms | **~11.0 ms (P95: 11.6 ms)** | ✅ Rất tốt |
| **Độ trễ Broadcast 1 → 100 máy (P95)** | < 300 ms | **~27.6 ms** | ✅ Vượt chuẩn |
| **Tỷ lệ mất gói tin (Packet Loss)** | 0% | **0% (50/50 Vote, 50/50 Rubric)** | ✅ Tin cậy |

---

## 3. Thống Kê Sử Dụng & Khảo Sát Hài Lòng Thực Tế (Bài 3)

Hệ thống tự động tổng hợp số liệu trực tiếp tại endpoint `GET /api/stats` và xuất báo cáo buổi thuyết trình qua `GET /api/rooms/:pin/export.csv`:

- **Cách thu thập trong buổi báo cáo trên lớp:**
  1. Mở màn hình chiếu `/projector` để sinh viên cả lớp quét mã QR vào `/student`.
  2. Sinh viên đặt câu hỏi phản biện, bình chọn Upvote và chấm điểm Rubric 4 tiêu chí.
  3. Cuối phiên, thu thập đánh giá mức độ hài lòng qua biểu mẫu CSAT (`Rất hài lòng 5★ / Hài lòng 4★ / Bình thường 3★`) và tải file báo cáo CSV lưu minh chứng.
