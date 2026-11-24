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

#### `timer.control` (Host / Projector -> Server)
Điều khiển đồng hồ đếm ngược, hỗ trợ cộng/trừ thời gian trực tiếp (`addTime`) và chuyển pha trình bày (`setPhase`: `presentation` | `qna`).
```json
{
  "type": "timer.control",
  "payload": {
    "action": "addTime", // "start" | "pause" | "resume" | "reset" | "setDuration" | "addTime" | "setPhase"
    "deltaSec": 60,
    "phase": "qna" // "presentation" | "qna"
  }
}
```

#### `timer.sync` (Server -> Room)
Server định kỳ đồng bộ mốc thời gian 15 phút kèm pha trình bày hiện tại.
```json
{
  "type": "timer.sync",
  "payload": {
    "status": "running", // "stopped" | "running" | "paused"
    "phase": "presentation",
    "phaseLabel": "Pha 1: Trình bày & Demo",
    "duration": 900, // 15 phút = 900 giây
    "elapsed": 120, // Đã chạy được 120 giây
    "remaining": 780,
    "progressPercent": 13,
    "serverTimestamp": 1730301300000
  }
}
```

---

### 2.5 Đồng Bộ Slide, Con Trỏ Laser & Camera Diễn Giả (Live Stage Sync)

#### `slide.sync` (Host / Projector -> Server -> Room)
Đồng bộ trang Slide đang chiếu tới màn hình Projector và toàn bộ điện thoại Sinh viên (`/student`).
```json
{
  "type": "slide.sync",
  "payload": {
    "action": "next", // "next" | "prev" | "goto" | "load" | "sync"
    "page": 3,
    "total": 5,
    "url": "https://docs.google.com/presentation/...",
    "title": "Bộ Slide Thuyết Trình Nhóm 3"
  }
}
```

#### `slide.laser` (Host / Projector -> Server -> Room)
Truyền tọa độ đốm sáng Laser đỏ thời gian thực trên Slide (`recordLog: false` để tối ưu bộ nhớ cho luồng tần suất cao).
```json
{
  "type": "slide.laser",
  "payload": {
    "active": true,
    "x": 0.45,
    "y": 0.32,
    "color": "#ef4444"
  }
}
```

#### `stage.camera` (Host -> Server -> Projector)
Điều khiển bật/tắt và vị trí khung Camera Diễn giả (Picture-in-Picture) trên màn chiếu.
```json
{
  "type": "stage.camera",
  "payload": {
    "enabled": true,
    "position": "bottom-right",
    "size": "md",
    "mirrored": true
  }
}
```

---

### 2.6 Quản Lý Đa Nhóm Thuyết Trình & Tương Tác Khán Giả

#### `group.add` / `group.switch` (Host -> Server) & `group.updated` (Server -> Room)
Thêm hoặc chuyển đổi giữa các nhóm thuyết trình trong cùng 1 phòng, tự động tổng hợp **Bảng xếp hạng (`leaderboard`)**.
```json
{
  "type": "group.switch",
  "payload": {
    "name": "Nhóm 2: Giao thức WebSocket & Slide Sync",
    "topic": "RFC 6455 Realtime"
  }
}
```

#### `question.reply` (Host -> Server -> Room)
Ghi chú câu trả lời chính thức của nhóm thuyết trình cho câu hỏi phản biện.
```json
{
  "type": "question.reply",
  "payload": {
    "questionId": "q_987654",
    "reply": "Tọa độ Laser không lưu vào Event Log để tối ưu RAM."
  }
}
```

#### `reaction.send` (Client -> Server) & `reaction.broadcast` (Server -> Room)
Khán giả thả biểu tượng cảm xúc (`👏`, `🔥`, `❤️`, `🎯`, `🤔`, `👍`) bay trực tiếp lên màn chiếu.
```json
{
  "type": "reaction.send",
  "payload": {
    "emoji": "🔥"
  }
}
```
