const { performance } = require('node:perf_hooks');
const { WebSocket } = require('ws');
const { createClassLiveServer } = require('../src/index');
const MessageTypes = require('../src/protocols/messageTypes');

const TOTAL_CLIENTS = Number(process.env.LOAD_CLIENTS) || 100;
const MAX_ACCEPTABLE_P95_MS = 300;

function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return 0;
  const idx = Math.min(sortedArr.length - 1, Math.ceil((p / 100) * sortedArr.length) - 1);
  return Math.round(sortedArr[idx] * 100) / 100;
}

function openClient(wsUrl, pin, role, idx) {
  return new Promise((resolve, reject) => {
    const startConnect = performance.now();
    const ws = new WebSocket(
      `${wsUrl}/ws?pin=${pin}&role=${role}&deviceId=load_dev_${idx}&name=SV_${idx}`
    );

    const state = {
      ws,
      idx,
      role,
      connectMs: 0,
      pingRttMs: 0,
      broadcastLatencies: []
    };

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString('utf8'));
      if (msg.type === MessageTypes.ROOM_JOINED && state.connectMs === 0) {
        state.connectMs = performance.now() - startConnect;
        resolve(state);
      } else if (msg.type === MessageTypes.HEARTBEAT_PONG && state._pingSentAt) {
        state.pingRttMs = performance.now() - state._pingSentAt;
        if (state._onPong) state._onPong();
      } else if (msg.type === MessageTypes.QUESTION_BROADCAST && state._expectBroadcastSentAt) {
        state.broadcastLatencies.push(performance.now() - state._expectBroadcastSentAt);
        if (state._onBroadcast) state._onBroadcast(msg.payload);
      }
    });

    ws.once('error', reject);
  });
}

async function runLoadTest() {
  console.log('==============================================================');
  console.log(`🚀 BẮT ĐẦU KIỂM THỬ TẢI WEBSOCKET (${TOTAL_CLIENTS} KẾT NỐI ĐỒNG THỜI)`);
  console.log('==============================================================');

  let localServer = null;
  let wsUrl = process.env.TARGET_WS_URL;

  if (!wsUrl) {
    localServer = createClassLiveServer({ port: 0 });
    const port = await localServer.start(0);
    wsUrl = `ws://127.0.0.1:${port}`;
  }

  const roomPin = '8899';
  const clients = [];

  try {
    // Bước 1: Mở đồng thời 100 kết nối vào cùng 1 phòng (1 Host + 1 Projector + 98 Sinh viên)
    const connectBatchStart = performance.now();
    const connectPromises = [];
    for (let i = 0; i < TOTAL_CLIENTS; i++) {
      const role = i === 0 ? 'host' : i === 1 ? 'projector' : 'student';
      connectPromises.push(openClient(wsUrl, roomPin, role, i));
    }

    const connectedClients = await Promise.all(connectPromises);
    clients.push(...connectedClients);
    const totalConnectTimeMs = Math.round((performance.now() - connectBatchStart) * 100) / 100;

    // Bước 2: Đo độ trễ RTT Ping/Pong trên toàn bộ 100 kết nối cùng lúc
    await Promise.all(
      clients.map(
        (c) =>
          new Promise((resolve) => {
            c._onPong = resolve;
            c._pingSentAt = performance.now();
            c.ws.send(JSON.stringify({ type: MessageTypes.HEARTBEAT_PING, timestamp: Date.now() }));
          })
      )
    );

    // Bước 3: Kiểm thử Broadcast Fan-out (1 SV gửi câu hỏi -> 100 thiết bị nhận đồng thời)
    let broadcastedQuestionId = null;
    const broadcastPromises = clients.map(
      (c) =>
        new Promise((resolve) => {
          c._onBroadcast = (qPayload) => {
            broadcastedQuestionId = qPayload.id;
            resolve();
          };
        })
    );

    const broadcastSentAt = performance.now();
    clients.forEach((c) => {
      c._expectBroadcastSentAt = broadcastSentAt;
    });

    clients[2].ws.send(
      JSON.stringify({
        type: MessageTypes.QUESTION_ADD,
        roomCode: roomPin,
        payload: {
          content: 'Kiểm thử broadcast fan-out tới 100 kết nối đồng thời!',
          isAnonymous: false,
          authorName: 'SV Kiểm Thử'
        }
      })
    );

    await Promise.all(broadcastPromises);

    // Bước 4: 50 sinh viên cùng bấm Upvote & 50 sinh viên cùng gửi chấm điểm Rubric đồng thời
    for (let i = 2; i < Math.min(52, clients.length); i++) {
      clients[i].ws.send(
        JSON.stringify({
          type: MessageTypes.QUESTION_UPVOTE,
          roomCode: roomPin,
          payload: {
            questionId: broadcastedQuestionId,
            deviceId: `load_dev_${i}`
          }
        })
      );

      clients[i].ws.send(
        JSON.stringify({
          type: MessageTypes.RATING_SUBMIT,
          roomCode: roomPin,
          payload: {
            deviceId: `load_dev_${i}`,
            scores: { content: 5, presentation: 4, demo: 5, qa: 5 }
          }
        })
      );
    }

    // Chờ xử lý toàn bộ gói tin đồng thời
    await new Promise((r) => setTimeout(r, 250));

    // Tổng hợp thống kê độ trễ
    const rtts = clients.map((c) => c.pingRttMs).sort((a, b) => a - b);
    const fanouts = clients.map((c) => c.broadcastLatencies[0] || 0).sort((a, b) => a - b);

    const avgRtt = Math.round((rtts.reduce((a, b) => a + b, 0) / rtts.length) * 100) / 100;
    const avgFanout =
      Math.round((fanouts.reduce((a, b) => a + b, 0) / fanouts.length) * 100) / 100;
    const p95Fanout = percentile(fanouts, 95);
    const p99Fanout = percentile(fanouts, 99);
    const maxFanout = Math.round(fanouts[fanouts.length - 1] * 100) / 100;

    console.log('\n📊 KẾT QUẢ ĐO ĐẠC HIỆU NĂNG:');
    console.log(`- Số kết nối đồng thời thành công : ${clients.length} / ${TOTAL_CLIENTS} (100%)`);
    console.log(`- Tổng thời gian thiết lập 100 WS : ${totalConnectTimeMs} ms`);
    console.log(`- Độ trễ Ping/Pong trung bình     : ${avgRtt} ms (P95: ${percentile(rtts, 95)} ms)`);
    console.log(`- Độ trễ Broadcast 1 -> 100 máy   : TB = ${avgFanout} ms | P95 = ${p95Fanout} ms | P99 = ${p99Fanout} ms | Max = ${maxFanout} ms`);

    if (localServer) {
      const roomSnapshot = localServer.roomManager.getRoomSnapshot(roomPin, 'host');
      console.log(`- Số người đỉnh ghi nhận (Peak)   : ${roomSnapshot.presence.peakConcurrent} kết nối`);
      console.log(`- Tổng lượt Upvote xử lý chuẩn    : ${roomSnapshot.questions[0].votes} / 50 phiếu`);
      console.log(`- Tổng phiếu Rubric xử lý chuẩn   : ${roomSnapshot.ratingSummary.totalVotes} / 50 phiếu (Điểm TB: ${roomSnapshot.ratingSummary.averages.overall})`);

      if (roomSnapshot.presence.peakConcurrent < TOTAL_CLIENTS) {
        throw new Error('Peak concurrent nhỏ hơn số lượng kết nối mục tiêu!');
      }
      if (roomSnapshot.questions[0].votes !== Math.min(50, TOTAL_CLIENTS - 2)) {
        throw new Error('Số phiếu Upvote cộng dồn không chính xác khi chịu tải cao!');
      }
    }

    if (p95Fanout > MAX_ACCEPTABLE_P95_MS) {
      throw new Error(`Độ trễ P95 (${p95Fanout} ms) vượt ngưỡng yêu cầu ${MAX_ACCEPTABLE_P95_MS} ms!`);
    }

    console.log('\n✅ KẾT LUẬN: ĐẠT TIÊU CHUẨN KỸ THUẬT (100 CCU, Độ trễ P95 < 300ms, 0% mất gói tin)!');
    console.log('==============================================================');
  } finally {
    for (const c of clients) {
      try {
        c.ws.close();
      } catch (_) {}
    }
    if (localServer) {
      await localServer.close();
    }
  }
}

runLoadTest().catch((err) => {
  console.error('\n❌ KIỂM THỬ TẢI THẤT BẠI:', err);
  process.exit(1);
});
