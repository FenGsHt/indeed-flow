/**
 * 2026-03-19: 吹牛骰 Socket.IO 服务
 */
const http = require('http');
const { Server } = require('socket.io');
const { DiceGame } = require('./game');

const server = http.createServer();
const io = new Server(server, { cors: { origin: '*' } });

const rooms = new Map();

function genRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

io.on('connection', (socket) => {
  let currentRoom = null;
  let playerId = socket.id;
  let playerName = '';

  socket.on('create-room', ({ name, settings }) => {
    playerName = (name || '').trim().substring(0, 12) || '庄家';
    const roomId = genRoomId();
    const game = new DiceGame(settings);
    game.addPlayer(playerId, playerName);
    rooms.set(roomId, game);
    currentRoom = roomId;
    socket.join(roomId);
    socket.emit('room-created', { roomId });
    io.to(roomId).emit('lobby-update', game.getLobbyState());
  });

  socket.on('join-room', ({ roomId, name }) => {
    playerName = (name || '').trim().substring(0, 12) || '玩家';
    roomId = (roomId || '').toUpperCase();
    const game = rooms.get(roomId);
    if (!game) return socket.emit('error-msg', '房间不存在');
    if (game.status !== 'waiting') return socket.emit('error-msg', '游戏已开始');
    const p = game.addPlayer(playerId, playerName);
    if (!p) return socket.emit('error-msg', '房间已满');
    currentRoom = roomId;
    socket.join(roomId);
    socket.emit('room-joined', { roomId });
    io.to(roomId).emit('lobby-update', game.getLobbyState());
    io.to(roomId).emit('player-joined', { name: playerName });
  });

  socket.on('toggle-ready', () => {
    const game = rooms.get(currentRoom);
    if (!game) return;
    game.setReady(playerId);
    io.to(currentRoom).emit('lobby-update', game.getLobbyState());
  });

  socket.on('start-game', () => {
    const game = rooms.get(currentRoom);
    if (!game || !game.start()) return socket.emit('error-msg', '无法开始');
    io.to(currentRoom).emit('game-started');
    broadcastState(currentRoom, game);
  });

  socket.on('make-bid', ({ quantity, face }) => {
    const game = rooms.get(currentRoom);
    if (!game) return;
    const r = game.makeBid(playerId, parseInt(quantity), parseInt(face));
    if (!r.ok) return socket.emit('error-msg', r.reason);
    io.to(currentRoom).emit('bid-made', {
      playerId, playerName, quantity, face,
      wildOnes: game.wildOnes,
    });
    broadcastState(currentRoom, game);
  });

  socket.on('challenge', () => {
    const game = rooms.get(currentRoom);
    if (!game) return;
    const r = game.challenge(playerId);
    if (!r.ok) return socket.emit('error-msg', r.reason);
    io.to(currentRoom).emit('challenge-result', r);
    setTimeout(() => broadcastState(currentRoom, game), 100);
  });

  socket.on('next-round', () => {
    const game = rooms.get(currentRoom);
    if (!game || game.status !== 'roundEnd') return;
    game.startRound();
    io.to(currentRoom).emit('new-round');
    broadcastState(currentRoom, game);
  });

  socket.on('restart', () => {
    const game = rooms.get(currentRoom);
    if (!game) return;
    game.restart();
    io.to(currentRoom).emit('game-restarted');
    io.to(currentRoom).emit('lobby-update', game.getLobbyState());
  });

  socket.on('update-settings', (settings) => {
    const game = rooms.get(currentRoom);
    if (!game || game.status !== 'waiting') return;
    if (game.players[0]?.id !== playerId) return;
    if (settings.diceCount) {
      settings.diceCount = Math.min(10, Math.max(1, parseInt(settings.diceCount) || 5));
      for (const p of game.players) p.diceCount = settings.diceCount;
    }
    Object.assign(game.settings, settings);
    io.to(currentRoom).emit('lobby-update', game.getLobbyState());
  });

  socket.on('disconnect', () => {
    if (!currentRoom) return;
    const game = rooms.get(currentRoom);
    if (!game) return;
    game.removePlayer(playerId);
    io.to(currentRoom).emit('player-left', { name: playerName });
    if (game.players.length === 0) {
      rooms.delete(currentRoom);
    } else if (game.status === 'waiting') {
      io.to(currentRoom).emit('lobby-update', game.getLobbyState());
    } else {
      broadcastState(currentRoom, game);
    }
  });

  function broadcastState(roomId, game) {
    const sockets = io.sockets.adapter.rooms.get(roomId);
    if (!sockets) return;
    for (const sid of sockets) {
      io.to(sid).emit('game-state', game.getStateFor(sid));
    }
  }
});

const PORT = process.env.PORT || 3005;
server.listen(PORT, () => {
  console.log(`🎲 吹牛骰服务器运行在端口 ${PORT}`);
});
