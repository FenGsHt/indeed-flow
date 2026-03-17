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

// 全局暴雷榜单 playerName -> { name, hits }
const mineLeaderboard = new Map();

app.use(express.static('../client'));

// 广播房间列表给所有人
function broadcastRoomList() {
  io.emit('room-list', roomManager.getRoomList());
}

// 更新暴雷榜单并广播
function recordMineHit(playerName) {
  const entry = mineLeaderboard.get(playerName) || { name: playerName, hits: 0 };
  entry.hits++;
  mineLeaderboard.set(playerName, entry);
  io.emit('leaderboard-update', getLeaderboard());
}

function getLeaderboard() {
  return Array.from(mineLeaderboard.values())
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 20);
}

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // 连接时推送房间列表和榜单
  socket.emit('room-list', roomManager.getRoomList());
  socket.emit('leaderboard-update', getLeaderboard());

  let currentRoom = null;
  let currentPlayer = null;

  // 获取房间列表
  socket.on('get-rooms', () => {
    socket.emit('room-list', roomManager.getRoomList());
  });

  // 获取榜单
  socket.on('get-leaderboard', () => {
    socket.emit('leaderboard-update', getLeaderboard());
  });

  // 加入房间
  socket.on('join-room', ({ roomId, playerName }) => {
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

    // 创建或加入房间（高级模式：16x16，40个雷）
    const room = roomManager.createRoom(roomId, 16, 16, 40);
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
          io.to(currentRoom).emit('game-over', { won: true, message: '🎉 恭喜，你们赢了！' });
        } else if (room.game.gameStatus === 'lost') {
          // 记录暴雷玩家
          recordMineHit(currentPlayer.name);
          io.to(currentRoom).emit('game-over', {
            won: false,
            message: `💥 ${currentPlayer.name} 踩到雷了！`
          });
        }
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

  // 新建游戏（高级模式）
  socket.on('new-game', () => {
    if (!currentRoom) return;

    const room = roomManager.getRoom(currentRoom);
    if (!room) return;

    room.game = new MinesweeperGame(16, 16, 40);
    room.currentPlayer = room.players.keys().next().value;

    console.log(`New game started in room ${currentRoom}`);

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
