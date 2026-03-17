// 扫雷游戏逻辑 - 支持多房间

class MinesweeperGame {
  constructor(width = 9, height = 9, mines = 10) {
    this.width = width;
    this.height = height;
    this.mines = mines;
    this.board = [];
    this.gameStatus = 'waiting'; // 'waiting' | 'playing' | 'won' | 'lost'
    this.revealedCount = 0;
    this.initBoard();
  }

  initBoard() {
    // 初始化空棋盘
    this.board = [];
    for (let y = 0; y < this.height; y++) {
      this.board[y] = [];
      for (let x = 0; x < this.width; x++) {
        this.board[y][x] = {
          isRevealed: false,
          isFlagged: false,
          isMine: false,
          neighborMines: 0
        };
      }
    }
  }

  placeMines(excludeX, excludeY) {
    // 随机放置地雷，排除第一次点击的格子及其周围
    let placed = 0;
    const excludeSet = new Set();
    
    // 排除点击格子及其周围8个格子
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = excludeX + dx;
        const ny = excludeY + dy;
        if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
          excludeSet.add(`${nx},${ny}`);
        }
      }
    }

    while (placed < this.mines) {
      const x = Math.floor(Math.random() * this.width);
      const y = Math.floor(Math.random() * this.height);
      const key = `${x},${y}`;

      if (!this.board[y][x].isMine && !excludeSet.has(key)) {
        this.board[y][x].isMine = true;
        placed++;
      }
    }

    // 计算每个格子的周围雷数
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (!this.board[y][x].isMine) {
          this.board[y][x].neighborMines = this.countNeighborMines(x, y);
        }
      }
    }
  }

  countNeighborMines(x, y) {
    let count = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
          if (this.board[ny][nx].isMine) count++;
        }
      }
    }
    return count;
  }

  reveal(x, y) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return { success: false, gameOver: false };
    }

    const cell = this.board[y][x];

    if (cell.isRevealed || cell.isFlagged) {
      return { success: false, gameOver: false };
    }

    cell.isRevealed = true;
    this.revealedCount++;

    // 踩到雷了
    if (cell.isMine) {
      this.gameStatus = 'lost';
      return { success: true, gameOver: true };
    }

    // 空格子，自动揭开周围
    if (cell.neighborMines === 0) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          this.reveal(x + dx, y + dy);
        }
      }
    }

    // 检查是否胜利
    const safeCells = this.width * this.height - this.mines;
    if (this.revealedCount >= safeCells) {
      this.gameStatus = 'won';
      return { success: true, gameOver: true };
    }

    this.gameStatus = 'playing';
    return { success: true, gameOver: false };
  }

  toggleFlag(x, y) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return false;
    }

    const cell = this.board[y][x];
    if (cell.isRevealed) {
      return false;
    }

    cell.isFlagged = !cell.isFlagged;
    return true;
  }

  getState() {
    // 返回游戏状态（不含雷位置信息，直到游戏结束）
    const displayBoard = this.board.map(row => 
      row.map(cell => ({
        isRevealed: cell.isRevealed,
        isFlagged: cell.isFlagged,
        // 游戏结束时显示所有雷
        isMine: cell.isMine && (this.gameStatus === 'lost' || this.gameStatus === 'won') ? true : (cell.isRevealed && cell.isMine),
        neighborMines: cell.isRevealed ? cell.neighborMines : 0
      }))
    );

    return {
      board: displayBoard,
      gameStatus: this.gameStatus,
      width: this.width,
      height: this.height,
      mines: this.mines
    };
  }
}

// 房间管理器
class RoomManager {
  constructor() {
    this.rooms = new Map();
  }

  createRoom(roomId, width = 9, height = 9, mines = 10) {
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, {
        game: new MinesweeperGame(width, height, mines),
        players: new Map(),
        currentPlayer: null
      });
    }
    return this.rooms.get(roomId);
  }

  getRoom(roomId) {
    return this.rooms.get(roomId);
  }

  deleteRoom(roomId) {
    this.rooms.delete(roomId);
  }

  addPlayer(roomId, playerId, playerName) {
    const room = this.getRoom(roomId);
    if (!room) return null;

    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F'];
    const color = colors[room.players.size % colors.length];

    room.players.set(playerId, {
      id: playerId,
      name: playerName || `Player${room.players.size + 1}`,
      color
    });

    if (!room.currentPlayer) {
      room.currentPlayer = playerId;
    }

    return room.players.get(playerId);
  }

  removePlayer(roomId, playerId) {
    const room = this.getRoom(roomId);
    if (!room) return;

    room.players.delete(playerId);

    // 如果当前玩家离开，选择下一个玩家
    if (room.currentPlayer === playerId && room.players.size > 0) {
      room.currentPlayer = room.players.keys().next().value;
    } else if (room.players.size === 0) {
      room.currentPlayer = null;
    }

    // 如果房间没人了，删除房间
    if (room.players.size === 0) {
      this.deleteRoom(roomId);
    }
  }

  getPlayersList(roomId) {
    const room = this.getRoom(roomId);
    if (!room) return [];
    return Array.from(room.players.values());
  }

  nextPlayer(roomId) {
    const room = this.getRoom(roomId);
    if (!room || room.players.size === 0) return null;

    const playerIds = Array.from(room.players.keys());
    const currentIndex = playerIds.indexOf(room.currentPlayer);
    const nextIndex = (currentIndex + 1) % playerIds.length;
    room.currentPlayer = playerIds[nextIndex];

    return room.currentPlayer;
  }
}

module.exports = { MinesweeperGame, RoomManager };