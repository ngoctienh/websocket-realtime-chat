/**
 * Định nghĩa các loại sự kiện (Message Types) chuẩn cho giao thức WebSocket ClassLive Pro
 */
module.exports = {
  // Quản lý phòng & kết nối
  ROOM_CREATE: 'room.create',           // Host yêu cầu tạo phòng mới mã PIN 4 số
  ROOM_CREATED: 'room.created',         // Server trả về mã PIN 4 số + hostToken
  ROOM_JOIN: 'room.join',               // Client tham gia phòng
  ROOM_JOINED: 'room.joined',           // Server xác nhận vào phòng kèm snapshot hiện tại
  ROOM_LEAVE: 'room.leave',             // Client rời phòng
  ROOM_CLOSE: 'room.close',             // Host đóng phòng
  ROOM_SETTINGS: 'room.settings',       // Host bật/tắt nhận câu hỏi hoặc chấm điểm
  PRESENCE_UPDATE: 'presence.update',   // Cập nhật số người online & thống kê nhanh

  // Đồng bộ gói tin bị lỡ khi kết nối lại (Reconnect Sequence Sync)
  SYNC_RESUME: 'sync.resume',           // Client gửi lastSeq khi kết nối lại
  SYNC_STATE: 'sync.state',             // Server trả về các sự kiện bị lỡ hoặc full state

  // Hỏi đáp (Q&A)
  QUESTION_ADD: 'question.add',
  QUESTION_BROADCAST: 'question.broadcast',
  QUESTION_UPVOTE: 'question.upvote',
  QUESTION_VOTED: 'question.voted',
  QUESTION_PIN: 'question.pin',         // Host ghim/bỏ ghim câu hỏi
  QUESTION_ANSWERED: 'question.answered', // Host đánh dấu đã trả lời
  QUESTION_DELETE: 'question.delete',   // Host xóa câu hỏi vi phạm
  QUESTION_TOGGLE: 'question.toggle',   // Host mở/khóa nhận câu hỏi

  // Chấm điểm Rubric (4 tiêu chí 1-5 sao)
  RATING_SUBMIT: 'rating.submit',
  RATING_SUBMITTED: 'rating.submitted', // Phản hồi riêng cho SV vừa chấm xong
  RATING_TOGGLE: 'rating.toggle',       // Host mở/khóa chấm
  RATING_PUBLISH: 'rating.publish',     // Host bấm nút "Công bố kết quả"
  RATING_SUMMARY: 'rating.summary',     // Phát kết quả tổng kết (biểu đồ)

  // Đồng hồ đếm ngược 15 phút
  TIMER_CONTROL: 'timer.control',       // Host start / pause / resume / reset
  TIMER_SYNC: 'timer.sync',             // Server phát thời gian chuẩn đồng bộ

  // Khảo sát hài lòng thực tế (Số liệu Bài 3)
  SURVEY_SUBMIT: 'survey.submit',
  SURVEY_ACK: 'survey.ack',

  // Trạng thái mạng & lỗi
  HEARTBEAT_PING: 'ping',
  HEARTBEAT_PONG: 'pong',
  ERROR: 'error'
};
