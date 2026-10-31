const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const { WebSocketServer, WebSocket } = require('ws');

const Constants = require('./config/constants');
const MessageTypes = require('./protocols/messageTypes');
const Validator = require('./protocols/payloadValidator');
const { RateLimiter } = require('./middlewares/rateLimiter');
const TimerManager = require('./managers/TimerManager');
const RoomManager = require('./managers/RoomManager');

/**
 * Khởi tạo cụm HTTP + WebSocket Server cho ClassLive Pro (Chuẩn RFC 6455)
 * Tách thành hàm factory để vừa chạy thực tế vừa phục vụ kiểm thử tự động / test tải
 */
function createClassLiveServer(options = {}) {
  const port = options.port !== undefined ? Number(options.port) : Constants.PORT;
  const heartbeatIntervalMs = options.heartbeatIntervalMs || Constants.HEARTBEAT_INTERVAL_MS;
  const cleanupIntervalMs = options.cleanupIntervalMs || Constants.ROOM_CLEANUP_INTERVAL_MS;

  const rateLimiter = new RateLimiter(options.rateLimit || {});

  let roomManager = null;
  const timerManager = new TimerManager((roomCode, syncPayload) => {
    if (roomManager) {
      roomManager.broadcastToRoom(roomCode, MessageTypes.TIMER_SYNC, syncPayload, {
        recordLog: false
      });
    }
  });
  roomManager = new RoomManager(timerManager);

  const startedAt = Date.now();
  const clientViewsRoot = path.resolve(__dirname, '../../client/src/views');

  // ==================== HTTP HELPER & REST API ====================

  function setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Host-Token');
  }

  function sendJson(res, statusCode, body) {
    setCorsHeaders(res);
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  }

  function readJsonBody(req) {
    return new Promise((resolve, reject) => {
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
        if (raw.length > Constants.MAX_PAYLOAD_BYTES) {
          reject(new Error('Payload too large'));
          req.destroy();
        }
      });
      req.on('end', () => {
        if (!raw.trim()) return resolve({});
        try {
          resolve(JSON.parse(raw));
        } catch (err) {
          reject(new Error('Invalid JSON'));
        }
      });
      req.on('error', reject);
    });
  }

  function serveViewHtml(res, viewName) {
    const filePath = path.join(clientViewsRoot, viewName, 'index.html');
    if (!fs.existsSync(filePath)) {
      return sendJson(res, 404, { error: `View "${viewName}" chưa được tạo.` });
    }
    setCorsHeaders(res);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(filePath).pipe(res);
  }

  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      setCorsHeaders(res);
      res.writeHead(204);
      return res.end();
    }

    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname.replace(/\/+$/, '') || '/';

    // 1. Health check & thông tin giao thức
    if (req.method === 'GET' && (pathname === '/health' || pathname === '/api/health')) {
      return sendJson(res, 200, {
        status: 'ok',
        service: 'ClassLive Pro WebSocket Server',
        protocol: 'RFC 6455',
        uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
        stats: roomManager.getGlobalStats()
      });
    }

    // 2. Thống kê tổng hợp phục vụ báo cáo Bài 3
    if (req.method === 'GET' && pathname === '/api/stats') {
      return sendJson(res, 200, roomManager.getGlobalStats());
    }

    // 3. Tạo phòng mới qua HTTP POST /api/rooms -> nhận PIN 4 số + hostToken
    if (req.method === 'POST' && pathname === '/api/rooms') {
      try {
        const body = await readJsonBody(req);
        const requestedCode = body.roomCode ? String(body.roomCode).trim().toUpperCase() : '';
        if (requestedCode && !Validator.isValidRoomCode(requestedCode)) {
          return sendJson(res, 400, { error: 'Mã phòng không hợp lệ (4-8 ký tự chữ/số).' });
        }
        const room = roomManager.createRoom({
          roomCode: requestedCode || undefined,
          title: Validator.sanitizeString(body.title || '', 120) || undefined,
          durationSec: Number(body.durationSec) || Constants.DEFAULT_TIMER_DURATION_SEC,
          hostClaimed: true
        });
        return sendJson(res, 201, {
          roomCode: room.roomCode,
          title: room.title,
          hostToken: room.hostToken,
          createdAt: room.createdAt
        });
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }

    // 4. Xuất báo cáo CSV: GET /api/rooms/:code/export.csv
    const csvMatch = pathname.match(/^\/api\/rooms\/([A-Za-z0-9]{4,8})\/export\.csv$/);
    if (req.method === 'GET' && csvMatch) {
      const code = csvMatch[1].toUpperCase();
      const csv = roomManager.exportRoomCSV(code);
      if (!csv) {
        return sendJson(res, 404, { error: `Không tìm thấy phòng ${code}.` });
      }
      setCorsHeaders(res);
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="bao_cao_classlive_${code}.csv"`
      });
      return res.end(csv);
    }

    // 5. Xem trạng thái phòng công khai: GET /api/rooms/:code
    const roomMatch = pathname.match(/^\/api\/rooms\/([A-Za-z0-9]{4,8})$/);
    if (req.method === 'GET' && roomMatch) {
      const code = roomMatch[1].toUpperCase();
      const snapshot = roomManager.getRoomSnapshot(code, 'student');
      if (!snapshot) {
        return sendJson(res, 404, { error: `Không tìm thấy phòng ${code}.` });
      }
      return sendJson(res, 200, snapshot);
    }

    // 6. Gửi khảo sát độ hài lòng thực tế qua HTTP: POST /api/survey
    if (req.method === 'POST' && pathname === '/api/survey') {
      try {
        const body = await readJsonBody(req);
        const check = Validator.validateSurveySubmit(body);
        const result = roomManager.submitSurvey(body.roomCode, check.data);
        return sendJson(res, 201, { status: 'saved', ...result });
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }

    // 7. Phục vụ trực tiếp 3 giao diện tĩnh của nhóm để test nhanh trên cùng cổng
    if (req.method === 'GET' && pathname === '/student') {
      return serveViewHtml(res, 'student');
    }
    if (req.method === 'GET' && pathname === '/host') {
      return serveViewHtml(res, 'host');
    }
    if (req.method === 'GET' && pathname === '/projector') {
      return serveViewHtml(res, 'projector');
    }

    // Mặc định trang gốc trả về thông tin dịch vụ JSON
    if (req.method === 'GET' && pathname === '/') {
      return sendJson(res, 200, {
        status: 'ok',
        service: 'ClassLive Pro WebSocket Server',
        wsEndpoint: 'ws://<host>:' + port + '/ws',
        views: {
          student: '/student',
          host: '/host',
          projector: '/projector'
        },
        api: {
          health: '/health',
          stats: '/api/stats',
          createRoom: 'POST /api/rooms',
          exportCsv: '/api/rooms/:pin/export.csv'
        }
      });
    }

    return sendJson(res, 404, { error: 'Not Found' });
  });

  // ==================== WEBSOCKET SERVER (RFC 6455) ====================

  const wss = new WebSocketServer({
    server,
    maxPayload: Constants.MAX_PAYLOAD_BYTES
  });

  function sendToClient(ws, type, payload = {}, roomCode = '') {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(
      JSON.stringify({
        type,
        roomCode: roomCode || ws.currentRoom || undefined,
        timestamp: Date.now(),
        payload
      })
    );
  }

  function sendError(ws, code, message, extra = {}) {
    sendToClient(ws, MessageTypes.ERROR, {
      code,
      message,
      ...extra
    });
  }

  function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) {
      return forwarded.split(',')[0].trim();
    }
    return req.socket?.remoteAddress || 'unknown';
  }

  function executeJoinRoom(ws, rawRoomCode, payload = {}) {
    const blocked = rateLimiter.isJoinBlocked(ws.clientIp);
    if (blocked) {
      return sendError(
        ws,
        'rate_limited',
        `IP của bạn tạm khóa thử mã PIN. Vui lòng thử lại sau ${blocked.retryAfterSec} giây.`,
        { retryAfterSec: blocked.retryAfterSec }
      );
    }

    const validation = Validator.validateRoomJoin(rawRoomCode, payload);
    if (!validation.valid) {
      rateLimiter.recordJoinFailure(ws.clientIp);
      return sendError(ws, validation.code, validation.error);
    }

    const { roomCode, role, clientName, deviceId, hostToken } = validation.data;
    const joinRes = roomManager.joinRoom(ws, {
      roomCode,
      role,
      clientName,
      deviceId,
      hostToken,
      requireExisting: Boolean(payload.requireExisting)
    });

    if (!joinRes.ok) {
      rateLimiter.recordJoinFailure(ws.clientIp);
      return sendError(ws, joinRes.code, joinRes.error);
    }

    const snapshot = roomManager.getRoomSnapshot(roomCode, ws.role);
    sendToClient(
      ws,
      MessageTypes.ROOM_JOINED,
      {
        roomCode,
        role: ws.role,
        deviceId: ws.deviceId,
        hostToken: joinRes.issuedHostToken,
        snapshot
      },
      roomCode
    );

    // Phát cập nhật số người online (presence.update) cho cả phòng
    roomManager.broadcastToRoom(
      roomCode,
      MessageTypes.PRESENCE_UPDATE,
      roomManager.getPresencePayload(roomCode),
      { recordLog: false }
    );

    // Đồng bộ ngay đồng hồ đếm ngược 15 phút cho thiết bị mới vào
    sendToClient(
      ws,
      MessageTypes.TIMER_SYNC,
      timerManager.getSyncPayload(roomCode),
      roomCode
    );
  }

  wss.on('connection', (ws, req) => {
    ws.connectionId = crypto.randomUUID();
    ws.clientIp = getClientIp(req);
    ws.isAlive = true;
    ws.currentRoom = null;
    ws.role = 'student';
    ws.clientName = 'Sinh viên';
    ws.deviceId = ws.connectionId;

    // Lắng nghe frame Pong chuẩn RFC 6455 cho cơ chế Heartbeat
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    // Hỗ trợ tự động vào phòng nếu Client truyền mã PIN ngay trên URL (VD: /ws?pin=4829&role=student)
    try {
      const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const urlPin = parsedUrl.searchParams.get('pin') || parsedUrl.searchParams.get('roomCode');
      if (urlPin) {
        executeJoinRoom(ws, urlPin, {
          role: parsedUrl.searchParams.get('role') || 'student',
          clientName: parsedUrl.searchParams.get('name') || undefined,
          deviceId: parsedUrl.searchParams.get('deviceId') || undefined,
          hostToken: parsedUrl.searchParams.get('hostToken') || undefined
        });
      }
    } catch (_) {
      // Bỏ qua nếu URL không hợp lệ
    }

    ws.on('message', (rawBuffer, isBinary) => {
      ws.isAlive = true;

      if (isBinary) {
        return sendError(ws, 'unsupported_binary', 'ClassLive Pro chỉ nhận dữ liệu khung văn bản JSON.');
      }

      // Chống flood frame tổng quát trên mỗi kết nối
      const msgLimit = rateLimiter.checkMessageLimit(ws.connectionId);
      if (!msgLimit.allowed) {
        return sendError(
          ws,
          'rate_limited',
          `Gửi gói tin quá nhanh. Vui lòng thử lại sau ${msgLimit.retryAfterSec} giây.`,
          { retryAfterSec: msgLimit.retryAfterSec }
        );
      }

      let parsed;
      try {
        parsed = JSON.parse(rawBuffer.toString('utf8'));
      } catch (err) {
        return sendError(ws, 'invalid_json', 'Định dạng gói tin JSON không hợp lệ.');
      }

      const envCheck = Validator.validateEnvelope(parsed);
      if (!envCheck.valid) {
        return sendError(ws, 'invalid_envelope', envCheck.error);
      }

      handleClientEvent(ws, envCheck.data);
    });

    ws.on('close', () => {
      const previousRoomCode = ws.currentRoom;
      const room = roomManager.leaveRoom(ws);
      if (room && previousRoomCode) {
        roomManager.broadcastToRoom(
          previousRoomCode,
          MessageTypes.PRESENCE_UPDATE,
          roomManager.getPresencePayload(previousRoomCode),
          { recordLog: false }
        );
      }
    });

    ws.on('error', () => {
      // Tránh crash tiến trình khi socket đứt đột ngột
    });
  });

  /**
   * Bộ điều phối (Router) toàn bộ sự kiện nghiệp vụ WebSocket
   */
  function handleClientEvent(ws, message) {
    const { type, roomCode: msgRoomCode, payload, timestamp } = message;
    const activeRoomCode = msgRoomCode || ws.currentRoom;

    switch (type) {
      // 1. Tạo phòng mới với mã PIN 4 số ngẫu nhiên
      case MessageTypes.ROOM_CREATE: {
        const requestedCode = msgRoomCode || '';
        if (requestedCode && !Validator.isValidRoomCode(requestedCode)) {
          return sendError(ws, 'invalid_room_code', 'Mã phòng yêu cầu không hợp lệ.');
        }

        const room = roomManager.createRoom({
          roomCode: requestedCode || undefined,
          title: Validator.sanitizeString(payload.title || '', 120) || undefined,
          durationSec: Number(payload.durationSec) || Constants.DEFAULT_TIMER_DURATION_SEC,
          hostClaimed: true
        });

        executeJoinRoom(ws, room.roomCode, {
          role: 'host',
          clientName: payload.clientName || 'Host',
          deviceId: payload.deviceId,
          hostToken: room.hostToken
        });

        sendToClient(
          ws,
          MessageTypes.ROOM_CREATED,
          {
            roomCode: room.roomCode,
            title: room.title,
            hostToken: room.hostToken
          },
          room.roomCode
        );
        break;
      }

      // 2. Tham gia vào phòng bằng mã PIN
      case MessageTypes.ROOM_JOIN: {
        executeJoinRoom(ws, activeRoomCode, payload);
        break;
      }

      // 3. Rời phòng chủ động
      case MessageTypes.ROOM_LEAVE: {
        const oldCode = ws.currentRoom;
        const room = roomManager.leaveRoom(ws);
        if (room && oldCode) {
          roomManager.broadcastToRoom(
            oldCode,
            MessageTypes.PRESENCE_UPDATE,
            roomManager.getPresencePayload(oldCode),
            { recordLog: false }
          );
        }
        break;
      }

      // 4. Khôi phục các gói tin bị lỡ sau khi rớt mạng (Reconnect + Sequence Sync)
      case MessageTypes.SYNC_RESUME: {
        if (!ws.currentRoom && activeRoomCode) {
          executeJoinRoom(ws, activeRoomCode, payload);
        }
        if (!ws.currentRoom) {
          return sendError(ws, 'not_in_room', 'Cần tham gia phòng trước khi đồng bộ.');
        }

        const lastSeq = Number(payload.lastSeq ?? message.seq ?? 0);
        const resumeData = roomManager.getResumeData(ws.currentRoom, lastSeq, ws.role);
        sendToClient(ws, MessageTypes.SYNC_STATE, resumeData, ws.currentRoom);
        break;
      }

      // 5. Sinh viên gửi câu hỏi mới (Giới hạn chống spam 3 câu/phút + lọc từ xấu)
      case MessageTypes.QUESTION_ADD: {
        if (!ws.currentRoom) {
          return sendError(ws, 'not_in_room', 'Vui lòng vào phòng trước khi đặt câu hỏi.');
        }

        const qCheck = Validator.validateQuestionAdd(payload, ws.clientName);
        if (!qCheck.valid) {
          return sendError(ws, qCheck.code, qCheck.error);
        }

        const rateKey = `${ws.currentRoom}:${ws.deviceId || ws.connectionId}`;
        const qLimit = rateLimiter.checkQuestionLimit(rateKey);
        if (!qLimit.allowed) {
          return sendError(
            ws,
            'rate_limited',
            `Bạn chỉ được gửi tối đa ${Constants.RATE_LIMIT.MAX_QUESTIONS_PER_WINDOW} câu hỏi mỗi phút. Vui lòng chờ ${qLimit.retryAfterSec} giây.`,
            { retryAfterSec: qLimit.retryAfterSec }
          );
        }

        const addRes = roomManager.addQuestion(ws.currentRoom, qCheck.data);
        if (!addRes.ok) {
          return sendError(ws, addRes.code, addRes.error);
        }

        roomManager.broadcastToRoom(
          ws.currentRoom,
          MessageTypes.QUESTION_BROADCAST,
          addRes.question
        );

        roomManager.broadcastToRoom(
          ws.currentRoom,
          MessageTypes.PRESENCE_UPDATE,
          roomManager.getPresencePayload(ws.currentRoom),
          { recordLog: false }
        );
        break;
      }

      // 6. Bình chọn Upvote câu hỏi (1 phiếu / thiết bị / câu)
      case MessageTypes.QUESTION_UPVOTE: {
        if (!ws.currentRoom) {
          return sendError(ws, 'not_in_room', 'Vui lòng vào phòng trước khi bình chọn.');
        }

        const vCheck = Validator.validateQuestionUpvote(payload);
        if (!vCheck.valid) {
          return sendError(ws, vCheck.code, vCheck.error);
        }

        const effectiveDeviceId = vCheck.data.deviceId || ws.deviceId || ws.connectionId;
        const voteRes = roomManager.upvoteQuestion(ws.currentRoom, {
          questionId: vCheck.data.questionId,
          deviceId: effectiveDeviceId
        });

        if (!voteRes.ok) {
          return sendError(ws, voteRes.code, voteRes.error);
        }

        roomManager.broadcastToRoom(ws.currentRoom, MessageTypes.QUESTION_VOTED, {
          questionId: voteRes.questionId,
          newVotes: voteRes.newVotes,
          questions: roomManager.getSortedQuestions(ws.currentRoom)
        });
        break;
      }

      // 7. Quản trị câu hỏi của Host (Ghim / Đã trả lời / Xóa)
      case MessageTypes.QUESTION_PIN:
      case MessageTypes.QUESTION_ANSWERED:
      case MessageTypes.QUESTION_DELETE: {
        const room = roomManager.getRoom(ws.currentRoom);
        if (!roomManager.isAuthorizedHost(ws, room, payload.hostToken)) {
          return sendError(ws, 'forbidden', 'Chỉ Host mới có quyền điều phối câu hỏi.');
        }

        const actionMap = {
          [MessageTypes.QUESTION_PIN]: 'pin',
          [MessageTypes.QUESTION_ANSWERED]: 'answered',
          [MessageTypes.QUESTION_DELETE]: 'delete'
        };

        const modRes = roomManager.moderateQuestion(ws.currentRoom, {
          questionId: payload.questionId || payload.id,
          action: actionMap[type]
        });

        if (!modRes.ok) {
          return sendError(ws, modRes.code, modRes.error);
        }

        roomManager.broadcastToRoom(ws.currentRoom, type, {
          ...modRes,
          questions: roomManager.getSortedQuestions(ws.currentRoom)
        });

        roomManager.broadcastToRoom(
          ws.currentRoom,
          MessageTypes.PRESENCE_UPDATE,
          roomManager.getPresencePayload(ws.currentRoom),
          { recordLog: false }
        );
        break;
      }

      // 8. Chấm điểm Rubric 4 tiêu chí 1-5 sao
      case MessageTypes.RATING_SUBMIT: {
        if (!ws.currentRoom) {
          return sendError(ws, 'not_in_room', 'Vui lòng vào phòng trước khi chấm điểm.');
        }

        const rCheck = Validator.validateRatingSubmit(payload);
        if (!rCheck.valid) {
          return sendError(ws, rCheck.code, rCheck.error);
        }

        const effectiveDeviceId = rCheck.data.deviceId || ws.deviceId || ws.connectionId;
        const rateRes = roomManager.submitRating(ws.currentRoom, {
          scores: rCheck.data.scores,
          deviceId: effectiveDeviceId
        });

        if (!rateRes.ok) {
          return sendError(ws, rateRes.code, rateRes.error);
        }

        sendToClient(
          ws,
          MessageTypes.RATING_SUBMITTED,
          {
            isUpdate: rateRes.isUpdate,
            scores: rCheck.data.scores
          },
          ws.currentRoom
        );

        const room = roomManager.getRoom(ws.currentRoom);
        const targetRoles = room.settings.resultPublished ? null : ['host'];
        roomManager.broadcastToRoom(
          ws.currentRoom,
          MessageTypes.RATING_SUMMARY,
          rateRes.summary,
          {
            recordLog: room.settings.resultPublished,
            filterRole: targetRoles
          }
        );

        roomManager.broadcastToRoom(
          ws.currentRoom,
          MessageTypes.PRESENCE_UPDATE,
          roomManager.getPresencePayload(ws.currentRoom),
          { recordLog: false }
        );
        break;
      }

      // 9. Host đóng/mở nhận câu hỏi, đóng/mở chấm điểm hoặc Công bố kết quả
      case MessageTypes.QUESTION_TOGGLE:
      case MessageTypes.RATING_TOGGLE:
      case MessageTypes.ROOM_SETTINGS:
      case MessageTypes.RATING_PUBLISH: {
        const room = roomManager.getRoom(ws.currentRoom);
        if (!roomManager.isAuthorizedHost(ws, room, payload.hostToken)) {
          return sendError(ws, 'forbidden', 'Chỉ Host mới có quyền thay đổi trạng thái phòng.');
        }

        let updates = {};
        if (type === MessageTypes.QUESTION_TOGGLE) {
          updates.qnaOpen =
            typeof payload.open === 'boolean' ? payload.open : !room.settings.qnaOpen;
        } else if (type === MessageTypes.RATING_TOGGLE) {
          updates.ratingOpen =
            typeof payload.open === 'boolean' ? payload.open : !room.settings.ratingOpen;
        } else if (type === MessageTypes.RATING_PUBLISH) {
          updates.resultPublished =
            typeof payload.published === 'boolean' ? payload.published : true;
        } else {
          updates = payload;
        }

        const newSettings = roomManager.updateSettings(ws.currentRoom, updates);
        roomManager.broadcastToRoom(ws.currentRoom, MessageTypes.ROOM_SETTINGS, newSettings);

        if (newSettings.resultPublished) {
          roomManager.broadcastToRoom(
            ws.currentRoom,
            MessageTypes.RATING_SUMMARY,
            roomManager.getRatingSummary(ws.currentRoom)
          );
        }
        break;
      }

      // 10. Điều khiển đồng hồ đếm ngược 15 phút (Host hoặc màn hình Projector)
      case MessageTypes.TIMER_CONTROL: {
        const room = roomManager.getRoom(ws.currentRoom);
        const canControlTimer =
          roomManager.isAuthorizedHost(ws, room, payload.hostToken) ||
          (ws.role === 'projector' && ws.currentRoom === room?.roomCode);

        if (!canControlTimer) {
          return sendError(ws, 'forbidden', 'Chỉ Host hoặc Projector mới được điều khiển đồng hồ.');
        }

        const tCheck = Validator.validateTimerControl(payload);
        if (!tCheck.valid) {
          return sendError(ws, tCheck.code, tCheck.error);
        }

        timerManager.control(ws.currentRoom, tCheck.data.action, tCheck.data.duration);
        break;
      }

      // 11. Gửi khảo sát độ hài lòng thực tế qua WebSocket (Bài 3)
      case MessageTypes.SURVEY_SUBMIT: {
        const sCheck = Validator.validateSurveySubmit(payload);
        const stats = roomManager.submitSurvey(ws.currentRoom, sCheck.data);
        sendToClient(ws, MessageTypes.SURVEY_ACK, stats, ws.currentRoom);
        break;
      }

      // 12. Đo độ trễ mạng cấp ứng dụng (Ping/Pong JSON)
      case MessageTypes.HEARTBEAT_PING: {
        sendToClient(ws, MessageTypes.HEARTBEAT_PONG, {
          clientTimestamp: timestamp,
          serverTimestamp: Date.now()
        });
        break;
      }

      default:
        sendError(ws, 'unknown_event', `Không hỗ trợ sự kiện "${type}".`);
        break;
    }
  }

  // ==================== HEARTBEAT & CLEANUP DAEMONS ====================

  const heartbeatTimer = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, heartbeatIntervalMs);

  const cleanupTimer = setInterval(() => {
    roomManager.cleanupInactiveRooms();
    rateLimiter.cleanup();
  }, cleanupIntervalMs);

  if (typeof heartbeatTimer.unref === 'function') heartbeatTimer.unref();
  if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();

  function start(listenPort = port) {
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(listenPort, () => {
        const addr = server.address();
        const actualPort = typeof addr === 'object' && addr ? addr.port : listenPort;
        resolve(actualPort);
      });
    });
  }

  function close() {
    return new Promise((resolve) => {
      clearInterval(heartbeatTimer);
      clearInterval(cleanupTimer);
      timerManager.stopTicker();

      for (const client of wss.clients) {
        client.terminate();
      }

      wss.close(() => {
        server.close(() => resolve());
      });
    });
  }

  return {
    server,
    wss,
    roomManager,
    timerManager,
    rateLimiter,
    start,
    close
  };
}

// Nếu file được chạy trực tiếp bằng lệnh `node src/index.js`
if (require.main === module) {
  const instance = createClassLiveServer();
  instance
    .start()
    .then((actualPort) => {
      console.log(`[ClassLive Pro] HTTP & WebSocket Server đang chạy tại cổng ${actualPort}`);
      console.log(`[ClassLive Pro] Health check: http://localhost:${actualPort}/health`);
    })
    .catch((err) => {
      console.error('[ClassLive Pro] Lỗi khởi động server:', err);
      process.exit(1);
    });

  const shutdown = async () => {
    console.log('\n[ClassLive Pro] Đang đóng kết nối an toàn...');
    await instance.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { createClassLiveServer };
