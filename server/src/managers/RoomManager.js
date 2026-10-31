const crypto = require('crypto');
const { WebSocket } = require('ws');
const {
  ROOM_TTL_MS,
  MAX_EVENT_LOG_SIZE,
  RUBRIC_CRITERIA
} = require('../config/constants');
const { filterBadWords } = require('../middlewares/badWordsFilter');

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
      ratings: new Map(), // voterHash -> { content, presentation, demo, qa, submittedAt }
      surveys: [],
      settings: {
        qnaOpen: true,
        ratingOpen: true,
        resultPublished: false
      },
      stats: {
        peakConcurrent: 0,
        totalJoined: 0
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

    return {
      roomCode: room.roomCode,
      onlineCount: room.clients.size,
      studentCount,
      peakConcurrent: room.stats.peakConcurrent,
      activeQuestions,
      totalQuestions: room.questions.length,
      totalRatings: room.ratings.size
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
      votes: q.votes,
      pinned: q.pinned,
      answered: q.answered,
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
   * Thêm câu hỏi mới từ sinh viên
   */
  addQuestion(roomCode, { content, isAnonymous = false, authorName = 'Sinh viên' }) {
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

    const question = {
      id: `q_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
      content: cleanedContent,
      authorName: cleanedAuthor,
      isAnonymous: Boolean(isAnonymous),
      votes: 0,
      pinned: false,
      answered: false,
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
   * Ghi nhận phiếu chấm điểm Rubric 1-5 sao cho 4 tiêu chí
   * (1 phiếu / thiết bị, nếu cùng thiết bị chấm lại sẽ cập nhật phiếu của thiết bị đó)
   */
  submitRating(roomCode, { scores, deviceId }) {
    const room = this.getRoom(roomCode);
    if (!room) {
      return { ok: false, code: 'room_not_found', error: 'Phòng không tồn tại.' };
    }

    if (!room.settings.ratingOpen) {
      return {
        ok: false,
        code: 'rating_closed',
        error: 'Người quản trị hiện đang khóa chức năng chấm điểm Rubric.'
      };
    }

    const voterHash = this._hashDevice(room, deviceId || 'unknown');
    const isUpdate = room.ratings.has(voterHash);

    room.ratings.set(voterHash, {
      content: scores.content,
      presentation: scores.presentation,
      demo: scores.demo,
      qa: scores.qa,
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
   * Tính điểm trung bình từng tiêu chí và điểm tổng hợp của phòng
   */
  getRatingSummary(roomCode) {
    const room = this.getRoom(roomCode);
    if (!room) return null;

    const totalVotes = room.ratings.size;
    if (totalVotes === 0) {
      return {
        totalVotes: 0,
        published: room.settings.resultPublished,
        averages: {
          content: 0,
          presentation: 0,
          demo: 0,
          qa: 0,
          overall: 0
        }
      };
    }

    const sums = { content: 0, presentation: 0, demo: 0, qa: 0 };
    for (const entry of room.ratings.values()) {
      for (const key of RUBRIC_CRITERIA) {
        sums[key] += Number(entry[key]) || 0;
      }
    }

    const averages = {};
    let totalAvgSum = 0;
    for (const key of RUBRIC_CRITERIA) {
      averages[key] = Math.round((sums[key] / totalVotes) * 100) / 100;
      totalAvgSum += averages[key];
    }
    averages.overall = Math.round((totalAvgSum / RUBRIC_CRITERIA.length) * 1000) / 1000;

    return {
      totalVotes,
      published: room.settings.resultPublished,
      averages
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

    return {
      roomCode: room.roomCode,
      title: room.title,
      seq: room.seq,
      settings: { ...room.settings },
      presence: this.getPresencePayload(roomCode),
      questions: this.getSortedQuestions(roomCode),
      timer: this.timerManager ? this.timerManager.getSyncPayload(roomCode) : null,
      ratingSummary: showRatingSummary ? this.getRatingSummary(roomCode) : null
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
    const questions = this.getSortedQuestions(roomCode);
    const lines = [];

    lines.push('BAO CAO BUOI THUYET TRINH - CLASSLIVE PRO');
    lines.push(`Ma Phong,${escapeCsv(room.roomCode)}`);
    lines.push(`Tieu De,${escapeCsv(room.title)}`);
    lines.push(`So Nguoi Tham Gia Dinh (Peak),${room.stats.peakConcurrent}`);
    lines.push(`Tong So Phieu Cham Rubric,${summary.totalVotes}`);
    lines.push('');

    lines.push('BANG DIEM RUBRIC TRUNG BINH (THANG 5 SAO)');
    lines.push('Tieu Chi,Diem Trung Binh');
    lines.push(`1. Noi dung bao cao,${summary.averages.content}`);
    lines.push(`2. Ky nang trinh bay,${summary.averages.presentation}`);
    lines.push(`3. San pham / Demo thuc te,${summary.averages.demo}`);
    lines.push(`4. Tra loi phan bien,${summary.averages.qa}`);
    lines.push(`DIEM TONG HOP,${summary.averages.overall}`);
    lines.push('');

    lines.push('DANH SACH CAU HOI HOI DAP (SAP XEP THEO LUOT VOTE)');
    lines.push('STT,Nguoi Hoi,Noi Dung Cau Hoi,Luot Vote,Da Ghim,Da Tra Loi,Thoi Gian');
    questions.forEach((q, idx) => {
      const timeStr = new Date(q.createdAt).toISOString();
      lines.push(
        [
          idx + 1,
          escapeCsv(q.authorName),
          escapeCsv(q.content),
          q.votes,
          q.pinned ? 'Co' : 'Khong',
          q.answered ? 'Da tra loi' : 'Cho tra loi',
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
