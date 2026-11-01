const test = require('node:test');
const assert = require('node:assert/strict');
const { WebSocket } = require('ws');
const { createClassLiveServer } = require('../src/index');
const MessageTypes = require('../src/protocols/messageTypes');

/**
 * Helper mở kết nối WebSocket kèm hàng đợi sự kiện bất đồng bộ phục vụ kiểm thử
 */
function connectTestClient(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const inbox = [];
    const waiters = [];

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString('utf8'));
      for (let i = 0; i < waiters.length; i++) {
        if (waiters[i].predicate(msg)) {
          const [{ resolve: res, timer }] = waiters.splice(i, 1);
          clearTimeout(timer);
          res(msg);
          return;
        }
      }
      inbox.push(msg);
    });

    ws.waitFor = (typeOrPredicate, timeoutMs = 3000) => {
      const predicate =
        typeof typeOrPredicate === 'function'
          ? typeOrPredicate
          : (m) => m.type === typeOrPredicate;

      const idx = inbox.findIndex(predicate);
      if (idx !== -1) {
        const [found] = inbox.splice(idx, 1);
        return Promise.resolve(found);
      }

      return new Promise((res, rej) => {
        const timer = setTimeout(() => {
          rej(new Error(`Timeout chờ bản tin WebSocket (${String(typeOrPredicate)})`));
        }, timeoutMs);
        waiters.push({ predicate, resolve: res, timer });
      });
    };

    ws.sendJson = (type, payload = {}, roomCode = '') => {
      ws.send(JSON.stringify({ type, roomCode, payload, timestamp: Date.now() }));
    };

    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

test('ClassLive Pro WebSocket Server - Kiểm thử toàn diện giao thức & nghiệp vụ', async (t) => {
  const app = createClassLiveServer({ port: 0 });
  const port = await app.start(0);
  const baseWsUrl = `ws://127.0.0.1:${port}`;
  const baseHttpUrl = `http://127.0.0.1:${port}`;

  t.after(async () => {
    await app.close();
  });

  let roomPin = '';
  let hostToken = '';

  await t.test('1. Tạo phòng PIN 4 số & bảo vệ phân quyền Host Token', async () => {
    const hostWs = await connectTestClient(`${baseWsUrl}/ws`);
    hostWs.sendJson(MessageTypes.ROOM_CREATE, { title: 'Nhóm 3 Báo Cáo WebSocket' });

    const createdMsg = await hostWs.waitFor(MessageTypes.ROOM_CREATED);
    assert.match(createdMsg.payload.roomCode, /^\d{4}$/, 'Mã PIN phải gồm 4 chữ số');
    assert.ok(createdMsg.payload.hostToken.length >= 16, 'Phải sinh hostToken bảo mật');

    roomPin = createdMsg.payload.roomCode;
    hostToken = createdMsg.payload.hostToken;

    // Kẻ mạo danh thử join làm host không có token hợp lệ -> phải bị từ chối
    const fakeHostWs = await connectTestClient(`${baseWsUrl}/ws`);
    fakeHostWs.sendJson(MessageTypes.ROOM_JOIN, { role: 'host', hostToken: 'wrong_token' }, roomPin);

    const errMsg = await fakeHostWs.waitFor(MessageTypes.ERROR);
    assert.equal(errMsg.payload.code, 'bad_host_token');

    hostWs.close();
    fakeHostWs.close();
  });

  await t.test('2. Hỏi đáp Q&A, lọc từ ngữ xấu & giới hạn chống spam 3 câu/phút', async () => {
    const studentWs = await connectTestClient(
      `${baseWsUrl}/ws?pin=${roomPin}&role=student&deviceId=dev_student_1`
    );
    await studentWs.waitFor(MessageTypes.ROOM_JOINED);

    // Câu 1: chứa từ xấu -> phải tự động lọc thành ***
    studentWs.sendJson(MessageTypes.QUESTION_ADD, {
      content: 'Demo hay vcl nhóm ơi, WebSocket chạy thế nào?',
      isAnonymous: true
    });
    const q1 = await studentWs.waitFor(MessageTypes.QUESTION_BROADCAST);
    assert.equal(q1.payload.authorName, 'Ẩn danh');
    assert.ok(q1.payload.content.includes('***'), 'Từ xấu phải bị thay bằng ***');
    assert.ok(!q1.payload.content.includes('vcl'));

    // Câu 2 & Câu 3: hợp lệ (đạt ngưỡng 3 câu/phút)
    studentWs.sendJson(MessageTypes.QUESTION_ADD, { content: 'Câu hỏi số 2?' });
    await studentWs.waitFor(MessageTypes.QUESTION_BROADCAST);

    studentWs.sendJson(MessageTypes.QUESTION_ADD, { content: 'Câu hỏi số 3?' });
    await studentWs.waitFor(MessageTypes.QUESTION_BROADCAST);

    // Câu 4 trong cùng 1 phút -> phải bị Rate Limit chặn lại
    studentWs.sendJson(MessageTypes.QUESTION_ADD, { content: 'Câu hỏi spam số 4?' });
    const rateErr = await studentWs.waitFor(MessageTypes.ERROR);
    assert.equal(rateErr.payload.code, 'rate_limited');

    studentWs.close();
  });

  await t.test('3. Bình chọn Upvote & chống vote lặp ẩn danh trên cùng thiết bị', async () => {
    const voterWs = await connectTestClient(`${baseWsUrl}/ws`);
    voterWs.sendJson(
      MessageTypes.ROOM_JOIN,
      { role: 'student', deviceId: 'unique_phone_abc' },
      roomPin
    );
    const joined = await voterWs.waitFor(MessageTypes.ROOM_JOINED);
    const targetQuestionId = joined.payload.snapshot.questions[0].id;

    // Vote lần 1 -> thành công
    voterWs.sendJson(MessageTypes.QUESTION_UPVOTE, {
      questionId: targetQuestionId,
      deviceId: 'unique_phone_abc'
    });
    const voted = await voterWs.waitFor(MessageTypes.QUESTION_VOTED);
    assert.equal(voted.payload.newVotes, 1);

    // Vote lần 2 cùng deviceId -> bị chặn
    voterWs.sendJson(MessageTypes.QUESTION_UPVOTE, {
      questionId: targetQuestionId,
      deviceId: 'unique_phone_abc'
    });
    const dupErr = await voterWs.waitFor(MessageTypes.ERROR);
    assert.equal(dupErr.payload.code, 'already_voted');

    voterWs.close();
  });

  await t.test('4. Chấm điểm Rubric 4 tiêu chí & nút Công bố kết quả của Host', async () => {
    const hostWs = await connectTestClient(`${baseWsUrl}/ws`);
    hostWs.sendJson(MessageTypes.ROOM_JOIN, { role: 'host', hostToken }, roomPin);
    await hostWs.waitFor(MessageTypes.ROOM_JOINED);

    const projectorWs = await connectTestClient(`${baseWsUrl}/ws?pin=${roomPin}&role=projector`);
    await projectorWs.waitFor(MessageTypes.ROOM_JOINED);

    const sv1 = await connectTestClient(`${baseWsUrl}/ws?pin=${roomPin}&role=student&deviceId=sv_rate_1`);
    const sv2 = await connectTestClient(`${baseWsUrl}/ws?pin=${roomPin}&role=student&deviceId=sv_rate_2`);
    await sv1.waitFor(MessageTypes.ROOM_JOINED);
    await sv2.waitFor(MessageTypes.ROOM_JOINED);

    sv1.sendJson(MessageTypes.RATING_SUBMIT, {
      deviceId: 'sv_rate_1',
      scores: { content: 5, presentation: 4, demo: 5, qa: 4 }
    });
    await sv1.waitFor(MessageTypes.RATING_SUBMITTED);
    await sv1.waitFor(MessageTypes.RATING_SUCCESS);

    sv2.sendJson(MessageTypes.RATING_SUBMIT, {
      deviceId: 'sv_rate_2',
      scores: { content: 4, presentation: 4, demo: 5, qa: 5 }
    });
    await sv2.waitFor(MessageTypes.RATING_SUBMITTED);
    await sv2.waitFor(MessageTypes.RATING_SUCCESS);

    // Host bấm "Công bố kết quả" -> Projector nhận ngay biểu đồ điểm trung bình
    hostWs.sendJson(MessageTypes.RATING_PUBLISH, { published: true });
    const summaryMsg = await projectorWs.waitFor(MessageTypes.RATING_SUMMARY);

    assert.equal(summaryMsg.payload.totalVotes, 2);
    assert.equal(summaryMsg.payload.averages.content, 4.5);
    assert.equal(summaryMsg.payload.averages.presentation, 4);
    assert.equal(summaryMsg.payload.averages.demo, 5);
    assert.equal(summaryMsg.payload.averages.qa, 4.5);
    assert.equal(summaryMsg.payload.averages.overall, 4.5);

    hostWs.close();
    projectorWs.close();
    sv1.close();
    sv2.close();
  });

  await t.test('5. Đồng bộ đồng hồ 15 phút & khôi phục gói tin bị lỡ qua sync.resume', async () => {
    const hostWs = await connectTestClient(`${baseWsUrl}/ws`);
    hostWs.sendJson(MessageTypes.ROOM_JOIN, { role: 'host', hostToken }, roomPin);
    const joinedHost = await hostWs.waitFor(MessageTypes.ROOM_JOINED);
    const seqBefore = joinedHost.payload.snapshot.seq;

    // Bấm chạy đồng hồ 15 phút (900 giây)
    hostWs.sendJson(MessageTypes.TIMER_CONTROL, { action: 'start' });
    const timerSync = await hostWs.waitFor(
      (m) => m.type === MessageTypes.TIMER_SYNC && m.payload.status === 'running'
    );
    assert.equal(timerSync.payload.duration, 900);

    // Phát thêm 1 câu hỏi để tăng seq
    hostWs.sendJson(MessageTypes.QUESTION_ADD, { content: 'Câu hỏi kiểm tra sync.resume' });
    await hostWs.waitFor(MessageTypes.QUESTION_BROADCAST);

    // Một máy vừa kết nối lại sau khi rớt mạng gửi lastSeq = seqBefore
    const reconnectWs = await connectTestClient(`${baseWsUrl}/ws`);
    reconnectWs.sendJson(
      MessageTypes.SYNC_RESUME,
      { lastSeq: seqBefore, role: 'student', deviceId: 'reconnected_phone' },
      roomPin
    );
    const syncState = await reconnectWs.waitFor(MessageTypes.SYNC_STATE);
    assert.equal(syncState.payload.mode, 'delta');
    assert.ok(syncState.payload.missedEvents.length >= 1, 'Phải nhận lại bản tin bị lỡ');

    // Kiểm tra xuất báo cáo CSV qua HTTP
    const csvRes = await fetch(`${baseHttpUrl}/api/rooms/${roomPin}/export.csv`);
    assert.equal(csvRes.status, 200);
    const csvText = await csvRes.text();
    assert.ok(csvText.includes('BAO CAO BUOI THUYET TRINH - CLASSLIVE PRO'));
    assert.ok(csvText.includes('DIEM TONG HOP,4.5'));

    hostWs.close();
    reconnectWs.close();
  });

  await t.test('6. Tương thích payload UI Host & Student (toggle enabled & survey string)', async () => {
    const hostWs = await connectTestClient(`${baseWsUrl}/ws`);
    hostWs.sendJson(MessageTypes.ROOM_JOIN, { role: 'host', hostToken }, roomPin);
    await hostWs.waitFor(MessageTypes.ROOM_JOINED);

    // Host khóa nhận câu hỏi bằng payload { enabled: false }
    hostWs.sendJson(MessageTypes.QUESTION_TOGGLE, { enabled: false }, roomPin);
    const qLocked = await hostWs.waitFor(
      (m) => m.type === MessageTypes.ROOM_SETTINGS && m.payload.qnaOpen === false
    );
    assert.equal(qLocked.payload.qnaOpen, false);

    // Host mở lại nhận câu hỏi bằng payload { enabled: true }
    hostWs.sendJson(MessageTypes.QUESTION_TOGGLE, { enabled: true }, roomPin);
    const qOpened = await hostWs.waitFor(
      (m) => m.type === MessageTypes.ROOM_SETTINGS && m.payload.qnaOpen === true
    );
    assert.equal(qOpened.payload.qnaOpen, true);

    // Khảo sát CSAT từ UI Host gửi chuỗi 'satisfied' (4) và 'normal' (3)
    hostWs.sendJson(MessageTypes.SURVEY_SUBMIT, { rating: 'satisfied' }, roomPin);
    const ack1 = await hostWs.waitFor(MessageTypes.SURVEY_ACK);
    assert.equal(ack1.payload.averageSatisfaction, 4);

    hostWs.sendJson(MessageTypes.SURVEY_SUBMIT, { rating: 'normal' }, roomPin);
    const ack2 = await hostWs.waitFor(MessageTypes.SURVEY_ACK);
    assert.equal(ack2.payload.averageSatisfaction, 3.5);

    hostWs.close();
  });
});
