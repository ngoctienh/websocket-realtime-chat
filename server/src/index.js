const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const MessageTypes = require('./protocols/messageTypes');

const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', service: 'ClassLive Pro WebSocket Server' }));
});

const wss = new WebSocketServer({ server });

// Bộ nhớ lưu trữ tạm thời các phòng đang chạy
const rooms = new Map();

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  ws.currentRoom = null;
  ws.role = 'student';

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      handleMessage(ws, message);
    } catch (err) {
      ws.send(JSON.stringify({ type: MessageTypes.ERROR, message: 'Invalid JSON payload' }));
    }
  });

  ws.on('close', () => {
    if (ws.currentRoom && rooms.has(ws.currentRoom)) {
      const room = rooms.get(ws.currentRoom);
      room.clients.delete(ws);
      broadcastPresence(ws.currentRoom);
      if (room.clients.size === 0) {
        rooms.delete(ws.currentRoom);
      }
    }
  });
});

function handleMessage(ws, message) {
  switch (message.type) {
    case MessageTypes.ROOM_JOIN: {
      const { roomCode, role = 'student' } = message.payload || {};
      if (!roomCode) return;

      if (!rooms.has(roomCode)) {
        rooms.set(roomCode, { clients: new Set(), questions: [] });
      }

      ws.currentRoom = roomCode;
      ws.role = role;
      rooms.get(roomCode).clients.add(ws);

      broadcastPresence(roomCode);
      break;
    }

    case MessageTypes.HEARTBEAT_PING: {
      ws.send(JSON.stringify({ type: MessageTypes.HEARTBEAT_PONG, timestamp: Date.now() }));
      break;
    }

    default:
      // Broadcast lại các sự kiện khác (question, upvote, rubric) cho phòng
      if (ws.currentRoom && rooms.has(ws.currentRoom)) {
        const room = rooms.get(ws.currentRoom);
        for (const client of room.clients) {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
          }
        }
      }
      break;
  }
}

function broadcastPresence(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;

  const payload = {
    type: MessageTypes.PRESENCE_UPDATE,
    payload: {
      onlineCount: room.clients.size,
      roomCode
    }
  };

  for (const client of room.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(payload));
    }
  }
}

// Heartbeat định kỳ kiểm tra các kết nối chết
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => {
  clearInterval(interval);
});

server.listen(PORT, () => {
  console.log(`[ClassLive Pro] WebSocket Server is listening on port ${PORT}`);
});
