const {
  MAX_QUESTION_LENGTH,
  MAX_AUTHOR_NAME_LENGTH,
  MAX_REPLY_LENGTH,
  MAX_COMMENT_LENGTH,
  MAX_SLIDE_URL_LENGTH,
  RUBRIC_CRITERIA,
  QUESTION_CATEGORIES,
  VALID_REACTIONS,
  TIMER_PHASES,
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

  const rawCategory = typeof payload.category === 'string' ? payload.category.trim().toLowerCase() : 'question';
  const category = QUESTION_CATEGORIES.includes(rawCategory) ? rawCategory : 'question';

  return {
    valid: true,
    data: {
      content,
      isAnonymous,
      authorName,
      category
    }
  };
}

/**
 * Kiểm tra dữ liệu ghi chú câu trả lời cho câu hỏi (question.reply)
 */
function validateQuestionReply(payload = {}, fallbackAuthor = 'Nhóm thuyết trình') {
  const rawId = payload.questionId !== undefined ? payload.questionId : payload.id;
  if (rawId === undefined || rawId === null || String(rawId).trim() === '') {
    return {
      valid: false,
      code: 'invalid_question_id',
      error: 'Thiếu mã câu hỏi (questionId) để trả lời.'
    };
  }

  const replyText = sanitizeString(
    payload.reply || payload.answer || payload.content || payload.text || '',
    MAX_REPLY_LENGTH
  );
  if (!replyText) {
    return {
      valid: false,
      code: 'empty_reply',
      error: 'Nội dung câu trả lời không được để trống.'
    };
  }

  const repliedBy =
    sanitizeString(payload.repliedBy || payload.authorName || fallbackAuthor, MAX_AUTHOR_NAME_LENGTH) ||
    'Nhóm thuyết trình';

  return {
    valid: true,
    data: {
      questionId: String(rawId).trim(),
      reply: replyText,
      repliedBy
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
  const comment = sanitizeString(payload.comment || payload.feedback || payload.note || '', MAX_COMMENT_LENGTH);
  const authorName = sanitizeString(payload.authorName || payload.clientName || '', MAX_AUTHOR_NAME_LENGTH);

  return {
    valid: true,
    data: {
      scores,
      deviceId,
      comment,
      authorName
    }
  };
}

/**
 * Kiểm tra lệnh điều khiển đồng hồ 15 phút (timer.control)
 * Hỗ trợ: start, pause, resume, reset, setDuration, addTime (cộng/trừ giây), setPhase (presentation | qna)
 */
function validateTimerControl(payload = {}) {
  const validActions = ['start', 'pause', 'resume', 'reset', 'setDuration', 'addTime', 'setPhase'];
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

  let deltaSec = undefined;
  if (action === 'addTime' || payload.deltaSec !== undefined || payload.addSeconds !== undefined) {
    const rawDelta = Number(payload.deltaSec ?? payload.addSeconds ?? 60);
    if (!Number.isFinite(rawDelta) || Math.abs(rawDelta) > 3600) {
      return {
        valid: false,
        code: 'invalid_timer_delta',
        error: 'Số giây cộng/trừ (deltaSec) phải nằm trong khoảng -3600 đến +3600 giây.'
      };
    }
    deltaSec = Math.floor(rawDelta);
  }

  let phase = undefined;
  if (payload.phase !== undefined || action === 'setPhase') {
    const rawPhase = typeof payload.phase === 'string' ? payload.phase.trim().toLowerCase() : 'presentation';
    if (!TIMER_PHASES.includes(rawPhase)) {
      return {
        valid: false,
        code: 'invalid_timer_phase',
        error: `Pha trình bày không hợp lệ. Chỉ chấp nhận: ${TIMER_PHASES.join(', ')}.`
      };
    }
    phase = rawPhase;
  }

  return {
    valid: true,
    data: { action, duration, deltaSec, phase }
  };
}

/**
 * Kiểm tra dữ liệu quản lý Nhóm thuyết trình (group.add / group.switch)
 */
function validateGroupAction(type, payload = {}) {
  const groupId = sanitizeString(String(payload.groupId ?? payload.id ?? ''), 64);
  const name = sanitizeString(payload.name || payload.groupName || payload.title || '', 120);
  const topic = sanitizeString(payload.topic || payload.description || '', 200);

  if (type === 'group.add' && !name) {
    return {
      valid: false,
      code: 'invalid_group_name',
      error: 'Vui lòng nhập tên nhóm thuyết trình (name).'
    };
  }

  if (type === 'group.switch' && !groupId && !name) {
    return {
      valid: false,
      code: 'invalid_group_target',
      error: 'Vui lòng cung cấp mã nhóm (groupId) hoặc tên nhóm (name) để chuyển nhóm.'
    };
  }

  return {
    valid: true,
    data: {
      groupId,
      name,
      topic
    }
  };
}

/**
 * Kiểm tra dữ liệu Đồng bộ Slide thuyết trình (slide.sync)
 * Hỗ trợ action: next | prev | goto | load, hoặc truyền trực tiếp page / total / url / slides
 */
function validateSlideSync(payload = {}) {
  const validActions = ['next', 'prev', 'goto', 'load', 'sync'];
  const rawAction = typeof payload.action === 'string' ? payload.action.trim().toLowerCase() : 'sync';
  const action = validActions.includes(rawAction) ? rawAction : 'sync';

  let page = undefined;
  if (payload.page !== undefined || payload.currentSlide !== undefined) {
    const parsedPage = Number(payload.page ?? payload.currentSlide);
    if (!Number.isFinite(parsedPage) || parsedPage < 1 || parsedPage > 500) {
      return {
        valid: false,
        code: 'invalid_slide_page',
        error: 'Số trang slide (page) phải từ 1 đến 500.'
      };
    }
    page = Math.floor(parsedPage);
  }

  let total = undefined;
  if (payload.total !== undefined || payload.totalSlides !== undefined) {
    const parsedTotal = Number(payload.total ?? payload.totalSlides);
    if (!Number.isFinite(parsedTotal) || parsedTotal < 1 || parsedTotal > 500) {
      return {
        valid: false,
        code: 'invalid_slide_total',
        error: 'Tổng số trang slide (total) phải từ 1 đến 500.'
      };
    }
    total = Math.floor(parsedTotal);
  }

  const url =
    payload.url !== undefined || payload.embedUrl !== undefined
      ? sanitizeString(payload.url ?? payload.embedUrl ?? '', MAX_SLIDE_URL_LENGTH)
      : undefined;

  const title =
    payload.title !== undefined ? sanitizeString(payload.title, 160) : undefined;

  let slides = undefined;
  if (Array.isArray(payload.slides)) {
    slides = payload.slides
      .slice(0, 100)
      .map((item, idx) => {
        if (typeof item === 'string') {
          return {
            page: idx + 1,
            title: `Slide ${idx + 1}`,
            imageUrl: sanitizeString(item, MAX_SLIDE_URL_LENGTH),
            content: ''
          };
        }
        if (item && typeof item === 'object') {
          return {
            page: Number(item.page) || idx + 1,
            title: sanitizeString(item.title || `Slide ${idx + 1}`, 160),
            subtitle: sanitizeString(item.subtitle || '', 200),
            content: sanitizeString(item.content || item.body || '', 1000),
            bullets: Array.isArray(item.bullets)
              ? item.bullets.slice(0, 8).map((b) => sanitizeString(String(b), 200))
              : undefined,
            imageUrl: sanitizeString(item.imageUrl || item.url || '', MAX_SLIDE_URL_LENGTH)
          };
        }
        return null;
      })
      .filter(Boolean);
  }

  return {
    valid: true,
    data: {
      action,
      page,
      total,
      url,
      title,
      slides
    }
  };
}

/**
 * Kiểm tra tọa độ con trỏ Laser đỏ thời gian thực trên Slide (slide.laser)
 * x, y chuẩn hóa trong khoảng [0..1] (hoặc [0..100] phần trăm)
 */
function validateSlideLaser(payload = {}) {
  const active = payload.active !== undefined ? Boolean(payload.active) : true;
  if (!active) {
    return {
      valid: true,
      data: { active: false, x: 0, y: 0 }
    };
  }

  let x = Number(payload.x);
  let y = Number(payload.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return {
      valid: false,
      code: 'invalid_laser_coords',
      error: 'Tọa độ con trỏ Laser (x, y) phải là số hợp lệ.'
    };
  }

  // Hỗ trợ cả hệ tọa độ 0..1 và 0..100 (%)
  if (x > 1 || y > 1) {
    x = x / 100;
    y = y / 100;
  }

  x = Math.max(0, Math.min(1, Math.round(x * 10000) / 10000));
  y = Math.max(0, Math.min(1, Math.round(y * 10000) / 10000));

  return {
    valid: true,
    data: {
      active: true,
      x,
      y,
      color: sanitizeString(payload.color || '#ef4444', 20)
    }
  };
}

/**
 * Kiểm tra tín hiệu điều khiển Khung Camera Diễn giả PiP trên màn chiếu (stage.camera)
 */
function validateStageCamera(payload = {}) {
  const enabled = Boolean(payload.enabled ?? payload.open ?? payload.active ?? false);
  const validPositions = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];
  const validSizes = ['sm', 'md', 'lg'];

  const rawPos = typeof payload.position === 'string' ? payload.position.trim().toLowerCase() : 'bottom-right';
  const rawSize = typeof payload.size === 'string' ? payload.size.trim().toLowerCase() : 'md';

  return {
    valid: true,
    data: {
      enabled,
      position: validPositions.includes(rawPos) ? rawPos : 'bottom-right',
      size: validSizes.includes(rawSize) ? rawSize : 'md',
      mirrored: payload.mirrored !== undefined ? Boolean(payload.mirrored) : true
    }
  };
}

/**
 * Kiểm tra biểu tượng cảm xúc tương tác trực tiếp (reaction.send)
 */
function validateReactionSend(payload = {}, fallbackAuthor = 'Sinh viên') {
  const rawEmoji = sanitizeString(payload.emoji || payload.reaction || '👏', 16);
  const emoji = VALID_REACTIONS.includes(rawEmoji) ? rawEmoji : '👏';
  const authorName = sanitizeString(payload.authorName || fallbackAuthor, MAX_AUTHOR_NAME_LENGTH) || 'Sinh viên';

  return {
    valid: true,
    data: {
      emoji,
      authorName
    }
  };
}

/**
 * Kiểm tra dữ liệu khảo sát độ hài lòng thực tế (survey.submit)
 * Hỗ trợ cả điểm số (1-5), nhãn tiếng Việt và mã mức độ từ UI Host (very_satisfied / satisfied / normal)
 */
function validateSurveySubmit(payload = {}) {
  const labelMap = {
    'rất hài lòng': 5,
    'hài lòng': 4,
    'bình thường': 3,
    'không hài lòng': 2,
    'rất tệ': 1,
    'very_satisfied': 5,
    'satisfied': 4,
    'normal': 3,
    'unsatisfied': 2,
    'very_unsatisfied': 1
  };

  const displayLabelMap = {
    5: 'Rất hài lòng',
    4: 'Hài lòng',
    3: 'Bình thường',
    2: 'Không hài lòng',
    1: 'Rất tệ'
  };

  let rating = Number(payload.rating ?? payload.score);
  if (!Number.isFinite(rating) && typeof payload.rating === 'string') {
    rating = labelMap[payload.rating.trim().toLowerCase()];
  }
  if (!Number.isFinite(rating) && typeof payload.level === 'string') {
    rating = labelMap[payload.level.trim().toLowerCase()];
  }
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    rating = 5;
  }

  const roundedRating = Math.round(rating);
  const comment = sanitizeString(payload.comment || payload.feedback || '', 500);
  const level = sanitizeString(payload.level || '', 50);

  return {
    valid: true,
    data: {
      rating: roundedRating,
      level: level || displayLabelMap[roundedRating] || 'Bình thường',
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
  validateQuestionReply,
  validateQuestionUpvote,
  validateRatingSubmit,
  validateTimerControl,
  validateGroupAction,
  validateSlideSync,
  validateSlideLaser,
  validateStageCamera,
  validateReactionSend,
  validateSurveySubmit
};
