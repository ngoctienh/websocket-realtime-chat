const crypto = require('crypto');
const { WebSocket } = require('ws');
const {
  ROOM_TTL_MS,
  MAX_EVENT_LOG_SIZE,
  RUBRIC_CRITERIA,
  DEFAULT_WEIGHTS
} = require('../config/constants');
const { filterBadWords } = require('../middlewares/badWordsFilter');

/**
 * Bộ Slide thuyết trình mặc định tích hợp sẵn để nhóm có thể lật trang & chỉ Laser ngay lập tức
 */
const DEFAULT_SLIDE_DECK = [
  {
    page: 1,
    title: 'ClassLive Pro — Kiến trúc Giao thức WebSocket (RFC 6455)',
    subtitle: 'Bài tập nhóm số 3 • Môn Lập trình Mạng',
    content: 'Hệ thống Hỏi đáp Realtime, Chấm điểm Rubric Đa Nhóm, Đồng bộ Slide & Con trỏ Laser thời gian thực.',
    bullets: [
      'Kết nối song công toàn phần (Full-Duplex) trên một kết nối TCP duy nhất (HTTP 101 Upgrade)',
      'Độ trễ P95 < 30ms cho 100 kết nối đồng thời (100 CCU)',
      'Tự động khôi phục gói tin bị lỡ qua Sequence ID (sync.resume)'
    ]
  },
  {
    page: 2,
    title: 'Cơ chế Đồng bộ Thời gian & Chống Trôi Giờ (Clock Drift)',
    subtitle: 'Server-Authoritative Synced Timer & Phase Control',
    content: 'Đồng hồ đếm ngược được tính toán từ mốc Date.now() của Server, chia 2 pha: Trình bày & Phản biện.',
    bullets: [
      'Cảnh báo tự động đổi màu: Xanh (> 3p) → Vàng (< 3p) → Đỏ nhấp nháy (< 1p)',
      'Hỗ trợ cộng/trừ thời gian trực tiếp (+1 phút / -1 phút) ngay khi đang chạy',
      'Đồng bộ tức thời tới Projector, Host và 100 thiết bị Sinh viên'
    ]
  },
  {
    page: 3,
    title: 'Đồng bộ Slide & Con trỏ Laser Thời Gian Thực',
    subtitle: 'Live Slide Sync & High-Frequency Laser Pointer',
    content: 'Giúp sinh viên ngồi cuối giảng đường theo dõi trực tiếp từng trang Slide và điểm chỉ Laser trên điện thoại.',
    bullets: [
      'Tách biệt Control Plane (lật trang có lưu Event Log) và Ephemeral Stream (tọa độ Laser tần suất cao)',
      'Tọa độ Laser chuẩn hóa (x, y ∈ [0..1]) tương thích mọi kích thước màn hình',
      'Điều khiển từ xa khung Camera Diễn giả (PiP) trên màn chiếu Projector'
    ]
  },
  {
    page: 4,
    title: 'Chấm điểm Rubric Đa Nhóm & Trọng số Giảng viên / Sinh viên',
    subtitle: 'Weighted Peer-Review & Live Leaderboard',
    content: 'Đánh giá khách quan theo 4 tiêu chí kèm nhận xét phản biện và bảng xếp hạng các nhóm thuyết trình.',
    bullets: [
      '4 tiêu chí: Nội dung (Content), Trình bày (Presentation), Demo thực tế, Trả lời phản biện (Q&A)',
      'Tính điểm trọng số: 50% Điểm Giảng viên (Host) + 50% Điểm Hội đồng Sinh viên',
      'Chống bơm điểm ẩn danh bằng mã băm Salted SHA-256 theo từng phòng'
    ]
  },
  {
    page: 5,
    title: 'Bảo mật, Chống Spam & Kiểm thử Tải 100 CCU',
    subtitle: 'Sliding-Window Rate Limiting & Automated CI/CD',
    content: 'Đảm bảo tính ổn định và an toàn cho lớp học thực tế khi hoạt động trên mạng WiFi / 4G giảng đường.',
    bullets: [
      'Sliding-Window Rate Limiter: tối đa 3 câu hỏi/phút, chống flood frame & khóa IP dò mã PIN',
      'Lọc từ ngữ không phù hợp & xác thực quyền điều phối bằng hostToken',
      'Xuất báo cáo tổng hợp ra file CSV/Excel chuẩn tiếng Việt UTF-8 BOM'
    ]
  }
];

/**
 * Quản lý vòng đời Phòng thuyết trình (RoomManager)
 * - Cấp mã PIN 4 số ngẫu nhiên & phân quyền Host bằng hostToken
 * - Theo dõi Presence (số người online, số người đỉnh peakConcurrent)
 * - Quản lý Hỏi đáp Q&A, chống vote lặp ẩn danh bằng băm SHA-256
 * - Quản lý Chấm điểm Rubric 4 tiêu chí & tính trung bình realtime
 * - Lưu bộ đệm sự kiện theo Sequence ID (seq) hỗ trợ khôi phục khi rớt mạng (sync.resume)
 */
class RoomManager {
  constructor(timerManager = null) {
    this.rooms = new Map();
    this.timerManager = timerManager;
    this.globalSurveys = [];
    this.totalRoomsCreated = 0;
  }

  /**
   * Băm ẩn danh định danh thiết bị kèm muối riêng của từng phòng (không thể truy ngược)
   */
  _hashDevice(room, rawDeviceId) {
    return crypto
      .createHash('sha256')
      .update(`${room.salt}:${rawDeviceId}`)
      .digest('hex')
      .slice(0, 24);
  }

  /**
   * Sinh mã PIN 4 chữ số ngẫu nhiên (1000 - 9999) không trùng với các phòng đang hoạt động
   */
  generateUniquePin() {
    for (let attempt = 0; attempt < 500; attempt++) {
      const pin = String(crypto.randomInt(1000, 10000));
      if (!this.rooms.has(pin)) {
        return pin;
      }
    }
    // Dự phòng nếu đầy 9000 phòng
    return crypto.randomBytes(3).toString('hex').toUpperCase();
  }

  /**
   * Tạo phòng mới
   */
  createRoom(options = {}) {
    const requestedCode = options.roomCode ? String(options.roomCode).trim().toUpperCase() : '';
    const roomCode = requestedCode || this.generateUniquePin();

    if (this.rooms.has(roomCode)) {
      return this.rooms.get(roomCode);
    }

    const now = Date.now();
    const hostToken = options.hostToken || crypto.randomBytes(16).toString('hex');
    const salt = crypto.randomBytes(12).toString('hex');

    const defaultGroupId = 'grp_1';
    const initialGroups = new Map();
    initialGroups.set(defaultGroupId, {
      id: defaultGroupId,
      name: options.groupName || 'Nhóm 1 (Đang thuyết trình)',
      topic: options.title || 'Báo cáo Đồ án Lập trình Mạng WebSocket',
      createdAt: now,
      ratings: new Map() // voterHash -> { content, presentation, demo, qa, role, comment, authorName, submittedAt }
    });

    const room = {
      roomCode,
      title: options.title || `Phòng Thuyết Trình #${roomCode}`,
      hostToken,
      hostClaimed: Boolean(options.hostClaimed),
      salt,
      createdAt: now,
      lastActiveAt: now,
      seq: 0,
      eventLog: [],
      clients: new Set(),
      questions: [],
      currentGroupId: defaultGroupId,
      groups: initialGroups,
      ratings: initialGroups.get(defaultGroupId).ratings, // Tham chiếu trực tiếp tới bảng điểm của nhóm hiện tại
      slideState: {
        title: 'Bộ Slide Thuyết Trình Nhóm 3',
        url: '',
        page: 1,
        total: DEFAULT_SLIDE_DECK.length,
        slides: DEFAULT_SLIDE_DECK.map((s) => ({ ...s })),
        laser: {
          active: false,
          x: 0.5,
          y: 0.5,
          color: '#ef4444'
        }
      },
      cameraState: {
        enabled: false,
        position: 'bottom-right',
        size: 'md',
        mirrored: true
      },
      reactionCounts: {
        '👏': 0,
        '🔥': 0,
        '❤️': 0,
        '🎯': 0,
        '🤔': 0,
        '👍': 0
      },
      surveys: [],
      settings: {
        qnaOpen: true,
        ratingOpen: true,
        resultPublished: false,
        hostWeight: DEFAULT_WEIGHTS.hostWeight,
        studentWeight: DEFAULT_WEIGHTS.studentWeight
      },
      stats: {
        peakConcurrent: 0,
        totalJoined: 0,
        totalReactions: 0
      }
    };

    this.rooms.set(roomCode, room);
    this.totalRoomsCreated += 1;

    if (this.timerManager) {
      this.timerManager.ensureTimer(roomCode, options.durationSec);
    }

    return room;
  }

  /**
   * Lấy thông tin phòng theo mã PIN
   */
  getRoom(roomCode) {
    if (!roomCode) return null;
    return this.rooms.get(String(roomCode).trim().toUpperCase()) || null;
  }

  /**
   * Đánh dấu phòng vừa có tương tác mới (gia hạn TTL)
   */
  touchRoom(room) {
    if (room) {
      room.lastActiveAt = Date.now();
    }
  }

  /**
   * Đưa kết nối WebSocket vào phòng & kiểm tra phân quyền Host
   */
  joinRoom(ws, { roomCode, role = 'student', clientName = 'Sinh viên', deviceId = '', hostToken = '', requireExisting = false }) {
    const normalizedCode = String(roomCode).trim().toUpperCase();
    let room = this.rooms.get(normalizedCode);

    if (!room) {
      if (requireExisting) {
        return {
          ok: false,
          code: 'room_not_found',
          error: `Không tìm thấy phòng với mã PIN "${normalizedCode}".`
        };
      }
      room = this.createRoom({
        roomCode: normalizedCode,
        hostToken: role === 'host' && hostToken ? hostToken : undefined,
        hostClaimed: false
      });
    }

    // Xác thực quyền Host
    let issuedHostToken = null;
    if (role === 'host') {
      const masterToken = process.env.MASTER_HOST_TOKEN;
      if (room.hostClaimed) {
        const isValidHost =
          (hostToken && hostToken === room.hostToken) ||
          (masterToken && hostToken === masterToken);
        if (!isValidHost) {
          return {
            ok: false,
            code: 'bad_host_token',
            error: 'Host token không hợp lệ hoặc phòng đã có người quản trị.'
          };
        }
      } else {
        // Người đầu tiên vào với vai trò host sẽ nhận quyền quản trị phòng
        if (hostToken) {
          room.hostToken = hostToken;
        }
        room.hostClaimed = true;
        issuedHostToken = room.hostToken;
      }
    }

    // Nếu kết nối đang ở phòng khác thì rời phòng cũ trước
    if (ws.currentRoom && ws.currentRoom !== normalizedCode) {
      this.leaveRoom(ws);
    }

    const alreadyInRoom = room.clients.has(ws);
    ws.currentRoom = normalizedCode;
    ws.role = role;
    ws.clientName = clientName;
    ws.deviceId = deviceId || ws.deviceId || ws.connectionId || crypto.randomUUID();

    room.clients.add(ws);
    this.touchRoom(room);

    if (!alreadyInRoom) {
      room.stats.totalJoined += 1;
    }
    if (room.clients.size > room.stats.peakConcurrent) {
      room.stats.peakConcurrent = room.clients.size;
    }

    return {
      ok: true,
      room,
      issuedHostToken: role === 'host' ? (issuedHostToken || room.hostToken) : undefined
    };
  }

  /**
   * Xử lý khi kết nối rời phòng hoặc đóng tab
   */
  leaveRoom(ws) {
    const code = ws.currentRoom;
    if (!code) return null;

    const room = this.rooms.get(code);
    ws.currentRoom = null;

    if (!room) return null;

    room.clients.delete(ws);
    this.touchRoom(room);
    return room;
  }

  /**
   * Kiểm tra kết nối hiện tại có quyền Host hay không
   */
  isAuthorizedHost(ws, room, providedToken = '') {
    if (!room) return false;
    if (ws && ws.role === 'host' && ws.currentRoom === room.roomCode) return true;
    if (providedToken && providedToken === room.hostToken) return true;
    return false;
  }

  /**
   * Phát bản tin tới các kết nối trong phòng, tự động tăng Sequence ID (seq) và lưu log
   */
  broadcastToRoom(roomCode, type, payload, options = {}) {
    const room = this.getRoom(roomCode);
    if (!room) return null;

    const {
      recordLog = true,
      filterRole = null // Mảng các role nhận tin (null = tất cả)
    } = options;

    const now = Date.now();
    this.touchRoom(room);

    let seq = room.seq;
    if (recordLog) {
      room.seq += 1;
      seq = room.seq;
    }

    const envelope = {
      type,
      roomCode: room.roomCode,
      seq,
      timestamp: now,
      payload
    };

    if (recordLog && !filterRole) {
      room.eventLog.push(envelope);
      if (room.eventLog.length > MAX_EVENT_LOG_SIZE) {
        room.eventLog.shift();
      }
    }

    const serialized = JSON.stringify(envelope);
    for (const client of room.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      if (Array.isArray(filterRole) && !filterRole.includes(client.role)) continue;
      client.send(serialized);
    }

    return envelope;
  }

  /**
   * Thống kê Presence hiện tại của phòng
   */
  getPresencePayload(roomCode) {
    const room = this.getRoom(roomCode);
    if (!room) return null;

    let studentCount = 0;
    for (const client of room.clients) {
      if (client.role === 'student') studentCount += 1;
    }

    const activeQuestions = room.questions.filter((q) => !q.answered).length;
    const currentGroup = room.groups.get(room.currentGroupId);

    return {
      roomCode: room.roomCode,
      onlineCount: room.clients.size,
      studentCount,
      peakConcurrent: room.stats.peakConcurrent,
      activeQuestions,
      totalQuestions: room.questions.length,
      totalRatings: room.ratings.size,
      totalReactions: room.stats.totalReactions || 0,
      currentGroupId: room.currentGroupId,
      currentGroupName: currentGroup ? currentGroup.name : 'Nhóm 1'
    };
  }

  /**
   * Chuyển đổi đối tượng câu hỏi sang JSON sạch (ẩn danh tập _voters nội bộ)
   */
  _serializeQuestion(q) {
    return {
      id: q.id,
      content: q.content,
      text: q.content, // Tương thích trực tiếp với UI Student
      authorName: q.authorName,
      author: q.authorName,
      isAnonymous: q.isAnonymous,
      isAnon: q.isAnonymous,
      category: q.category || 'question',
      groupId: q.groupId || 'grp_1',
      groupName: q.groupName || '',
      votes: q.votes,
      pinned: q.pinned,
      answered: q.answered,
      reply: q.reply || '',
      repliedBy: q.repliedBy || '',
      repliedAt: q.repliedAt || null,
      createdAt: q.createdAt
    };
  }

  /**
   * Lấy danh sách câu hỏi đã sắp xếp chuẩn (Ghim lên đầu -> Nhiều vote nhất -> Mới nhất)
   */
  getSortedQuestions(roomCode) {
    const room = this.getRoom(roomCode);
    if (!room) return [];

    return [...room.questions]
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        if (b.votes !== a.votes) return b.votes - a.votes;
        return b.createdAt - a.createdAt;
      })
      .map((q) => this._serializeQuestion(q));
  }

  /**
   * Thêm câu hỏi mới từ sinh viên (hỗ trợ gắn Tag phân loại category: question | feedback | bug | tech)
   */
  addQuestion(roomCode, { content, isAnonymous = false, authorName = 'Sinh viên', category = 'question' }) {
    const room = this.getRoom(roomCode);
    if (!room) {
      return { ok: false, code: 'room_not_found', error: 'Phòng không tồn tại.' };
    }

    if (!room.settings.qnaOpen) {
      return {
        ok: false,
        code: 'qna_closed',
        error: 'Người quản trị hiện đang khóa chức năng nhận câu hỏi.'
      };
    }

    const cleanedContent = filterBadWords(content);
    const cleanedAuthor = isAnonymous ? 'Ẩn danh' : filterBadWords(authorName);
    const currentGroup = room.groups.get(room.currentGroupId);

    const question = {
      id: `q_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
      content: cleanedContent,
      authorName: cleanedAuthor,
      isAnonymous: Boolean(isAnonymous),
      category: category || 'question',
      groupId: room.currentGroupId,
      groupName: currentGroup ? currentGroup.name : 'Nhóm 1',
      votes: 0,
      pinned: false,
      answered: false,
      reply: '',
      repliedBy: '',
      repliedAt: null,
      createdAt: Date.now(),
      _voters: new Set() // Lưu mã băm thiết bị để chống vote lặp mà vẫn ẩn danh
    };

    room.questions.push(question);
    this.touchRoom(room);

    return {
      ok: true,
      question: this._serializeQuestion(question)
    };
  }

  /**
   * Ghi chú câu trả lời chính thức của Host hoặc Nhóm thuyết trình cho một câu hỏi
   */
  replyQuestion(roomCode, { questionId, reply, repliedBy = 'Nhóm thuyết trình' }) {
    const room = this.getRoom(roomCode);
    if (!room) {
      return { ok: false, code: 'room_not_found', error: 'Phòng không tồn tại.' };
    }

    const question = room.questions.find((q) => String(q.id) === String(questionId));
    if (!question) {
      return { ok: false, code: 'question_not_found', error: 'Không tìm thấy câu hỏi cần trả lời.' };
    }

    question.reply = filterBadWords(reply);
    question.repliedBy = filterBadWords(repliedBy);
    question.repliedAt = Date.now();
    question.answered = true;

    this.touchRoom(room);
    return {
      ok: true,
      question: this._serializeQuestion(question)
    };
  }

  /**
   * Bình chọn (Upvote) câu hỏi - Đảm bảo mỗi thiết bị chỉ được vote 1 lần / câu
   */
  upvoteQuestion(roomCode, { questionId, deviceId }) {
    const room = this.getRoom(roomCode);
    if (!room) {
      return { ok: false, code: 'room_not_found', error: 'Phòng không tồn tại.' };
    }

    const question = room.questions.find((q) => String(q.id) === String(questionId));
    if (!question) {
      return { ok: false, code: 'question_not_found', error: 'Không tìm thấy câu hỏi này.' };
    }

    const voterHash = this._hashDevice(room, deviceId || 'unknown');
    if (question._voters.has(voterHash)) {
      return {
        ok: false,
        code: 'already_voted',
        error: 'Bạn đã bình chọn cho câu hỏi này rồi.'
      };
    }

    question._voters.add(voterHash);
    question.votes += 1;
    this.touchRoom(room);

    return {
      ok: true,
      questionId: question.id,
      newVotes: question.votes,
      question: this._serializeQuestion(question)
    };
  }

  /**
   * Host ghim / đánh dấu đã trả lời / xóa câu hỏi
   */
  moderateQuestion(roomCode, { questionId, action }) {
    const room = this.getRoom(roomCode);
    if (!room) {
      return { ok: false, code: 'room_not_found', error: 'Phòng không tồn tại.' };
    }

    const idx = room.questions.findIndex((q) => String(q.id) === String(questionId));
    if (idx === -1) {
      return { ok: false, code: 'question_not_found', error: 'Không tìm thấy câu hỏi.' };
    }

    const question = room.questions[idx];
    if (action === 'delete') {
      room.questions.splice(idx, 1);
      this.touchRoom(room);
      return { ok: true, deletedId: question.id };
    }

    if (action === 'pin') {
      question.pinned = !question.pinned;
    } else if (action === 'answered') {
      question.answered = !question.answered;
    }

    this.touchRoom(room);
    return {
      ok: true,
      question: this._serializeQuestion(question)
    };
  }

  /**
   * Thêm một nhóm thuyết trình mới vào danh sách phòng
   */
  addGroup(roomCode, { name, topic = '', switchImmediately = false }) {
    const room = this.getRoom(roomCode);
    if (!room) {
      return { ok: false, code: 'room_not_found', error: 'Phòng không tồn tại.' };
    }

    const nextIdx = room.groups.size + 1;
    const groupId = `grp_${nextIdx}_${crypto.randomBytes(2).toString('hex')}`;
    const groupObj = {
      id: groupId,
      name: filterBadWords(name || `Nhóm ${nextIdx}`),
      topic: filterBadWords(topic || ''),
      createdAt: Date.now(),
      ratings: new Map()
    };

    room.groups.set(groupId, groupObj);

    if (switchImmediately) {
      room.currentGroupId = groupId;
      room.ratings = groupObj.ratings;
      room.settings.resultPublished = false;
    }

    this.touchRoom(room);
    return {
      ok: true,
      group: { id: groupObj.id, name: groupObj.name, topic: groupObj.topic },
      groupsPayload: this.getGroupsPayload(roomCode)
    };
  }

  /**
   * Chuyển sang nhóm thuyết trình khác (hoặc tự động tạo mới nếu truyền tên nhóm chưa có)
   * Lưu giữ trọn vẹn điểm của nhóm cũ trong Bảng xếp hạng (Leaderboard)
   */
  switchGroup(roomCode, { groupId = '', name = '', topic = '' }) {
    const room = this.getRoom(roomCode);
    if (!room) {
      return { ok: false, code: 'room_not_found', error: 'Phòng không tồn tại.' };
    }

    let targetGroup = null;
    if (groupId && room.groups.has(groupId)) {
      targetGroup = room.groups.get(groupId);
    } else if (name) {
      for (const grp of room.groups.values()) {
        if (grp.name.toLowerCase() === name.trim().toLowerCase()) {
          targetGroup = grp;
          break;
        }
      }
      if (!targetGroup) {
        const added = this.addGroup(roomCode, { name, topic, switchImmediately: true });
        return {
          ok: true,
          currentGroupId: room.currentGroupId,
          groupsPayload: added.groupsPayload
        };
      }
    }

    if (!targetGroup) {
      return {
        ok: false,
        code: 'group_not_found',
        error: 'Không tìm thấy nhóm thuyết trình yêu cầu.'
      };
    }

    room.currentGroupId = targetGroup.id;
    room.ratings = targetGroup.ratings;
    room.settings.resultPublished = false; // Ẩn biểu đồ nhóm cũ để bắt đầu chấm nhóm mới
    this.touchRoom(room);

    return {
      ok: true,
      currentGroupId: room.currentGroupId,
      groupsPayload: this.getGroupsPayload(roomCode)
    };
  }

  /**
   * Tính toán điểm trung bình của 1 bảng ratings Map (tách riêng Giảng viên, Sinh viên & Trọng số)
   */
  _computeGroupStats(ratingsMap, settings) {
    const zeroAvg = { content: 0, presentation: 0, demo: 0, qa: 0, overall: 0 };
    const totalVotes = ratingsMap ? ratingsMap.size : 0;
    if (!ratingsMap || totalVotes === 0) {
      return {
        totalVotes: 0,
        studentVotes: 0,
        hostVotes: 0,
        averages: { ...zeroAvg },
        studentAverages: { ...zeroAvg },
        hostAverages: { ...zeroAvg },
        weightedAverages: { ...zeroAvg },
        comments: []
      };
    }

    const allSums = { content: 0, presentation: 0, demo: 0, qa: 0 };
    const studentSums = { content: 0, presentation: 0, demo: 0, qa: 0 };
    const hostSums = { content: 0, presentation: 0, demo: 0, qa: 0 };
    let studentVotes = 0;
    let hostVotes = 0;
    const comments = [];

    for (const entry of ratingsMap.values()) {
      const isHost = entry.role === 'host';
      if (isHost) {
        hostVotes += 1;
      } else {
        studentVotes += 1;
      }

      for (const key of RUBRIC_CRITERIA) {
        const val = Number(entry[key]) || 0;
        allSums[key] += val;
        if (isHost) {
          hostSums[key] += val;
        } else {
          studentSums[key] += val;
        }
      }

      if (entry.comment) {
        comments.push({
          comment: entry.comment,
          role: entry.role || 'student',
          authorName: entry.authorName || (isHost ? 'Giảng viên' : 'Sinh viên'),
          overall:
            Math.round(
              (((Number(entry.content) || 0) +
                (Number(entry.presentation) || 0) +
                (Number(entry.demo) || 0) +
                (Number(entry.qa) || 0)) /
                4) *
                100
            ) / 100,
          submittedAt: entry.submittedAt
        });
      }
    }

    const calcAvgObj = (sumsObj, count) => {
      if (count <= 0) return { ...zeroAvg };
      const res = {};
      let sumAvg = 0;
      for (const key of RUBRIC_CRITERIA) {
        res[key] = Math.round((sumsObj[key] / count) * 100) / 100;
        sumAvg += res[key];
      }
      res.overall = Math.round((sumAvg / RUBRIC_CRITERIA.length) * 1000) / 1000;
      return res;
    };

    const averages = calcAvgObj(allSums, totalVotes);
    const studentAverages = calcAvgObj(studentSums, studentVotes);
    const hostAverages = calcAvgObj(hostSums, hostVotes);

    // Nếu cả Giảng viên và Sinh viên đều chấm -> áp dụng công thức trọng số (Mặc định 50% GV + 50% SV)
    const hW = typeof settings?.hostWeight === 'number' ? settings.hostWeight : 0.5;
    const sW = typeof settings?.studentWeight === 'number' ? settings.studentWeight : 0.5;
    let weightedAverages = { ...averages };

    if (hostVotes > 0 && studentVotes > 0) {
      const wRes = {};
      let wSum = 0;
      for (const key of RUBRIC_CRITERIA) {
        wRes[key] = Math.round((hostAverages[key] * hW + studentAverages[key] * sW) * 100) / 100;
        wSum += wRes[key];
      }
      wRes.overall = Math.round((wSum / RUBRIC_CRITERIA.length) * 1000) / 1000;
      weightedAverages = wRes;
    } else if (hostVotes > 0) {
      weightedAverages = { ...hostAverages };
    } else if (studentVotes > 0) {
      weightedAverages = { ...studentAverages };
    }

    comments.sort((a, b) => b.submittedAt - a.submittedAt);

    return {
      totalVotes,
      studentVotes,
      hostVotes,
      averages,
      studentAverages,
      hostAverages,
      weightedAverages,
      comments: comments.slice(0, 20)
    };
  }

  /**
   * Trả về danh sách các Nhóm thuyết trình và Bảng xếp hạng (Leaderboard) sắp xếp theo điểm cao nhất
   */
  getGroupsPayload(roomCode) {
    const room = this.getRoom(roomCode);
    if (!room) return null;

    const groups = [];
    for (const grp of room.groups.values()) {
      const stats = this._computeGroupStats(grp.ratings, room.settings);
      groups.push({
        id: grp.id,
        name: grp.name,
        topic: grp.topic,
        isCurrent: grp.id === room.currentGroupId,
        totalVotes: stats.totalVotes,
        studentVotes: stats.studentVotes,
        hostVotes: stats.hostVotes,
        overallScore: stats.averages.overall,
        weightedScore: stats.weightedAverages.overall,
        averages: stats.averages,
        weightedAverages: stats.weightedAverages
      });
    }

    const leaderboard = [...groups]
      .sort((a, b) => {
        if (b.weightedScore !== a.weightedScore) return b.weightedScore - a.weightedScore;
        return b.totalVotes - a.totalVotes;
      })
      .map((item, index) => ({
        rank: index + 1,
        ...item
      }));

    const currentGroup = groups.find((g) => g.id === room.currentGroupId) || groups[0];

    return {
      currentGroupId: room.currentGroupId,
      currentGroup,
      groups,
      leaderboard
    };
  }

  /**
   * Ghi nhận phiếu chấm điểm Rubric 1-5 sao cho 4 tiêu chí kèm nhận xét phản biện & vai trò (host | student)
   * (1 phiếu / thiết bị / nhóm; nếu chấm lại sẽ cập nhật phiếu của thiết bị đó)
   */
  submitRating(roomCode, { scores, deviceId, role = 'student', comment = '', authorName = '' }) {
    const room = this.getRoom(roomCode);
    if (!room) {
      return { ok: false, code: 'room_not_found', error: 'Phòng không tồn tại.' };
    }

    if (!room.settings.ratingOpen && role !== 'host') {
      return {
        ok: false,
        code: 'rating_closed',
        error: 'Người quản trị hiện đang khóa chức năng chấm điểm Rubric.'
      };
    }

    const voterHash = this._hashDevice(room, `${role}:${deviceId || 'unknown'}`);
    const isUpdate = room.ratings.has(voterHash);
    const cleanedComment = comment ? filterBadWords(comment) : '';
    const cleanedAuthor = authorName
      ? filterBadWords(authorName)
      : role === 'host'
        ? 'Giảng viên'
        : 'Sinh viên';

    room.ratings.set(voterHash, {
      content: scores.content,
      presentation: scores.presentation,
      demo: scores.demo,
      qa: scores.qa,
      role: role === 'host' ? 'host' : 'student',
      comment: cleanedComment,
      authorName: cleanedAuthor,
      submittedAt: Date.now()
    });

    this.touchRoom(room);

    return {
      ok: true,
      isUpdate,
      totalVotes: room.ratings.size,
      summary: this.getRatingSummary(roomCode)
    };
  }

  /**
   * Tính điểm trung bình từng tiêu chí, điểm trọng số GV/SV, nhận xét & Bảng xếp hạng của phòng
   */
  getRatingSummary(roomCode) {
    const room = this.getRoom(roomCode);
    if (!room) return null;

    const currentGroup = room.groups.get(room.currentGroupId);
    const stats = this._computeGroupStats(room.ratings, room.settings);
    const groupsPayload = this.getGroupsPayload(roomCode);

    return {
      groupId: room.currentGroupId,
      groupName: currentGroup ? currentGroup.name : 'Nhóm 1',
      totalVotes: stats.totalVotes,
      studentVotes: stats.studentVotes,
      hostVotes: stats.hostVotes,
      published: room.settings.resultPublished,
      averages: stats.averages,
      studentAverages: stats.studentAverages,
      hostAverages: stats.hostAverages,
      weightedAverages: stats.weightedAverages,
      comments: stats.comments,
      leaderboard: groupsPayload ? groupsPayload.leaderboard : []
    };
  }

  /**
   * Cập nhật trạng thái trình chiếu Slide đồng bộ (slide.sync)
   */
  updateSlideState(roomCode, { action = 'sync', page, total, url, title, slides }) {
    const room = this.getRoom(roomCode);
    if (!room) {
      return { ok: false, code: 'room_not_found', error: 'Phòng không tồn tại.' };
    }

    const st = room.slideState;

    if (Array.isArray(slides)) {
      if (slides.length > 0) {
        st.slides = slides;
        st.total = slides.length;
        st.page = 1;
        st.isCustomDeck = true;
      } else if (st.isCustomDeck) {
        // Khi Host bấm "Gỡ PPT" (gửi slides: []), khôi phục về bộ 5 Slide mặc định của hệ thống
        st.slides = DEFAULT_SLIDE_DECK.map((s) => ({ ...s }));
        st.total = DEFAULT_SLIDE_DECK.length;
        st.page = 1;
        st.title = 'Bộ Slide Thuyết Trình';
        st.isCustomDeck = false;
      }
    }

    if (typeof total === 'number' && total >= 1) {
      st.total = total;
    }
    if (typeof url === 'string') {
      st.url = url;
    }
    if (typeof title === 'string' && title) {
      st.title = title;
    }

    if (action === 'next') {
      st.page = Math.min(st.total, st.page + 1);
    } else if (action === 'prev') {
      st.page = Math.max(1, st.page - 1);
    } else if (typeof page === 'number' && page >= 1) {
      st.page = Math.min(st.total, Math.max(1, page));
    }

    const currentSlideObj =
      Array.isArray(st.slides) && st.slides[st.page - 1] ? st.slides[st.page - 1] : null;

    this.touchRoom(room);
    return {
      ok: true,
      slideState: {
        ...st,
        slides: st.isCustomDeck ? st.slides : [],
        currentSlide: currentSlideObj
      }
    };
  }

  /**
   * Cập nhật tọa độ con trỏ Laser đỏ thời gian thực (slide.laser)
   */
  updateLaserState(roomCode, laserData) {
    const room = this.getRoom(roomCode);
    if (!room) return null;

    room.slideState.laser = {
      active: Boolean(laserData.active),
      x: Number(laserData.x) || 0,
      y: Number(laserData.y) || 0,
      color: laserData.color || '#ef4444',
      updatedAt: Date.now()
    };

    return room.slideState.laser;
  }

  /**
   * Cập nhật trạng thái khung Camera Diễn giả PiP trên màn chiếu (stage.camera)
   */
  updateCameraState(roomCode, cameraData) {
    const room = this.getRoom(roomCode);
    if (!room) return null;

    room.cameraState = {
      ...room.cameraState,
      ...cameraData,
      updatedAt: Date.now()
    };

    this.touchRoom(room);
    return { ...room.cameraState };
  }

  /**
   * Ghi nhận lượt thả cảm xúc trực tiếp (reaction.send)
   */
  recordReaction(roomCode, { emoji = '👏', authorName = 'Sinh viên' }) {
    const room = this.getRoom(roomCode);
    if (!room) return null;

    room.stats.totalReactions = (room.stats.totalReactions || 0) + 1;
    room.reactionCounts[emoji] = (room.reactionCounts[emoji] || 0) + 1;
    this.touchRoom(room);

    return {
      id: `rx_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
      emoji,
      authorName: filterBadWords(authorName),
      totalReactions: room.stats.totalReactions,
      reactionCounts: { ...room.reactionCounts },
      timestamp: Date.now()
    };
  }

  /**
   * Host thay đổi cài đặt phòng (đóng/mở Q&A, đóng/mở Rubric, công bố kết quả)
   */
  updateSettings(roomCode, partialSettings = {}) {
    const room = this.getRoom(roomCode);
    if (!room) return null;

    if (typeof partialSettings.qnaOpen === 'boolean') {
      room.settings.qnaOpen = partialSettings.qnaOpen;
    }
    if (typeof partialSettings.ratingOpen === 'boolean') {
      room.settings.ratingOpen = partialSettings.ratingOpen;
    }
    if (typeof partialSettings.resultPublished === 'boolean') {
      room.settings.resultPublished = partialSettings.resultPublished;
    }

    this.touchRoom(room);
    return { ...room.settings };
  }

  /**
   * Thu thập khảo sát độ hài lòng thực tế phục vụ thống kê Bài 3
   */
  submitSurvey(roomCode, { rating, level, comment }) {
    const entry = {
      roomCode: roomCode || 'GLOBAL',
      rating,
      level,
      comment,
      submittedAt: Date.now()
    };

    this.globalSurveys.push(entry);
    const room = this.getRoom(roomCode);
    if (room) {
      room.surveys.push(entry);
      this.touchRoom(room);
    }

    const sum = this.globalSurveys.reduce((acc, s) => acc + s.rating, 0);
    const avgSatisfaction =
      Math.round((sum / this.globalSurveys.length) * 100) / 100;

    return {
      totalResponses: this.globalSurveys.length,
      averageSatisfaction: avgSatisfaction
    };
  }

  /**
   * Trả về trạng thái đầy đủ của phòng (Snapshot) hoặc các bản tin bị lỡ theo lastSeq (sync.resume)
   */
  getResumeData(roomCode, lastSeq, role = 'student') {
    const room = this.getRoom(roomCode);
    if (!room) return null;

    if (
      typeof lastSeq === 'number' &&
      lastSeq > 0 &&
      room.eventLog.length > 0 &&
      lastSeq >= room.eventLog[0].seq - 1 &&
      lastSeq <= room.seq
    ) {
      const missedEvents = room.eventLog.filter((ev) => ev.seq > lastSeq);
      return {
        mode: 'delta',
        currentSeq: room.seq,
        missedEvents
      };
    }

    return {
      mode: 'snapshot',
      currentSeq: room.seq,
      snapshot: this.getRoomSnapshot(roomCode, role)
    };
  }

  /**
   * Snapshot trạng thái hiện tại của phòng khi vừa vào hoặc khôi phục kết nối
   */
  getRoomSnapshot(roomCode, role = 'student') {
    const room = this.getRoom(roomCode);
    if (!room) return null;

    const showRatingSummary = role === 'host' || room.settings.resultPublished;
    const groupsPayload = this.getGroupsPayload(roomCode);
    const currentSlideObj =
      Array.isArray(room.slideState.slides) && room.slideState.slides[room.slideState.page - 1]
        ? room.slideState.slides[room.slideState.page - 1]
        : null;

    return {
      roomCode: room.roomCode,
      title: room.title,
      seq: room.seq,
      settings: { ...room.settings },
      presence: this.getPresencePayload(roomCode),
      questions: this.getSortedQuestions(roomCode),
      timer: this.timerManager ? this.timerManager.getSyncPayload(roomCode) : null,
      ratingSummary: showRatingSummary ? this.getRatingSummary(roomCode) : null,
      groups: groupsPayload,
      slide: {
        ...room.slideState,
        slides: room.slideState.isCustomDeck ? room.slideState.slides : [],
        currentSlide: currentSlideObj
      },
      camera: { ...room.cameraState },
      reactions: {
        totalReactions: room.stats.totalReactions || 0,
        counts: { ...room.reactionCounts }
      }
    };
  }

  /**
   * Xuất báo cáo CSV chuẩn UTF-8 BOM cho Giảng viên (Mở trực tiếp bằng Microsoft Excel không lỗi font tiếng Việt)
   */
  exportRoomCSV(roomCode) {
    const room = this.getRoom(roomCode);
    if (!room) return null;

    const escapeCsv = (val) => {
      const str = String(val ?? '').replace(/"/g, '""');
      return `"${str}"`;
    };

    const summary = this.getRatingSummary(roomCode);
    const groupsPayload = this.getGroupsPayload(roomCode);
    const questions = this.getSortedQuestions(roomCode);
    const lines = [];

    lines.push('BAO CAO BUOI THUYET TRINH - CLASSLIVE PRO');
    lines.push(`Ma Phong,${escapeCsv(room.roomCode)}`);
    lines.push(`Tieu De,${escapeCsv(room.title)}`);
    lines.push(`Nhom Hien Tai,${escapeCsv(summary.groupName)}`);
    lines.push(`So Nguoi Tham Gia Dinh (Peak),${room.stats.peakConcurrent}`);
    lines.push(`Tong So Phieu Cham Rubric,${summary.totalVotes}`);
    lines.push(`Tong Luot Tha Cam Xuc (Reactions),${room.stats.totalReactions || 0}`);
    lines.push('');

    lines.push('BANG DIEM RUBRIC TRUNG BINH (THANG 5 SAO)');
    lines.push('Tieu Chi,Diem Trung Binh,Diem Giang Vien,Diem Sinh Vien,Diem Trong So');
    lines.push(`1. Noi dung bao cao,${summary.averages.content},${summary.hostAverages.content},${summary.studentAverages.content},${summary.weightedAverages.content}`);
    lines.push(`2. Ky nang trinh bay,${summary.averages.presentation},${summary.hostAverages.presentation},${summary.studentAverages.presentation},${summary.weightedAverages.presentation}`);
    lines.push(`3. San pham / Demo thuc te,${summary.averages.demo},${summary.hostAverages.demo},${summary.studentAverages.demo},${summary.weightedAverages.demo}`);
    lines.push(`4. Tra loi phan bien,${summary.averages.qa},${summary.hostAverages.qa},${summary.studentAverages.qa},${summary.weightedAverages.qa}`);
    lines.push(`DIEM TONG HOP,${summary.averages.overall},${summary.hostAverages.overall},${summary.studentAverages.overall},${summary.weightedAverages.overall}`);
    lines.push('');

    if (groupsPayload && groupsPayload.leaderboard.length > 0) {
      lines.push('BANG XEP HANG CAC NHOM THUYET TRINH (LEADERBOARD)');
      lines.push('Hang,Ten Nhom,Chu De,So Phieu,Diem Trung Binh,Diem Trong So');
      groupsPayload.leaderboard.forEach((grp) => {
        lines.push(
          [
            grp.rank,
            escapeCsv(grp.name),
            escapeCsv(grp.topic),
            grp.totalVotes,
            grp.overallScore,
            grp.weightedScore
          ].join(',')
        );
      });
      lines.push('');
    }

    if (summary.comments && summary.comments.length > 0) {
      lines.push('NHAN XET VA GOP Y PHAN BIEN RUBRIC');
      lines.push('STT,Vai Tro,Nguoi Nhan Xet,Diem TB,Noi Dung Nhan Xet');
      summary.comments.forEach((c, idx) => {
        lines.push(
          [
            idx + 1,
            escapeCsv(c.role === 'host' ? 'Giang vien' : 'Sinh vien'),
            escapeCsv(c.authorName),
            c.overall,
            escapeCsv(c.comment)
          ].join(',')
        );
      });
      lines.push('');
    }

    lines.push('DANH SACH CAU HOI HOI DAP (SAP XEP THEO LUOT VOTE)');
    lines.push('STT,Nhom,Phan Loai,Nguoi Hoi,Noi Dung Cau Hoi,Luot Vote,Da Ghim,Trang Thai,Cau Tra Loi / Ghi Chu,Thoi Gian');
    questions.forEach((q, idx) => {
      const timeStr = new Date(q.createdAt).toISOString();
      lines.push(
        [
          idx + 1,
          escapeCsv(q.groupName || 'Nhom 1'),
          escapeCsv(q.category || 'question'),
          escapeCsv(q.authorName),
          escapeCsv(q.content),
          q.votes,
          q.pinned ? 'Co' : 'Khong',
          q.answered ? 'Da tra loi' : 'Cho tra loi',
          escapeCsv(q.reply || ''),
          escapeCsv(timeStr)
        ].join(',')
      );
    });

    return '\uFEFF' + lines.join('\r\n');
  }

  /**
   * Thống kê tổng quan toàn bộ hệ thống (phục vụ đánh giá thực tế Bài 3)
   */
  getGlobalStats() {
    let activeConnections = 0;
    let totalQuestions = 0;
    let totalRatings = 0;

    const roomSummaries = [];
    for (const room of this.rooms.values()) {
      activeConnections += room.clients.size;
      totalQuestions += room.questions.length;
      totalRatings += room.ratings.size;
      roomSummaries.push({
        roomCode: room.roomCode,
        title: room.title,
        onlineCount: room.clients.size,
        peakConcurrent: room.stats.peakConcurrent,
        questionsCount: room.questions.length,
        ratingsCount: room.ratings.size
      });
    }

    const surveyCount = this.globalSurveys.length;
    const avgSatisfaction =
      surveyCount > 0
        ? Math.round(
            (this.globalSurveys.reduce((acc, s) => acc + s.rating, 0) / surveyCount) * 100
          ) / 100
        : 0;

    return {
      activeRooms: this.rooms.size,
      totalRoomsCreated: this.totalRoomsCreated,
      activeConnections,
      totalQuestions,
      totalRatings,
      survey: {
        totalResponses: surveyCount,
        averageSatisfaction: avgSatisfaction
      },
      rooms: roomSummaries
    };
  }

  /**
   * Tự động thu hồi các phòng trống và không hoạt động quá ROOM_TTL_MS (30 phút)
   */
  cleanupInactiveRooms(ttlMs = ROOM_TTL_MS) {
    const now = Date.now();
    let removed = 0;

    for (const [code, room] of this.rooms.entries()) {
      if (room.clients.size === 0 && now - room.lastActiveAt > ttlMs) {
        this.rooms.delete(code);
        if (this.timerManager) {
          this.timerManager.removeTimer(code);
        }
        removed += 1;
      }
    }

    return removed;
  }
}

module.exports = RoomManager;
