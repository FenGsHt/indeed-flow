// 多人实时扫雷 WebSocket 服务
const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
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

const STATE_FILE = path.join(__dirname, 'state.json');
const LEADERBOARD_VERSION = 2; // 修改此值可强制重置榜单

// 全局暴雷榜 playerName -> { name, hits }
const mineLeaderboard = new Map();
// 全局得分榜 playerName -> { name, score }（赢得局数）
const scoreLeaderboard = new Map();

const roomManager = new RoomManager();
const DEFAULT_ROOM = '游乐场';

// 从文件加载持久化状态
function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return;
    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));

    // 恢复榜单（版本不匹配则重置）
    if (data.leaderboardVersion === LEADERBOARD_VERSION) {
      if (data.mineLeaderboard) {
        data.mineLeaderboard.forEach(e => mineLeaderboard.set(e.name, e));
      }
      if (data.scoreLeaderboard) {
        data.scoreLeaderboard.forEach(e => scoreLeaderboard.set(e.name, e));
      }
    } else {
      console.log('Leaderboard version mismatch, resetting leaderboards');
    }

    // 恢复默认房间游戏状态
    if (data.defaultRoom) {
      const d = data.defaultRoom;
      const room = roomManager.getRoom(DEFAULT_ROOM);
      if (room) {
        if (d.gameStatus === 'waiting') {
          // 仅恢复棋盘尺寸，重新初始化空棋盘
          room.game = new MinesweeperGame(d.width, d.height, d.mines);
        } else {
          room.game.width = d.width;
          room.game.height = d.height;
          room.game.mines = d.mines;
          room.game.gameStatus = d.gameStatus;
          room.game.revealedCount = d.revealedCount;
          room.game.board = d.board;
        }
      }
    }
    console.log('State loaded from file');
  } catch (e) {
    console.error('Failed to load state:', e.message);
  }
}

// 保存状态到文件
function saveState() {
  try {
    const room = roomManager.getRoom(DEFAULT_ROOM);
    const data = {
      leaderboardVersion: LEADERBOARD_VERSION,
      mineLeaderboard: Array.from(mineLeaderboard.values()),
      scoreLeaderboard: Array.from(scoreLeaderboard.values()),
      defaultRoom: room ? {
        width: room.game.width,
        height: room.game.height,
        mines: room.game.mines,
        gameStatus: room.game.gameStatus,
        revealedCount: room.game.revealedCount,
        board: room.game.board,
      } : null,
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(data));
  } catch (e) {
    console.error('Failed to save state:', e.message);
  }
}

// 预创建默认房间并标记为持久（不因无人而删除）
roomManager.createRoom(DEFAULT_ROOM, 16, 16, 40);
roomManager.rooms.get(DEFAULT_ROOM).persist = true;

// 加载持久化状态（覆盖默认房间初始值）
loadState();

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
  saveState();
}

function getMineLeaderboard() {
  return Array.from(mineLeaderboard.values())
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 20);
}

// 更新得分榜并广播（赢得一局 +1）
function recordScore(playerName) {
  if (!playerName) return;
  const entry = scoreLeaderboard.get(playerName) || { name: playerName, score: 0 };
  entry.score += 1;
  scoreLeaderboard.set(playerName, entry);
  io.emit('score-leaderboard-update', getScoreLeaderboard());
  saveState();
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

    const result = room.game.reveal(x, y);

    if (result.success) {
      io.to(currentRoom).emit('game-state', {
        ...room.game.getState(),
        players: roomManager.getPlayersList(currentRoom),
      });

      if (result.gameOver) {
        if (room.game.gameStatus === 'won') {
          // 赢得一局，给踩出最后一步的玩家 +1 分
          recordScore(currentPlayer.name);
          saveState();
          io.to(currentRoom).emit('game-over', { won: true, message: '🎉 恭喜，你们赢了！' });
        } else if (room.game.gameStatus === 'lost') {
          // 踩雷，记录暴雷榜
          recordMineHit(currentPlayer.name);
          saveState();
          io.to(currentRoom).emit('game-over', {
            won: false,
            message: `💥 ${currentPlayer.name} 踩到雷了！`
          });
        }
      } else {
        if (currentRoom === DEFAULT_ROOM) saveState();
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

    if (currentRoom === DEFAULT_ROOM) saveState();
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
