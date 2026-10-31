const {
  MAX_QUESTION_LENGTH,
  MAX_AUTHOR_NAME_LENGTH,
  RUBRIC_CRITERIA,
  VALID_ROLES
} = require('../config/constants');

/**
 * Làm sạch chuỗi ký tự đầu vào (loại bỏ ký tự điều khiển ẩn, cắt khoảng trắng thừa)
 */
function sanitizeString(value, maxLength = 500) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim()
    .slice(0, maxLength);
}

/**
 * Kiểm tra định dạng khung bản tin JSON cơ bản
 */
function validateEnvelope(rawMessage) {
  if (!rawMessage || typeof rawMessage !== 'object' || Array.isArray(rawMessage)) {
    return { valid: false, error: 'Bản tin phải là một đối tượng JSON hợp lệ.' };
  }

  if (typeof rawMessage.type !== 'string' || !rawMessage.type.trim()) {
    return { valid: false, error: 'Thiếu trường định danh sự kiện "type".' };
  }

  const payload =
    rawMessage.payload && typeof rawMessage.payload === 'object' && !Array.isArray(rawMessage.payload)
      ? rawMessage.payload
      : {};

  return {
    valid: true,
    data: {
      type: rawMessage.type.trim(),
      roomCode: extractRoomCode(rawMessage, payload),
      seq: typeof rawMessage.seq === 'number' ? rawMessage.seq : null,
      timestamp: typeof rawMessage.timestamp === 'number' ? rawMessage.timestamp : Date.now(),
      payload
    }
  };
}

/**
 * Trích xuất mã phòng linh hoạt từ envelope hoặc payload (hỗ trợ cả roomCode và pin)
 */
function extractRoomCode(envelope = {}, payload = {}) {
  const raw =
    envelope.roomCode ||
    envelope.pin ||
    payload.roomCode ||
    payload.pin ||
    '';
  if (typeof raw !== 'string' && typeof raw !== 'number') return '';
  return String(raw).trim().toUpperCase();
}

/**
 * Kiểm tra mã phòng PIN (chấp nhận mã PIN 4 số chuẩn hoặc mã phòng chữ-số 4-8 ký tự như K64A)
 */
function isValidRoomCode(code) {
  if (typeof code !== 'string') return false;
  return /^[A-Z0-9]{4,8}$/.test(code);
}

/**
 * Kiểm tra dữ liệu tham gia phòng (room.join)
 */
function validateRoomJoin(roomCode, payload = {}) {
  if (!isValidRoomCode(roomCode)) {
    return {
      valid: false,
      code: 'invalid_room_code',
      error: 'Mã phòng (PIN) phải gồm 4-8 ký tự chữ hoặc số (VD: 4829).'
    };
  }

  const rawRole = typeof payload.role === 'string' ? payload.role.trim().toLowerCase() : 'student';
  const role = VALID_ROLES.includes(rawRole) ? rawRole : 'student';

  const clientName =
    sanitizeString(payload.clientName || payload.authorName || payload.name || '', MAX_AUTHOR_NAME_LENGTH) ||
    'Sinh viên';

  const deviceId = sanitizeString(payload.deviceId || '', 128);
  const hostToken = sanitizeString(payload.hostToken || '', 128);

  return {
    valid: true,
    data: {
      roomCode,
      role,
      clientName,
      deviceId,
      hostToken
    }
  };
}

/**
 * Kiểm tra dữ liệu câu hỏi mới (question.add)
 * Tương thích cả PROTOCOL_SPEC (content, isAnonymous, authorName) và UI Student (text, isAnon, author)
 */
function validateQuestionAdd(payload = {}, fallbackName = 'Sinh viên') {
  const rawContent = payload.content !== undefined ? payload.content : payload.text;
  const content = sanitizeString(rawContent, MAX_QUESTION_LENGTH);

  if (!content) {
    return {
      valid: false,
      code: 'empty_question',
      error: 'Nội dung câu hỏi không được để trống.'
    };
  }

  const isAnonymous = Boolean(payload.isAnonymous ?? payload.isAnon ?? false);
  const rawAuthor = sanitizeString(
    payload.authorName || payload.author || fallbackName,
    MAX_AUTHOR_NAME_LENGTH
  );
  const authorName = isAnonymous ? 'Ẩn danh' : rawAuthor || 'Sinh viên';

  return {
    valid: true,
    data: {
      content,
      isAnonymous,
      authorName
    }
  };
}

/**
 * Kiểm tra dữ liệu upvote câu hỏi (question.upvote)
 */
function validateQuestionUpvote(payload = {}) {
  const rawId = payload.questionId !== undefined ? payload.questionId : payload.id;
  if (rawId === undefined || rawId === null || String(rawId).trim() === '') {
    return {
      valid: false,
      code: 'invalid_question_id',
      error: 'Thiếu mã câu hỏi (questionId) để bình chọn.'
    };
  }

  const deviceId = sanitizeString(payload.deviceId || '', 128);

  return {
    valid: true,
    data: {
      questionId: String(rawId).trim(),
      deviceId
    }
  };
}

/**
 * Kiểm tra dữ liệu chấm điểm Rubric 4 tiêu chí 1-5 sao (rating.submit)
 * Hỗ trợ cả payload.scores = { content, presentation, demo, qa } hoặc truyền trực tiếp ở payload
 */
function validateRatingSubmit(payload = {}) {
  const sourceScores =
    payload.scores && typeof payload.scores === 'object' ? payload.scores : payload;

  const scores = {};
  for (const criterion of RUBRIC_CRITERIA) {
    const numVal = Number(sourceScores[criterion]);
    if (!Number.isFinite(numVal) || numVal < 1 || numVal > 5) {
      return {
        valid: false,
        code: 'invalid_rubric_score',
        error: `Điểm tiêu chí "${criterion}" phải nằm trong khoảng từ 1 đến 5 sao.`
      };
    }
    scores[criterion] = Math.round(numVal * 10) / 10;
  }

  const deviceId = sanitizeString(payload.deviceId || '', 128);

  return {
    valid: true,
    data: {
      scores,
      deviceId
    }
  };
}

/**
 * Kiểm tra lệnh điều khiển đồng hồ 15 phút (timer.control)
 */
function validateTimerControl(payload = {}) {
  const validActions = ['start', 'pause', 'resume', 'reset', 'setDuration'];
  const action = typeof payload.action === 'string' ? payload.action.trim() : '';

  if (!validActions.includes(action)) {
    return {
      valid: false,
      code: 'invalid_timer_action',
      error: `Hành động timer không hợp lệ. Chỉ chấp nhận: ${validActions.join(', ')}.`
    };
  }

  let duration = undefined;
  if (payload.duration !== undefined) {
    const parsed = Number(payload.duration);
    if (!Number.isFinite(parsed) || parsed < 10 || parsed > 7200) {
      return {
        valid: false,
        code: 'invalid_timer_duration',
        error: 'Thời lượng đồng hồ phải từ 10 đến 7200 giây.'
      };
    }
    duration = Math.floor(parsed);
  }

  return {
    valid: true,
    data: { action, duration }
  };
}

/**
 * Kiểm tra dữ liệu khảo sát độ hài lòng thực tế (survey.submit)
 */
function validateSurveySubmit(payload = {}) {
  const labelMap = {
    'rất hài lòng': 5,
    'hài lòng': 4,
    'bình thường': 3,
    'không hài lòng': 2,
    'rất tệ': 1
  };

  let rating = Number(payload.rating ?? payload.score);
  if (!Number.isFinite(rating) && typeof payload.level === 'string') {
    rating = labelMap[payload.level.trim().toLowerCase()] || 5;
  }
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    rating = 5;
  }

  const comment = sanitizeString(payload.comment || payload.feedback || '', 500);
  const level = sanitizeString(payload.level || '', 50);

  return {
    valid: true,
    data: {
      rating: Math.round(rating),
      level: level || (rating >= 5 ? 'Rất hài lòng' : rating >= 4 ? 'Hài lòng' : 'Bình thường'),
      comment
    }
  };
}

module.exports = {
  sanitizeString,
  validateEnvelope,
  extractRoomCode,
  isValidRoomCode,
  validateRoomJoin,
  validateQuestionAdd,
  validateQuestionUpvote,
  validateRatingSubmit,
  validateTimerControl,
  validateSurveySubmit
};
