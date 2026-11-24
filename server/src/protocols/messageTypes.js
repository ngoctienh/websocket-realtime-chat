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
  QUESTION_PIN: 'question.pin',         // Host ghim/bỏ ghim câu hỏi (Stage Spotlight)
  QUESTION_ANSWERED: 'question.answered', // Host đánh dấu đã trả lời
  QUESTION_DELETE: 'question.delete',   // Host xóa câu hỏi vi phạm
  QUESTION_REPLY: 'question.reply',     // Host / Nhóm thuyết trình ghi chú câu trả lời
  QUESTION_TOGGLE: 'question.toggle',   // Host mở/khóa nhận câu hỏi

  // Chấm điểm Rubric (4 tiêu chí 1-5 sao, Trọng số GV/SV & Nhận xét)
  RATING_SUBMIT: 'rating.submit',
  RATING_SUBMITTED: 'rating.submitted', // Phản hồi riêng cho SV vừa chấm xong
  RATING_SUCCESS: 'rating.success',     // Alias xác nhận thành công cho UI Student
  RATING_TOGGLE: 'rating.toggle',       // Host mở/khóa chấm
  RATING_PUBLISH: 'rating.publish',     // Host bấm nút "Công bố kết quả"
  RATING_SUMMARY: 'rating.summary',     // Phát kết quả tổng kết (biểu đồ + nhận xét + leaderboard)

  // Quản lý Đa Nhóm thuyết trình & Bảng xếp hạng (Multi-Group Leaderboard)
  GROUP_ADD: 'group.add',               // Host thêm nhóm thuyết trình mới vào danh sách
  GROUP_SWITCH: 'group.switch',         // Host chuyển sang nhóm thuyết trình khác
  GROUP_UPDATED: 'group.updated',       // Server phát danh sách nhóm, nhóm hiện tại & Bảng xếp hạng

  // Đồng bộ Slide thuyết trình, Con trỏ Laser & Khung Camera Diễn giả (Stage Control)
  SLIDE_SYNC: 'slide.sync',             // Đồng bộ trang Slide hiện tại, tổng số trang, URL/tiêu đề
  SLIDE_LASER: 'slide.laser',           // Tọa độ con trỏ Laser đỏ (x, y) thời gian thực trên Slide
  STAGE_CAMERA: 'stage.camera',         // Điều khiển bật/tắt khung Webcam Diễn giả (PiP) trên Projector

  // Tương tác cảm xúc trực tiếp (Live Floating Emoji Reactions)
  REACTION_SEND: 'reaction.send',       // Sinh viên bấm thả cảm xúc
  REACTION_BROADCAST: 'reaction.broadcast', // Server phát icon cảm xúc bay lên màn hình Projector

  // Đồng hồ đếm ngược 15 phút (Chia pha & cộng/trừ thời gian linh hoạt)
  TIMER_CONTROL: 'timer.control',       // Host start / pause / resume / reset / setDuration / addTime / setPhase
  TIMER_SYNC: 'timer.sync',             // Server phát thời gian chuẩn đồng bộ kèm pha trình bày

  // Khảo sát hài lòng thực tế (Số liệu Bài 3)
  SURVEY_TRIGGER: 'survey.trigger',     // Host đẩy popup khảo sát CSAT xuống toàn bộ màn hình Student
  SURVEY_SUBMIT: 'survey.submit',
  SURVEY_ACK: 'survey.ack',

  // Trạng thái mạng & lỗi
  HEARTBEAT_PING: 'ping',
  HEARTBEAT_PONG: 'pong',
  ERROR: 'error'
};
