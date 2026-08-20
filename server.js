// server.js
// Сигнальний сервер для P2P трансляції екрана через WebRTC.
// Сам відеопотік НЕ проходить через цей сервер — він потрібен лише
// для обміну SDP/ICE повідомленнями між двома учасниками кімнати.

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

// roomId -> Set(ws)
const rooms = new Map();

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

wss.on('connection', (ws) => {
  ws.roomId = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      return;
    }

    if (msg.type === 'join') {
      const roomId = String(msg.roomId || 'default');

      if (!rooms.has(roomId)) rooms.set(roomId, new Set());
      const room = rooms.get(roomId);

      if (room.size >= 2) {
        send(ws, { type: 'room-full' });
        return;
      }

      room.add(ws);
      ws.roomId = roomId;

      send(ws, { type: 'joined', peers: room.size - 1 });

      // Повідомляємо іншого учасника (якщо є), що з'явився новий peer
      for (const peer of room) {
        if (peer !== ws) {
          send(peer, { type: 'peer-joined' });
        }
      }
      return;
    }

    // Ретрансляція offer/answer/ice-candidate іншому учаснику в тій же кімнаті
    if (['offer', 'answer', 'ice-candidate'].includes(msg.type)) {
      const room = rooms.get(ws.roomId);
      if (!room) return;
      for (const peer of room) {
        if (peer !== ws) {
          send(peer, msg);
        }
      }
    }
  });

  ws.on('close', () => {
    if (ws.roomId && rooms.has(ws.roomId)) {
      const room = rooms.get(ws.roomId);
      room.delete(ws);
      for (const peer of room) {
        send(peer, { type: 'peer-left' });
      }
      if (room.size === 0) rooms.delete(ws.roomId);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сигнальний сервер запущено: http://localhost:${PORT}`);
});
