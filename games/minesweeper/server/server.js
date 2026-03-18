// 多人实时扫雷 WebSocket 服务
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { RoomManager, MinesweeperGame } = require('./game');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const roomManager = new RoomManager();

// 全局暴雷榜 playerName -> { name, hits }
const mineLeaderboard = new Map();
// 全局得分榜 playerName -> { name, score }（揭开格子数累计）
const scoreLeaderboard = new Map();

app.use(express.static('../client'));

// 广播房间列表给所有人
function broadcastRoomList() {
  io.emit('room-list', roomManager.getRoomList());
}

// 更新暴雷榜并广播
function recordMineHit(playerName) {
  const entry = mineLeaderboard.get(playerName) || { name: playerName, hits: 0 };
  entry.hits++;
  mineLeaderboard.set(playerName, entry);
  io.emit('leaderboard-update', getMineLeaderboard());
}

function getMineLeaderboard() {
  return Array.from(mineLeaderboard.values())
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 20);
}

// 更新得分榜并广播
function recordScore(playerName, cells) {
  if (!playerName || cells <= 0) return;
  const entry = scoreLeaderboard.get(playerName) || { name: playerName, score: 0 };
  entry.score += cells;
  scoreLeaderboard.set(playerName, entry);
  io.emit('score-leaderboard-update', getScoreLeaderboard());
}

function getScoreLeaderboard() {
  return Array.from(scoreLeaderboard.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
}

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // 连接时推送房间列表和榜单
  socket.emit('room-list', roomManager.getRoomList());
  socket.emit('leaderboard-update', getMineLeaderboard());
  socket.emit('score-leaderboard-update', getScoreLeaderboard());

  let currentRoom = null;
  let currentPlayer = null;

  // 获取房间列表
  socket.on('get-rooms', () => {
    socket.emit('room-list', roomManager.getRoomList());
  });

  // 获取榜单
  socket.on('get-leaderboard', () => {
    socket.emit('leaderboard-update', getMineLeaderboard());
    socket.emit('score-leaderboard-update', getScoreLeaderboard());
  });

  // 加入房间
  socket.on('join-room', ({ roomId, playerName, width, height, mines }) => {
    if (!roomId) {
      socket.emit('error', { message: '房间号不能为空' });
      return;
    }

    // 离开之前的房间
    if (currentRoom) {
      socket.leave(currentRoom);
      roomManager.removePlayer(currentRoom, socket.id);
      const prevRoom = roomManager.getRoom(currentRoom);
      if (prevRoom) {
        io.to(currentRoom).emit('game-state', {
          ...prevRoom.game.getState(),
          players: roomManager.getPlayersList(currentRoom),
        });
      }
    }

    // 创建或加入房间（支持自定义尺寸，默认16x16/40雷）
    console.log(`[join-room] received width=${width}, height=${height}, mines=${mines}`);
    const w = Math.min(Math.max(parseInt(width) || 16, 5), 50);
    const h = Math.min(Math.max(parseInt(height) || 16, 5), 30);
    const m = Math.min(Math.max(parseInt(mines) || 40, 1), w * h - 9);
    const room = roomManager.createRoom(roomId, w, h, m, !!width);
    currentRoom = roomId;
    currentPlayer = roomManager.addPlayer(roomId, socket.id, playerName);
    socket.join(roomId);

    console.log(`Player ${currentPlayer.name} joined room ${roomId}`);

    io.to(roomId).emit('game-state', {
      ...room.game.getState(),
      players: roomManager.getPlayersList(roomId),
    });

    socket.emit('player-info', currentPlayer);
    broadcastRoomList();
  });

  // 离开房间
  socket.on('leave-room', () => {
    if (currentRoom) {
      roomManager.removePlayer(currentRoom, socket.id);
      const room = roomManager.getRoom(currentRoom);
      if (room) {
        io.to(currentRoom).emit('game-state', {
          ...room.game.getState(),
          players: roomManager.getPlayersList(currentRoom),
        });
      }
      socket.leave(currentRoom);
      currentRoom = null;
      currentPlayer = null;
      broadcastRoomList();
    }
  });

  // 揭开格子
  socket.on('reveal-cell', ({ x, y }) => {
    if (!currentRoom || !currentPlayer) {
      socket.emit('error', { message: '未在房间中' });
      return;
    }

    const room = roomManager.getRoom(currentRoom);
    if (!room) return;

    if (room.game.gameStatus === 'waiting') {
      room.game.placeMines(x, y);
    }

    const beforeCount = room.game.revealedCount;
    const result = room.game.reveal(x, y);
    const cellsRevealed = room.game.revealedCount - beforeCount;

    if (result.success) {
      io.to(currentRoom).emit('game-state', {
        ...room.game.getState(),
        players: roomManager.getPlayersList(currentRoom),
      });

      if (result.gameOver) {
        if (room.game.gameStatus === 'won') {
          // 胜利时记录最后揭开的格子得分
          recordScore(currentPlayer.name, cellsRevealed);
          io.to(currentRoom).emit('game-over', { won: true, message: '🎉 恭喜，你们赢了！' });
        } else if (room.game.gameStatus === 'lost') {
          // 暴雷不计分，记录暴雷榜
          recordMineHit(currentPlayer.name);
          io.to(currentRoom).emit('game-over', {
            won: false,
            message: `💥 ${currentPlayer.name} 踩到雷了！`
          });
        }
      } else {
        // 正常揭开，记录得分
        recordScore(currentPlayer.name, cellsRevealed);
      }
    }
  });

  // 标记/取消旗帜
  socket.on('toggle-flag', ({ x, y }) => {
    if (!currentRoom || !currentPlayer) return;

    const room = roomManager.getRoom(currentRoom);
    if (!room) return;

    const success = room.game.toggleFlag(x, y);
    if (success) {
      io.to(currentRoom).emit('game-state', {
        ...room.game.getState(),
        players: roomManager.getPlayersList(currentRoom),
      });
    }
  });

  // 新建游戏（支持传入新的随机尺寸）
  socket.on('new-game', (data) => {
    if (!currentRoom) return;

    const room = roomManager.getRoom(currentRoom);
    if (!room) return;

    // 支持指定新尺寸（用于随机重开），否则沿用原来的
    const width = (data && data.width) ? Math.min(Math.max(parseInt(data.width), 5), 50) : room.game.width;
    const height = (data && data.height) ? Math.min(Math.max(parseInt(data.height), 5), 30) : room.game.height;
    const mines = (data && data.mines) ? Math.min(Math.max(parseInt(data.mines), 1), width * height - 9) : room.game.mines;

    room.game = new MinesweeperGame(width, height, mines);
    room.currentPlayer = room.players.keys().next().value;

    console.log(`New game in room ${currentRoom}: ${width}x${height}/${mines}mines`);

    io.to(currentRoom).emit('game-state', {
      ...room.game.getState(),
      players: roomManager.getPlayersList(currentRoom),
    });

    broadcastRoomList();
  });

  // 断开连接
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    if (currentRoom) {
      roomManager.removePlayer(currentRoom, socket.id);
      const room = roomManager.getRoom(currentRoom);
      if (room) {
        io.to(currentRoom).emit('game-state', {
          ...room.game.getState(),
          players: roomManager.getPlayersList(currentRoom),
        });
      }
      broadcastRoomList();
    }
  });
});

const PORT = process.env.PORT || 3002;
server.listen(PORT, () => {
  console.log(`Minesweeper server running on port ${PORT}`);
});
