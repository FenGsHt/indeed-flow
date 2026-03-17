// 多人扫雷前端逻辑
const SERVER_URL = 'http://150.158.110.168:3002';

// 游戏状态
let socket = null;
let currentRoom = null;
let currentPlayer = null;
let players = [];
let gameState = null;

// DOM 元素
const joinScreen = document.getElementById('join-screen');
const gameScreen = document.getElementById('game-screen');
const joinBtn = document.getElementById('join-btn');
const leaveBtn = document.getElementById('leave-btn');
const newGameBtn = document.getElementById('new-game-btn');
const restartBtn = document.getElementById('restart-btn');
const roomIdInput = document.getElementById('room-id');
const playerNameInput = document.getElementById('player-name');
const joinError = document.getElementById('join-error');
const currentRoomSpan = document.getElementById('current-room');
const playersListDiv = document.getElementById('players-list');
const flagCountSpan = document.getElementById('flag-count');
const mineCountSpan = document.getElementById('mine-count');
const gameStatusSpan = document.getElementById('game-status');
const boardDiv = document.getElementById('board');
const gameOverModal = document.getElementById('game-over-modal');
const gameOverTitle = document.getElementById('game-over-title');
const gameOverMessage = document.getElementById('game-over-message');

// 初始化 Socket.io 连接
function initSocket() {
  socket = io(SERVER_URL, {
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });

  // 连接成功
  socket.on('connect', () => {
    console.log('Connected to server:', socket.id);
    // 如果之前在房间里，尝试重新加入
    if (currentRoom && currentPlayer) {
      socket.emit('join-room', { 
        roomId: currentRoom, 
        playerName: currentPlayer.name 
      });
    }
  });

  // 断开连接
  socket.on('disconnect', () => {
    console.log('Disconnected from server');
    showGameStatus('连接断开，正在重连...');
  });

  // 重连成功
  socket.on('reconnect', () => {
    console.log('Reconnected to server');
  });

  // 接收游戏状态
  socket.on('game-state', (state) => {
    console.log('Received game state:', state);
    updateGameState(state);
  });

  // 接收玩家信息
  socket.on('player-info', (player) => {
    console.log('Player info:', player);
    currentPlayer = player;
  });

  // 游戏结束
  socket.on('game-over', (data) => {
    console.log('Game over:', data);
    showGameOverModal(data.won, data.message);
  });

  // 错误处理
  socket.on('error', (error) => {
    console.error('Error:', error);
    joinError.textContent = error.message || '发生错误';
  });
}

// 更新游戏状态
function updateGameState(state) {
  gameState = state;
  players = state.players || [];
  
  // 更新棋盘显示
  renderBoard(state.board);
  
  // 更新玩家列表
  renderPlayers();
  
  // 更新旗帜数
  updateFlagCount(state.board);
  
  // 更新游戏状态显示
  updateGameStatus(state.gameStatus);
}

// 渲染棋盘
function renderBoard(board) {
  if (!board) return;
  
  const width = board[0]?.length || 9;
  const height = board.length || 9;
  
  boardDiv.style.gridTemplateColumns = `repeat(${width}, 35px)`;
  boardDiv.innerHTML = '';
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cellData = board[y][x];
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.x = x;
      cell.dataset.y = y;
      
      if (cellData.isRevealed) {
        cell.classList.add('revealed');
        
        if (cellData.isMine) {
          cell.classList.add('mine');
          cell.textContent = '💣';
        } else if (cellData.neighborMines > 0) {
          cell.textContent = cellData.neighborMines;
          cell.classList.add(`num-${cellData.neighborMines}`);
        }
      }
      
      if (cellData.isFlagged) {
        cell.classList.add('flagged');
        cell.textContent = '🚩';
      }
      
      // 游戏结束样式
      if (gameState && (gameState.gameStatus === 'won' || gameState.gameStatus === 'lost')) {
        cell.classList.add('game-over');
      }
      
      // 点击事件
      cell.addEventListener('click', () => handleCellClick(x, y));
      cell.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        handleCellRightClick(x, y);
      });
      
      boardDiv.appendChild(cell);
    }
  }
}

// 处理格子点击（揭开）
function handleCellClick(x, y) {
  if (!socket || !currentRoom) return;
  if (gameState && (gameState.gameStatus === 'won' || gameState.gameStatus === 'lost')) {
    return;
  }
  
  socket.emit('reveal-cell', { x, y });
}

// 处理右键点击（插旗）
function handleCellRightClick(x, y) {
  if (!socket || !currentRoom) return;
  if (gameState && (gameState.gameStatus === 'won' || gameState.gameStatus === 'lost')) {
    return;
  }
  
  socket.emit('toggle-flag', { x, y });
}

// 更新旗帜计数
function updateFlagCount(board) {
  let flagCount = 0;
  let mineCount = gameState?.mines || 10;
  
  if (board) {
    for (let y = 0; y < board.length; y++) {
      for (let x = 0; x < board[y].length; x++) {
        if (board[y][x].isFlagged) {
          flagCount++;
        }
      }
    }
  }
  
  flagCountSpan.textContent = flagCount;
  mineCountSpan.textContent = mineCount;
}

// 更新游戏状态显示
function updateGameStatus(status) {
  const statusMap = {
    'waiting': '等待开始...',
    'playing': '游戏中',
    'won': '🎉 胜利！',
    'lost': '💥 游戏结束'
  };
  gameStatusSpan.textContent = statusMap[status] || status;
}

// 渲染玩家列表
function renderPlayers() {
  playersListDiv.innerHTML = '<span class="players-title">在线玩家:</span>';
  
  players.forEach(player => {
    const badge = document.createElement('div');
    badge.className = 'player-badge';
    if (currentPlayer && player.id === currentPlayer.id) {
      badge.classList.add('current');
    }
    
    const colorDot = document.createElement('span');
    colorDot.className = 'player-color';
    colorDot.style.backgroundColor = player.color;
    
    const nameSpan = document.createElement('span');
    nameSpan.textContent = player.name;
    
    badge.appendChild(colorDot);
    badge.appendChild(nameSpan);
    playersListDiv.appendChild(badge);
  });
}

// 加入房间
function joinRoom() {
  const roomId = roomIdInput.value.trim();
  const playerName = playerNameInput.value.trim() || '匿名玩家';
  
  if (!roomId) {
    joinError.textContent = '请输入房间号';
    return;
  }
  
  joinError.textContent = '';
  currentRoom = roomId;
  
  socket.emit('join-room', { roomId, playerName });
}

// 显示游戏结束弹窗
function showGameOverModal(won, message) {
  gameOverTitle.textContent = won ? '🎉 恭喜获胜！' : '💥 游戏结束';
  gameOverMessage.textContent = message;
  gameOverModal.classList.remove('hidden');
}

// 隐藏游戏结束弹窗
function hideGameOverModal() {
  gameOverModal.classList.add('hidden');
}

// 离开房间
function leaveRoom() {
  if (socket) {
    socket.emit('leave-room');
  }
  currentRoom = null;
  currentPlayer = null;
  players = [];
  gameState = null;
  
  joinScreen.classList.remove('hidden');
  gameScreen.classList.add('hidden');
  hideGameOverModal();
}

// 新建游戏
function startNewGame() {
  if (socket && currentRoom) {
    socket.emit('new-game', {
      width: 9,
      height: 9,
      mines: 10
    });
  }
  hideGameOverModal();
}

// 显示游戏状态（临时）
function showGameStatus(message) {
  const originalStatus = gameStatusSpan.textContent;
  gameStatusSpan.textContent = message;
  setTimeout(() => {
    if (gameState) {
      updateGameStatus(gameState.gameStatus);
    }
  }, 3000);
}

// 事件监听
joinBtn.addEventListener('click', joinRoom);
leaveBtn.addEventListener('click', leaveRoom);
newGameBtn.addEventListener('click', startNewGame);
restartBtn.addEventListener('click', startNewGame);

// 回车加入房间
roomIdInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    playerNameInput.focus();
  }
});
playerNameInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    joinRoom();
  }
});

// 监听 game-state 来切换屏幕
const originalUpdateGameState = updateGameState;
updateGameState = function(state) {
  originalUpdateGameState(state);
  
  // 第一次收到游戏状态时，切换到游戏屏幕
  if (currentRoom && joinScreen.classList.contains('hidden') === false) {
    joinScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');
    currentRoomSpan.textContent = currentRoom;
  }
};

// 初始化
initSocket();

console.log('Multiplayer Minesweeper client initialized');