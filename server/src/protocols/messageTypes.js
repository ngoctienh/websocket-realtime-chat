/**
 * Định nghĩa các loại sự kiện (Message Types) chuẩn cho giao thức WebSocket ClassLive Pro
 */
module.exports = {
  // Quản lý phòng & kết nối
  ROOM_JOIN: 'room.join',
  ROOM_LEAVE: 'room.leave',
  PRESENCE_UPDATE: 'presence.update',

  // Hỏi đáp (Q&A)
  QUESTION_ADD: 'question.add',
  QUESTION_BROADCAST: 'question.broadcast',
  QUESTION_UPVOTE: 'question.upvote',
  QUESTION_VOTED: 'question.voted',

  // Chấm điểm Rubric
  RATING_SUBMIT: 'rating.submit',
  RATING_TOGGLE: 'rating.toggle',       // Host mở/khóa chấm
  RATING_SUMMARY: 'rating.summary',     // Phát kết quả tổng kết

  // Đồng hồ đếm ngược
  TIMER_CONTROL: 'timer.control',       // Host start/pause/reset
  TIMER_SYNC: 'timer.sync',             // Server phát thời gian chuẩn

  // Trạng thái mạng & lỗi
  HEARTBEAT_PING: 'ping',
  HEARTBEAT_PONG: 'pong',
  ERROR: 'error'
};
