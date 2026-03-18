'use strict';

const express = require('express');
const http    = require('http');
const path    = require('path');
const { Server } = require('socket.io');
const { UnoGame } = require('./game');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

app.use(express.static(path.join(__dirname, '../client')));

// ─── Room Manager ────────────────────────────────────────────
const rooms = new Map(); // roomId → UnoGame

function getOrCreateRoom(roomId, settings) {
  if (!rooms.has(roomId)) rooms.set(roomId, new UnoGame(settings));
  return rooms.get(roomId);
}

function getRoomList() {
  return Array.from(rooms.entries()).map(([id, game]) => ({
    roomId:      id,
    playerCount: game.players.length,
    status:      game.status,
    canJoin:     game.status === 'waiting' && game.players.length < 10,
  }));
}

function broadcastRoomList() {
  io.emit('room-list', getRoomList());
}

function broadcastLobby(roomId) {
  const game = rooms.get(roomId);
  if (!game) return;
  io.to(roomId).emit('lobby-state', game.getLobbyState());
}

function broadcastGame(roomId) {
  const game = rooms.get(roomId);
  if (!game) return;
  for (const p of game.players) {
    const sock = io.sockets.sockets.get(p.id);
    if (sock) sock.emit('game-state', game.getStateFor(p.id));
  }
}

// ─── Socket events ───────────────────────────────────────────
io.on('connection', socket => {
  let roomId = null;

  socket.emit('room-list', getRoomList());

  // ── 加入房间 ──────────────────────────────
  socket.on('join-room', ({ roomId: rid, playerName, settings }) => {
    if (!rid || !playerName) return;
    doLeave();

    const game = getOrCreateRoom(rid, settings || {});
    if (game.status !== 'waiting') {
      socket.emit('error', { message: '房间游戏已开始，无法加入' });
      return;
    }

    const ok = game.addPlayer(socket.id, playerName.trim().slice(0, 16));
    if (!ok) {
      socket.emit('error', { message: '加入失败（房间已满或名字重复）' });
      return;
    }

    socket.join(rid);
    roomId = rid;
    socket.emit('joined', { roomId: rid, playerId: socket.id });
    broadcastLobby(rid);
    broadcastRoomList();
  });

  // ── 准备 / 取消准备 ────────────────────────
  socket.on('set-ready', ({ ready }) => {
    if (!roomId) return;
    const game = rooms.get(roomId);
    if (!game || game.status !== 'waiting') return;

    game.setReady(socket.id, !!ready);
    broadcastLobby(roomId);

    // 所有人准备后自动开始
    if (game.canStart()) {
      game.start();
      broadcastGame(roomId);
      broadcastRoomList();
    }
  });

  // ── 出牌 ──────────────────────────────────
  socket.on('play-card', ({ cardId, chosenColor }) => {
    if (!roomId) return;
    const game = rooms.get(roomId);
    if (!game) return;

    const result = game.playCard(socket.id, cardId, chosenColor || null);
    if (!result.ok) { socket.emit('error', { message: result.reason }); return; }

    broadcastGame(roomId);
    if (result.finished) {
      io.to(roomId).emit('game-over', result.winner);
      broadcastRoomList();
    }
  });

  // ── 摸牌 ──────────────────────────────────
  socket.on('draw-card', () => {
    if (!roomId) return;
    const game = rooms.get(roomId);
    if (!game) return;

    const result = game.drawCard(socket.id);
    if (!result.ok) return;
    broadcastGame(roomId);
  });

  // ── 喊 UNO ────────────────────────────────
  socket.on('say-uno', () => {
    if (!roomId) return;
    const game = rooms.get(roomId);
    if (!game) return;
    const ok = game.sayUno(socket.id);
    if (ok) {
      const p = game.players.find(p => p.id === socket.id);
      io.to(roomId).emit('uno-called', { playerId: socket.id, playerName: p?.name });
    }
  });

  // ── 抓 UNO ────────────────────────────────
  socket.on('catch-uno', ({ targetId }) => {
    if (!roomId) return;
    const game = rooms.get(roomId);
    if (!game) return;
    const ok = game.catchUno(socket.id, targetId);
    if (ok) {
      const target = game.players.find(p => p.id === targetId);
      io.to(roomId).emit('uno-caught', { targetId, targetName: target?.name });
      broadcastGame(roomId);
    }
  });

  // ── 再来一局 ──────────────────────────────
  socket.on('play-again', () => {
    if (!roomId) return;
    const game = rooms.get(roomId);
    if (!game || game.status !== 'finished') return;
    game.status = 'waiting';
    for (const p of game.players) { p.ready = false; p.hand = []; }
    broadcastLobby(roomId);
    broadcastRoomList();
  });

  // ── 断开连接 ──────────────────────────────
  socket.on('disconnect', doLeave);

  function doLeave() {
    if (!roomId) return;
    const game = rooms.get(roomId);
    if (game) {
      game.removePlayer(socket.id);
      socket.leave(roomId);
      if (game.players.length === 0) {
        rooms.delete(roomId);
      } else {
        broadcastLobby(roomId);
        broadcastGame(roomId);
      }
      broadcastRoomList();
    }
    roomId = null;
  }
});

const PORT = process.env.PORT || 3004;
server.listen(PORT, () => console.log(`UNO server running on port ${PORT}`));
