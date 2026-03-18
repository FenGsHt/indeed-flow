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
const rooms          = new Map(); // roomId → UnoGame
const pendingRemovals = new Map(); // `${roomId}:${name}` → { timer }

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

  // ── 结束回合（摸牌后不出牌）──────────────
  socket.on('pass-turn', () => {
    if (!roomId) return;
    const game = rooms.get(roomId);
    if (!game) return;
    const ok = game.passTurn(socket.id);
    if (ok) broadcastGame(roomId);
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

  // ── 主动离开房间 ──────────────────────────
  socket.on('leave-room', () => doLeave(false));

  // ── 断线重连 ──────────────────────────────
  socket.on('reconnect-game', ({ roomId: rid, playerName }) => {
    if (!rid || !playerName) return;
    const game = rooms.get(rid);
    if (!game) { socket.emit('reconnect-failed', { reason: '房间已不存在' }); return; }

    const key = `${rid}:${playerName}`;
    const pending = pendingRemovals.get(key);
    if (!pending) {
      socket.emit('reconnect-failed', { reason: '重连超时或已被移除' });
      return;
    }

    clearTimeout(pending.timer);
    pendingRemovals.delete(key);

    const ok = game.reconnectPlayer(playerName, socket.id);
    if (!ok) { socket.emit('reconnect-failed', { reason: '重连失败' }); return; }

    socket.join(rid);
    roomId = rid;
    socket.emit('reconnected', { roomId: rid, playerId: socket.id });

    if (game.status === 'waiting') broadcastLobby(rid);
    else                           broadcastGame(rid);
    broadcastRoomList();
  });

  // ── 断开连接 ──────────────────────────────
  socket.on('disconnect', () => doLeave(true));

  function doLeave(isDisconnect = false) {
    if (!roomId) return;
    const game = rooms.get(roomId);
    if (game) {
      // 游戏进行中断线 → 宽限期 20 秒
      if (isDisconnect && game.status === 'playing') {
        const playerName = game.disconnectPlayer(socket.id);
        if (playerName) {
          const key        = `${roomId}:${playerName}`;
          const savedRoom  = roomId;
          const timer = setTimeout(() => {
            pendingRemovals.delete(key);
            const g = rooms.get(savedRoom);
            if (!g) return;
            g.removePlayerByName(playerName);
            if (g.players.length === 0) {
              rooms.delete(savedRoom);
            } else {
              broadcastLobby(savedRoom);
              broadcastGame(savedRoom);
            }
            broadcastRoomList();
          }, 20_000);
          pendingRemovals.set(key, { timer });
          broadcastGame(roomId); // 让其他玩家看到断线状态
          broadcastRoomList();
        }
      } else {
        // 等待室断线或主动离开 → 立即移除
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
    }
    roomId = null;
  }
});

const PORT = process.env.PORT || 3004;
server.listen(PORT, () => console.log(`UNO server running on port ${PORT}`));
