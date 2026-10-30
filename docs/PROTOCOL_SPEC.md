# Đặc Tả Giao Thức WebSocket - ClassLive Pro

Ứng dụng sử dụng chuẩn **WebSocket RFC 6455**, truyền nhận dữ liệu định dạng **JSON**.

---

## 1. Cấu Trúc Thông Điệp Chuẩn (Envelope)

Mọi gói tin trao đổi giữa Client và Server đều có khung mẫu như sau:

```json
{
  "type": "TÊN_SỰ_KIỆN",
  "roomCode": "ABCD",
  "seq": 102,
  "timestamp": 1730301234567,
  "payload": {
    /* Dữ liệu cụ thể của sự kiện */
  }
}
```

---

## 2. Danh Sách Sự Kiện (Message Types)

### 2.1 Quản Lý Phòng & Kết Nối

#### `room.join` (Client -> Server)
Tham gia vào phòng học/thuyết trình.
```json
{
  "type": "room.join",
  "roomCode": "K64A",
  "payload": {
    "role": "student", // "student" | "host" | "projector"
    "clientName": "Nguyễn Văn A (ẩn danh hoặc tên thật)",
    "hostToken": "secret_token_123" // Chỉ cần khi role là "host"
  }
}
```

#### `presence.update` (Server -> Room)
Cập nhật số người trực tuyến trong phòng.
```json
{
  "type": "presence.update",
  "payload": {
    "onlineCount": 45,
    "activeQuestions": 12
  }
}
```

---

### 2.2 Hỏi Đáp Realtime (Q&A)

#### `question.add` (Client -> Server)
Sinh viên gửi câu hỏi mới.
```json
{
  "type": "question.add",
  "payload": {
    "content": "Nhóm cho mình hỏi về cách xử lý mất mạng khi WebSocket đứt kết nối?",
    "isAnonymous": true,
    "authorName": "Ẩn danh"
  }
}
```

#### `question.broadcast` (Server -> Room)
Server phát câu hỏi mới cho tất cả các màn hình trong phòng.
```json
{
  "type": "question.broadcast",
  "payload": {
    "id": "q_987654",
    "content": "Nhóm cho mình hỏi về cách xử lý mất mạng khi WebSocket đứt kết nối?",
    "authorName": "Ẩn danh",
    "votes": 0,
    "createdAt": 1730301240000
  }
}
```

#### `question.upvote` (Client -> Server)
Bấm vote cho câu hỏi.
```json
{
  "type": "question.upvote",
  "payload": {
    "questionId": "q_987654",
    "deviceId": "fingerprint_xyz"
  }
}
```

#### `question.voted` (Server -> Room)
Cập nhật số lượng vote mới của câu hỏi.
```json
{
  "type": "question.voted",
  "payload": {
    "questionId": "q_987654",
    "newVotes": 8
  }
}
```

---

### 2.3 Chấm Điểm Rubric (Rating)

#### `rating.submit` (Client -> Server)
Sinh viên gửi điểm đánh giá (1 - 5 sao).
```json
{
  "type": "rating.submit",
  "payload": {
    "deviceId": "fingerprint_xyz",
    "scores": {
      "content": 5,
      "presentation": 4,
      "demo": 5,
      "qa": 4
    }
  }
}
```

#### `rating.summary` (Server -> Host / Projector)
Server tổng hợp điểm (chỉ phát khi Host bấm nút "Mở kết quả").
```json
{
  "type": "rating.summary",
  "payload": {
    "totalVotes": 42,
    "averages": {
      "content": 4.6,
      "presentation": 4.2,
      "demo": 4.8,
      "qa": 4.1,
      "overall": 4.425
    }
  }
}
```

---

### 2.4 Đồng Bộ Đồng Hồ (Timer)

#### `timer.sync` (Server -> Room)
Server định kỳ đồng bộ mốc thời gian 15 phút.
```json
{
  "type": "timer.sync",
  "payload": {
    "status": "running", // "stopped" | "running" | "paused"
    "duration": 900, // 15 phút = 900 giây
    "elapsed": 120, // Đã chạy được 120 giây
    "serverTimestamp": 1730301300000
  }
}
```
