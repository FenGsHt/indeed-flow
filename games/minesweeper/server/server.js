// 多人实时扫雷 WebSocket 服务
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { RoomManager } = require('./game');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ['http://localhost:8080', 'http://127.0.0.1:8080'],
    methods: ['GET', 'POST']
  }
});

const roomManager = new RoomManager();

// 静态文件服务（如果有前端资源）
app.use(express.static('../client'));

// Socket.io 事件处理
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  let currentRoom = null;
  let currentPlayer = null;

  // 加入房间
  socket.on('join-room', ({ roomId, playerName }) => {
    if (!roomId) {
      socket.emit('error', { message: 'Room ID is required' });
      return;
    }

    // 离开之前的房间
    if (currentRoom) {
      socket.leave(currentRoom);
      roomManager.removePlayer(currentRoom, socket.id);
      io.to(currentRoom).emit('game-state', {
        ...roomManager.getRoom(currentRoom).game.getState(),
        players: roomManager.getPlayersList(currentRoom),
        currentPlayer: roomManager.getRoom(currentRoom).currentPlayer
      });
    }

    // 创建或加入房间
    const room = roomManager.createRoom(roomId);
    currentRoom = roomId;
    currentPlayer = roomManager.addPlayer(roomId, socket.id, playerName);
    socket.join(roomId);

    console.log(`Player ${currentPlayer.name} joined room ${roomId}`);

    // 广播游戏状态给房间所有人
    io.to(roomId).emit('game-state', {
      ...room.game.getState(),
      players: roomManager.getPlayersList(roomId),
      currentPlayer: room.currentPlayer
    });

    socket.emit('player-info', currentPlayer);
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
          currentPlayer: room.currentPlayer
        });
      }

      socket.leave(currentRoom);
      console.log(`Player left room ${currentRoom}`);
      currentRoom = null;
      currentPlayer = null;
    }
  });

  // 揭开格子
  socket.on('reveal-cell', ({ x, y }) => {
    if (!currentRoom || !currentPlayer) {
      socket.emit('error', { message: 'Not in a room' });
      return;
    }

    const room = roomManager.getRoom(currentRoom);
    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    // 检查是否是当前玩家的回合（可选，如果需要回合制）
    // if (room.currentPlayer !== socket.id) {
    //   socket.emit('error', { message: 'Not your turn' });
    //   return;
    // }

    // 如果是第一次揭开，放置地雷
    if (room.game.gameStatus === 'waiting') {
      room.game.placeMines(x, y);
    }

    const result = room.game.reveal(x, y);

    if (result.success) {
      // 广播游戏状态给房间所有人
      io.to(currentRoom).emit('game-state', {
        ...room.game.getState(),
        players: roomManager.getPlayersList(currentRoom),
        currentPlayer: room.currentPlayer
      });

      // 游戏结束提示
      if (result.gameOver) {
        if (room.game.gameStatus === 'won') {
          io.to(currentRoom).emit('game-over', { won: true, message: '🎉 恭喜，你们赢了！' });
        } else if (room.game.gameStatus === 'lost') {
          io.to(currentRoom).emit('game-over', { won: false, message: '💥 游戏结束，有人踩到雷了！' });
        }
      }
    }
  });

  // 标记/取消旗帜
  socket.on('toggle-flag', ({ x, y }) => {
    if (!currentRoom || !currentPlayer) {
      socket.emit('error', { message: 'Not in a room' });
      return;
    }

    const room = roomManager.getRoom(currentRoom);
    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    const success = room.game.toggleFlag(x, y);

    if (success) {
      // 广播游戏状态给房间所有人
      io.to(currentRoom).emit('game-state', {
        ...room.game.getState(),
        players: roomManager.getPlayersList(currentRoom),
        currentPlayer: room.currentPlayer
      });
    }
  });

  // 新建游戏
  socket.on('new-game', ({ width, height, mines }) => {
    if (!currentRoom) {
      socket.emit('error', { message: 'Not in a room' });
      return;
    }

    const room = roomManager.getRoom(currentRoom);
    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    // 重置游戏
    room.game = new (require('./game').MinesweeperGame)(
      width || 9,
      height || 9,
      mines || 10
    );
    room.currentPlayer = room.players.keys().next().value;

    console.log(`New game started in room ${currentRoom}`);

    // 广播游戏状态给房间所有人
    io.to(currentRoom).emit('game-state', {
      ...room.game.getState(),
      players: roomManager.getPlayersList(currentRoom),
      currentPlayer: room.currentPlayer
    });
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
          currentPlayer: room.currentPlayer
        });
      }
    }
  });
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`Minesweeper server running on port ${PORT}`);
});