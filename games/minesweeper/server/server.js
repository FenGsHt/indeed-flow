// 多人实时扫雷 WebSocket 服务
const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');
const { RoomManager, MinesweeperGame } = require('./game');

const OPENCLAW_WEBHOOK = process.env.OPENCLAW_WEBHOOK || '';
const OPENCLAW_TOKEN   = process.env.OPENCLAW_TOKEN   || '';
const OPENCLAW_GROUP   = process.env.OPENCLAW_GROUP   || '';

function sendOpenClaw(message) {
  if (!OPENCLAW_WEBHOOK || !OPENCLAW_GROUP) return;
  const body = JSON.stringify({
    message,
    agentId: 'work-agent',
    channel: 'qq',
    to:      OPENCLAW_GROUP,
    deliver: true,
  });
  const url = new URL(OPENCLAW_WEBHOOK);
  const mod = url.protocol === 'https:' ? https : http;
  const req = mod.request(url, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': OPENCLAW_TOKEN,
      'Content-Length': Buffer.byteLength(body),
    },
  }, res => {
    res.resume();
    console.log(`[OpenClaw] 推送状态: ${res.statusCode}`);
  });
  req.on('error', e => console.error('[OpenClaw] 推送失败:', e.message));
  req.write(body);
  req.end();
}

const app = express();
const server = http.createServer(app);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ? process.env.ALLOWED_ORIGIN.split(',') : ['http://localhost:5173', 'http://150.158.110.168', 'http://150.158.110.168:9000'];
const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGIN,
    methods: ['GET', 'POST']
  }
});

const STATE_FILE = path.join(__dirname, 'state.json');
const LEADERBOARD_VERSION = 2; // 修改此值可强制重置榜单

// 全局暴雷榜 playerName -> { name, hits }
const mineLeaderboard = new Map();
// 全局得分榜 playerName -> { name, score }（赢得局数）
const scoreLeaderboard = new Map();
// 全局积分榜 playerName -> { name, cellsScore }（揭格累计积分）
const cellsScoreLeaderboard = new Map();
// 历史记录（最近50条）
const gameHistory = [];
const MAX_HISTORY = 50;

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
      if (data.gameHistory) {
        gameHistory.push(...data.gameHistory.slice(0, MAX_HISTORY));
      }
      if (data.cellsScoreLeaderboard) {
        data.cellsScoreLeaderboard.forEach(e => cellsScoreLeaderboard.set(e.name, e));
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
      cellsScoreLeaderboard: Array.from(cellsScoreLeaderboard.values()),
      gameHistory: gameHistory.slice(0, MAX_HISTORY),
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

// 更新积分榜并广播（揭格积分，按剩余比例阶梯加成）
function recordCellsScore(playerName, cellsRevealed, beforeCount, safeTotal) {
  if (!playerName || cellsRevealed <= 0) return;
  const remainingRatio = (safeTotal - beforeCount) / safeTotal;
  const stage = Math.floor((1 - remainingRatio) / 0.1); // 0~9
  const multiplier = Math.round((stage + 1) * 0.1 * 10) / 10; // 0.1~1.0
  const points = Math.round(cellsRevealed * multiplier * 10) / 10;
  const entry = cellsScoreLeaderboard.get(playerName) || { name: playerName, cellsScore: 0 };
  entry.cellsScore = Math.round((entry.cellsScore + points) * 10) / 10;
  cellsScoreLeaderboard.set(playerName, entry);
  io.emit('cells-score-leaderboard-update', getCellsScoreLeaderboard());
}

function getCellsScoreLeaderboard() {
  return Array.from(cellsScoreLeaderboard.values())
    .sort((a, b) => b.cellsScore - a.cellsScore)
    .slice(0, 20);
}

// 记录历史并广播（含棋盘快照）
function recordHistory(playerName, result, width, height, mines, board) {
  gameHistory.unshift({ time: Date.now(), player: playerName, result, width, height, mines, board });
  if (gameHistory.length > MAX_HISTORY) gameHistory.length = MAX_HISTORY;
  io.emit('history-update', gameHistory);
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

  // 连接时推送房间列表、榜单和历史记录
  socket.emit('room-list', roomManager.getRoomList());
  socket.emit('leaderboard-update', getMineLeaderboard());
  socket.emit('score-leaderboard-update', getScoreLeaderboard());
  socket.emit('cells-score-leaderboard-update', getCellsScoreLeaderboard());
  socket.emit('history-update', gameHistory);

  let currentRoom = null;
  let currentPlayer = null;

  // 输入验证工具
  function validateCoord(x, y, room) {
    if (!Number.isInteger(x) || !Number.isInteger(y)) return false;
    if (x < 0 || y < 0) return false;
    if (x >= room.game.width || y >= room.game.height) return false;
    return true;
  }

  function validateName(name) {
    return typeof name === 'string' && name.trim().length > 0 && name.length <= 20;
  }

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
    if (!roomId || typeof roomId !== 'string' || roomId.length > 32) {
      socket.emit('error', { message: '房间号无效' });
      return;
    }
    if (!validateName(playerName)) {
      socket.emit('error', { message: '玩家名称无效（1-20个字符）' });
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
    try {
    if (!currentRoom || !currentPlayer) {
      socket.emit('error', { message: '未在房间中' });
      return;
    }

    const room = roomManager.getRoom(currentRoom);
    if (!room) return;

    if (!validateCoord(x, y, room)) {
      socket.emit('error', { message: '坐标无效' });
      return;
    }

    if (room.game.gameStatus === 'waiting') {
      room.game.placeMines(x, y);
    }

    const beforeRevealedCount = room.game.revealedCount;
    const safeTotal = room.game.width * room.game.height - room.game.mines;
    const result = room.game.reveal(x, y);
    const cellsRevealed = room.game.revealedCount - beforeRevealedCount;

    if (result.success) {
      io.to(currentRoom).emit('game-state', {
        ...room.game.getState(),
        players: roomManager.getPlayersList(currentRoom),
      });

      if (result.gameOver) {
        if (room.game.gameStatus === 'won') {
          // 赢得一局，给踩出最后一步的玩家 +1 分
          recordScore(currentPlayer.name);
          recordHistory(currentPlayer.name, 'won', room.game.width, room.game.height, room.game.mines, room.game.getState().board);
          saveState();
          io.to(currentRoom).emit('game-over', { won: true, message: '🎉 恭喜，你们赢了！' });
          sendOpenClaw(`🎉 [扫雷] ${currentPlayer.name} 在「${currentRoom}」成功扫雷！棋盘：${room.game.width}×${room.game.height}，雷数：${room.game.mines}`);
        } else if (room.game.gameStatus === 'lost') {
          // 踩雷，记录暴雷榜
          recordMineHit(currentPlayer.name);
          recordHistory(currentPlayer.name, 'lost', room.game.width, room.game.height, room.game.mines, room.game.getState().board);
          saveState();
          io.to(currentRoom).emit('game-over', {
            won: false,
            message: `💥 ${currentPlayer.name} 踩到雷了！`
          });
          sendOpenClaw(`💥 [扫雷] ${currentPlayer.name} 在「${currentRoom}」踩到雷了！棋盘：${room.game.width}×${room.game.height}，雷数：${room.game.mines}`);
        }
      } else {
        // 普通揭格，记录积分（阶梯加成）
        recordCellsScore(currentPlayer.name, cellsRevealed, beforeRevealedCount, safeTotal);
        if (currentRoom === DEFAULT_ROOM) saveState();
      }
    }
    } catch (err) {
      console.error('[reveal-cell] error:', err);
      socket.emit('error', { message: '操作失败，请重试' });
    }
  });

  // 标记/取消旗帜
  socket.on('toggle-flag', ({ x, y }) => {
    try {
    if (!currentRoom || !currentPlayer) return;

    const room = roomManager.getRoom(currentRoom);
    if (!room) return;

    if (!validateCoord(x, y, room)) return;

    const success = room.game.toggleFlag(x, y);
    if (success) {
      io.to(currentRoom).emit('game-state', {
        ...room.game.getState(),
        players: roomManager.getPlayersList(currentRoom),
      });
    }
    } catch (err) {
      console.error('[toggle-flag] error:', err);
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
