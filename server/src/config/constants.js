/**
 * Cấu hình hằng số hệ thống cho ClassLive Pro WebSocket Server
 */
module.exports = {
  // Cổng mặc định của HTTP & WebSocket Server
  PORT: Number(process.env.PORT) || 8080,

  // Giới hạn kích thước tối đa 1 frame WebSocket (64 KB) chống tấn công tràn bộ nhớ
  MAX_PAYLOAD_BYTES: 64 * 1024,

  // Chu kỳ gửi gói tin Ping kiểm tra kết nối sống (Heartbeat: 30 giây)
  HEARTBEAT_INTERVAL_MS: Number(process.env.HEARTBEAT_INTERVAL_MS) || 30000,

  // Thời gian tự động hủy phòng nếu không có hoạt động (30 phút)
  ROOM_TTL_MS: Number(process.env.ROOM_TTL_MS) || 30 * 60 * 1000,

  // Chu kỳ quét dọn các phòng hết hạn (5 phút)
  ROOM_CLEANUP_INTERVAL_MS: Number(process.env.ROOM_CLEANUP_INTERVAL_MS) || 5 * 60 * 1000,

  // Thời lượng thuyết trình mặc định: 15 phút = 900 giây
  DEFAULT_TIMER_DURATION_SEC: 15 * 60,

  // Các mốc cảnh báo thời gian còn lại (giây)
  TIMER_WARNING_YELLOW_SEC: 3 * 60, // Còn 3 phút -> Vàng
  TIMER_WARNING_RED_SEC: 1 * 60,    // Còn 1 phút -> Đỏ nhấp nháy

  // Số lượng gói tin tối đa lưu trong bộ đệm lịch sử phòng để hỗ trợ sync.resume
  MAX_EVENT_LOG_SIZE: 200,

  // Giới hạn câu hỏi tối đa chiều dài ký tự
  MAX_QUESTION_LENGTH: 500,
  MAX_AUTHOR_NAME_LENGTH: 60,
  MAX_REPLY_LENGTH: 500,
  MAX_COMMENT_LENGTH: 300,
  MAX_SLIDE_URL_LENGTH: 1000,

  // Cấu hình Rate Limit (Chống spam & dò mã PIN)
  RATE_LIMIT: {
    QUESTION_WINDOW_MS: 60 * 1000,       // Cửa sổ 1 phút
    MAX_QUESTIONS_PER_WINDOW: 3,         // Tối đa 3 câu hỏi / phút / máy

    REACTION_WINDOW_MS: 10 * 1000,       // Cửa sổ 10 giây cho thả cảm xúc
    MAX_REACTIONS_PER_WINDOW: 15,        // Tối đa 15 lần thả cảm xúc / 10 giây / máy

    MESSAGE_WINDOW_MS: 60 * 1000,        // Cửa sổ 1 phút
    MAX_MESSAGES_PER_WINDOW: 240,        // Tối đa 240 gói tin / phút / kết nối (hỗ trợ cả laser pointer)

    JOIN_FAIL_WINDOW_MS: 60 * 1000,      // Cửa sổ 1 phút
    MAX_JOIN_FAILS_PER_WINDOW: 10        // Tối đa 10 lần nhập sai PIN / phút / IP
  },

  // 4 tiêu chí chấm điểm Rubric chuẩn của đề tài
  RUBRIC_CRITERIA: ['content', 'presentation', 'demo', 'qa'],

  // Trọng số chấm điểm mặc định khi có cả Giảng viên (Host) và Sinh viên (Student)
  DEFAULT_WEIGHTS: {
    hostWeight: 0.5,    // Giảng viên 50%
    studentWeight: 0.5  // Hội đồng Sinh viên 50%
  },

  // Danh mục Tag phân loại câu hỏi Q&A
  QUESTION_CATEGORIES: ['question', 'feedback', 'bug', 'tech'],

  // Danh sách biểu tượng cảm xúc hợp lệ cho Live Reactions
  VALID_REACTIONS: ['👏', '🔥', '❤️', '🎯', '🤔', '👍'],

  // Các pha của đồng hồ thuyết trình
  TIMER_PHASES: ['presentation', 'qna'],

  // Các vai trò hợp lệ trong phòng
  VALID_ROLES: ['student', 'host', 'projector'],

  // Mã đóng kết nối WebSocket theo chuẩn RFC 6455
  WS_CLOSE_CODES: {
    NORMAL_CLOSURE: 1000,
    POLICY_VIOLATION: 1008,
    MESSAGE_TOO_BIG: 1009,
    INTERNAL_ERROR: 1011,
    ROOM_CLOSED: 4001,
    KICKED_BY_HOST: 4002
  }
};
