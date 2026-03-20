const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { BilliardsGame } = require('./game');
const { recordGame, getLeaderboard } = require('./stats');

const PORT = process.env.PORT || 3006;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Serve static client files
app.use(express.static(path.join(__dirname, '../client')));

// ─── Room storage ────────────────────────────────────────────────────────────
// Map<roomId, { game: BilliardsGame, spectators: Set<socketId>, createdAt }>
const rooms = new Map();

// ─── Helpers ─────────────────────────────────────────────────────────────────
function genRoomId() {
  return Math.random().toString(36).slice(2, 7).toUpperCase();
}

function broadcastRooms() {
  const list = [...rooms.entries()].map(([id, { game }]) => ({
    id,
    players: game.players.length,
    maxPlayers: 2,
    status: game.status,
    playerNames: game.players.map(p => p.name),
  }));
  io.emit('rooms-update', list);
}

function getRoomOf(socketId) {
  for (const [id, room] of rooms) {
    if (room.game.players.some(p => p.socketId === socketId)) return { id, room };
    if (room.spectators.has(socketId)) return { id, room };
  }
  return null;
}

function cleanEmptyRooms() {
  for (const [id, { game }] of rooms) {
    if (game.players.length === 0) rooms.delete(id);
  }
}

// Periodic cleanup of stale empty rooms
setInterval(() => cleanEmptyRooms(), 5 * 60 * 1000);

// ─── Socket handlers ─────────────────────────────────────────────────────────
io.on('connection', (socket) => {

  socket.on('get-init', () => {
    socket.emit('rooms-update', [...rooms.entries()].map(([id, { game }]) => ({
      id, players: game.players.length, maxPlayers: 2,
      status: game.status, playerNames: game.players.map(p => p.name),
    })));
    socket.emit('stats-update', getLeaderboard());
  });

  // ── Create room ────────────────────────────────────────────────────────────
  socket.on('create-room', ({ name, options }) => {
    if (!name?.trim()) return;
    const id = genRoomId();
    const game = new BilliardsGame(options || {});
    game.addPlayer(name.trim(), socket.id);
    rooms.set(id, { game, spectators: new Set(), createdAt: Date.now() });
    socket.join(id);
    socket.emit('room-joined', { roomId: id, playerIndex: 0, gameState: game.getState() });
    broadcastRooms();
  });

  // ── Join room ──────────────────────────────────────────────────────────────
  socket.on('join-room', ({ name, roomId }) => {
    const entry = rooms.get(roomId);
    if (!entry) return socket.emit('join-error', '房间不存在');
    const { game } = entry;

    if (game.players.length < 2 && game.status === 'waiting') {
      if (!name?.trim()) return socket.emit('join-error', '请输入昵称');
      const ok = game.addPlayer(name.trim(), socket.id);
      if (!ok) return socket.emit('join-error', '房间已满');
      socket.join(roomId);
      const idx = game.players.findIndex(p => p.socketId === socket.id);
      socket.emit('room-joined', { roomId, playerIndex: idx, gameState: game.getState() });
      io.to(roomId).emit('game-state', game.getState());
      broadcastRooms();
    } else {
      // Join as spectator
      entry.spectators.add(socket.id);
      socket.join(roomId);
      socket.emit('room-joined', { roomId, playerIndex: -1, gameState: game.getState() });
    }
  });

  // ── Ready ──────────────────────────────────────────────────────────────────
  socket.on('set-ready', ({ roomId, ready }) => {
    const entry = rooms.get(roomId);
    if (!entry) return;
    const { game } = entry;
    const allReady = game.setReady(socket.id, ready);
    if (allReady) game.start();
    io.to(roomId).emit('game-state', game.getState());
  });

  // ── Shoot: active player fires ─────────────────────────────────────────────
  // Server broadcasts to all so both clients can run the same physics
  socket.on('shoot', ({ roomId, angle, power, ballPositions }) => {
    const entry = rooms.get(roomId);
    if (!entry) return;
    const { game } = entry;
    if (game.status !== 'playing' || game.phase !== 'aiming') return;
    const idx = game.players.findIndex(p => p.socketId === socket.id);
    if (idx !== game.currentTurn) return;

    // Store authoritative ball positions before this shot
    if (ballPositions) game.ballPositions = ballPositions;
    game.setPhase('simulating');

    io.to(roomId).emit('shot-fired', {
      angle, power, shooterIdx: idx,
      ballPositions: game.ballPositions,
    });
  });

  // ── Shot complete: shooter reports result ──────────────────────────────────
  socket.on('shot-complete', ({ roomId, pocketed, scratch, ballPositions }) => {
    const entry = rooms.get(roomId);
    if (!entry) return;
    const { game } = entry;
    if (game.status !== 'playing' || game.phase !== 'simulating') return;

    const result = game.applyShot({ pocketed, scratch, ballPositions, shooterSocketId: socket.id });
    if (!result) return;

    io.to(roomId).emit('shot-result', { result, gameState: game.getState() });

    if (result.type === 'game_over') {
      const winner = game.players[result.winner];
      const loser = game.players[1 - result.winner];
      if (winner) recordGame(winner.name, true);
      if (loser) recordGame(loser.name, false);
      io.emit('stats-update', getLeaderboard());
    }

    broadcastRooms();
  });

  // ── Place cue ball after scratch ───────────────────────────────────────────
  socket.on('place-cue-ball', ({ roomId, x, y }) => {
    const entry = rooms.get(roomId);
    if (!entry) return;
    const { game } = entry;
    const ok = game.placeCueBall(socket.id, { x, y });
    if (ok) io.to(roomId).emit('game-state', game.getState());
  });

  // ── Chat ───────────────────────────────────────────────────────────────────
  socket.on('chat', ({ roomId, msg }) => {
    const entry = rooms.get(roomId);
    if (!entry) return;
    const sender = entry.game.players.find(p => p.socketId === socket.id);
    if (!sender) return;
    io.to(roomId).emit('chat', { name: sender.name, msg: String(msg).slice(0, 120) });
  });

  // ── Rematch ────────────────────────────────────────────────────────────────
  socket.on('request-rematch', ({ roomId }) => {
    const entry = rooms.get(roomId);
    if (!entry) return;
    const { game } = entry;
    if (game.status !== 'finished') return;
    const p = game.players.find(p => p.socketId === socket.id);
    if (!p) return;
    p.wantsRematch = true;

    if (game.players.every(p => p.wantsRematch)) {
      game.players.forEach(p => { p.wantsRematch = false; });
      game.resetForRematch();
      io.to(roomId).emit('rematch-start', { gameState: game.getState() });
      broadcastRooms();
    } else {
      io.to(roomId).emit('rematch-requested', { name: p.name });
    }
  });

  // ── Leave / disconnect ─────────────────────────────────────────────────────
  socket.on('leave-room', ({ roomId }) => handleLeave(socket, roomId));
  socket.on('disconnect', () => {
    const found = getRoomOf(socket.id);
    if (found) handleLeave(socket, found.id);
  });
});

function handleLeave(socket, roomId) {
  const entry = rooms.get(roomId);
  if (!entry) return;
  const { game } = entry;

  // Spectator?
  if (entry.spectators.has(socket.id)) {
    entry.spectators.delete(socket.id);
    socket.leave(roomId);
    return;
  }

  const player = game.removePlayer(socket.id);
  socket.leave(roomId);

  if (game.status === 'playing' && player) {
    // Remaining player wins by default
    const remaining = game.players[0];
    if (remaining) {
      game.status = 'finished';
      game.winner = 0;
      remaining.score++;
      recordGame(remaining.name, true);
      recordGame(player.name, false);
      io.emit('stats-update', getLeaderboard());
    }
    io.to(roomId).emit('player-left', { name: player.name, gameState: game.getState() });
  } else {
    io.to(roomId).emit('game-state', game.getState());
  }

  cleanEmptyRooms();
  broadcastRooms();
}

server.listen(PORT, () => console.log(`Billiards server on port ${PORT}`));
