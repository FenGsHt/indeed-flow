// 多人扫雷前端逻辑 - 高级模式
const SERVER_URL = '';

// 游戏状态
let socket = null;
let currentRoom = null;
let currentPlayer = null;
let players = [];
let gameState = null;
let leaderboardExpanded = true;

// DOM 元素
const joinScreen = document.getElementById('join-screen');
const gameScreen = document.getElementById('game-screen');
const leaveBtn = document.getElementById('leave-btn');
const newGameBtn = document.getElementById('new-game-btn');
const restartBtn = document.getElementById('restart-btn');
const createRoomBtn = document.getElementById('create-room-btn');
const refreshBtn = document.getElementById('refresh-btn');
const playerNameInput = document.getElementById('player-name');
const joinError = document.getElementById('join-error');
const boardWidthInput = document.getElementById('board-width');
const boardHeightInput = document.getElementById('board-height');
const boardMinesInput = document.getElementById('board-mines');
const createToggle = document.getElementById('create-toggle');
const createBody = document.getElementById('create-body');
const boardSizeInfo = document.getElementById('board-size-info');
const currentRoomSpan = document.getElementById('current-room');
const playersListDiv = document.getElementById('players-list');
const flagCountSpan = document.getElementById('flag-count');
const mineCountSpan = document.getElementById('mine-count');
const gameStatusSpan = document.getElementById('game-status');
const boardDiv = document.getElementById('board');
const gameOverModal = document.getElementById('game-over-modal');
const gameOverTitle = document.getElementById('game-over-title');
const gameOverMessage = document.getElementById('game-over-message');
const roomListDiv = document.getElementById('room-list');
const leaderboardDiv = document.getElementById('leaderboard');
const ingameLeaderboardDiv = document.getElementById('ingame-leaderboard');
const lbToggle = document.getElementById('lb-toggle');
const ingameLbBody = document.getElementById('ingame-lb-body');

// 生成随机房间号
function generateRoomId() {
  const adjectives = ['红色', '蓝色', '快速', '猛烈', '神秘', '闪亮', '暗黑', '极速'];
  const nouns = ['炸弹', '猎人', '战士', '雷达', '扫雷', '勇士', '探险', '英雄'];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(Math.random() * 100);
  return `${adj}${noun}${num}`;
}

// 初始化 Socket.io 连接
function initSocket() {
  socket = io(SERVER_URL, {
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });

  socket.on('connect', () => {
    console.log('Connected to server:', socket.id);
    if (currentRoom && currentPlayer) {
      socket.emit('join-room', {
        roomId: currentRoom,
        playerName: currentPlayer.name
      });
    }
  });

  socket.on('disconnect', () => {
    showGameStatus('连接断开，正在重连...');
  });

  // 房间列表更新
  socket.on('room-list', (rooms) => {
    renderRoomList(rooms);
  });

  // 榜单更新
  socket.on('leaderboard-update', (data) => {
    renderLeaderboard(data);
  });

  // 接收游戏状态
  socket.on('game-state', (state) => {
    updateGameState(state);
  });

  // 接收玩家信息
  socket.on('player-info', (player) => {
    currentPlayer = player;
  });

  // 游戏结束
  socket.on('game-over', (data) => {
    showGameOverModal(data.won, data.message);
  });

  // 错误处理
  socket.on('error', (error) => {
    joinError.textContent = error.message || '发生错误';
  });
}

// 渲染房间列表
function renderRoomList(rooms) {
  if (!rooms || rooms.length === 0) {
    roomListDiv.innerHTML = '<div class="room-empty">暂无房间，创建一个吧！</div>';
    return;
  }

  roomListDiv.innerHTML = '';
  rooms.forEach(room => {
    const card = document.createElement('div');
    card.className = 'room-card';

    const statusClass = room.gameStatus === 'playing' ? 'status-playing' :
                        room.gameStatus === 'won' || room.gameStatus === 'lost' ? 'status-ended' : 'status-waiting';
    const statusText = room.gameStatus === 'playing' ? '游戏中' :
                       room.gameStatus === 'won' ? '已结束' :
                       room.gameStatus === 'lost' ? '已结束' : '等待中';

    const playerNames = room.players.slice(0, 3).join('、') + (room.players.length > 3 ? '...' : '');

    card.innerHTML = `
      <div class="room-card-info">
        <div class="room-card-name">${room.roomId}</div>
        <div class="room-card-players">👥 ${room.playerCount}人${playerNames ? `：${playerNames}` : ''}</div>
      </div>
      <div class="room-card-right">
        <span class="room-status ${statusClass}">${statusText}</span>
        <button class="btn-join">加入</button>
      </div>
    `;

    card.querySelector('.btn-join').addEventListener('click', () => joinRoom(room.roomId));
    roomListDiv.appendChild(card);
  });
}

// 渲染榜单（大厅版）
function renderLeaderboard(data) {
  // 大厅榜单
  if (!data || data.length === 0) {
    leaderboardDiv.innerHTML = '<div class="leaderboard-empty">暂无记录</div>';
  } else {
    leaderboardDiv.innerHTML = '';
    data.forEach((entry, index) => {
      const row = document.createElement('div');
      row.className = 'lb-row';
      const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
      row.innerHTML = `
        <span class="lb-rank">${medal}</span>
        <span class="lb-name">${entry.name}</span>
        <span class="lb-hits">💥 ${entry.hits}</span>
      `;
      leaderboardDiv.appendChild(row);
    });
  }

  // 游戏内榜单
  if (!data || data.length === 0) {
    ingameLeaderboardDiv.innerHTML = '<div class="leaderboard-empty">暂无记录</div>';
  } else {
    ingameLeaderboardDiv.innerHTML = '';
    data.slice(0, 10).forEach((entry, index) => {
      const row = document.createElement('div');
      row.className = 'lb-row lb-row-sm';
      const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
      row.innerHTML = `
        <span class="lb-rank">${medal}</span>
        <span class="lb-name">${entry.name}</span>
        <span class="lb-hits">💥 ${entry.hits}</span>
      `;
      ingameLeaderboardDiv.appendChild(row);
    });
  }
}

// 加入房间
function joinRoom(roomId) {
  const playerName = playerNameInput.value.trim() || '匿名玩家';

  if (!roomId) {
    joinError.textContent = '请选择或创建一个房间';
    return;
  }

  joinError.textContent = '';
  currentRoom = roomId;

  socket.emit('join-room', { roomId, playerName });
}

// 创建新房间（含自定义尺寸）
function createRoom() {
  const playerName = playerNameInput.value.trim() || '匿名玩家';
  const roomId = generateRoomId();
  const width = parseInt(boardWidthInput?.value) || 16;
  const height = parseInt(boardHeightInput?.value) || 16;
  const mines = parseInt(boardMinesInput?.value) || 40;
  console.log('[createRoom] sending:', { roomId, width, height, mines });
  currentRoom = roomId;
  socket.emit('join-room', { roomId, playerName, width, height, mines });
}

// 更新游戏状态
function updateGameState(state) {
  gameState = state;
  players = state.players || [];

  renderBoard(state.board);
  renderPlayers();
  updateFlagCount(state.board);
  updateGameStatus(state.gameStatus);

  // 切换到游戏界面
  if (currentRoom && !joinScreen.classList.contains('hidden')) {
    joinScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');
    currentRoomSpan.textContent = currentRoom;
  }

  // 显示雷区尺寸
  if (state.width && state.height && state.mines) {
    boardSizeInfo.textContent = `${state.width}×${state.height} / ${state.mines}雷`;
  }
}

const CELL_SIZE = 35;

// 渲染棋盘
function renderBoard(board) {
  if (!board) return;

  const width = board[0]?.length || 16;
  const height = board.length || 16;
  const cellSize = CELL_SIZE;
  const fontSize = 16;

  boardDiv.style.gridTemplateColumns = `repeat(${width}, ${cellSize}px)`;
  boardDiv.innerHTML = '';

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cellData = board[y][x];
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.x = x;
      cell.dataset.y = y;
      cell.style.width = cellSize + 'px';
      cell.style.height = cellSize + 'px';
      cell.style.fontSize = fontSize + 'px';

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

      if (gameState && (gameState.gameStatus === 'won' || gameState.gameStatus === 'lost')) {
        cell.classList.add('game-over');
      }

      cell.addEventListener('click', () => handleCellClick(x, y));
      cell.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        handleCellRightClick(x, y);
      });

      boardDiv.appendChild(cell);
    }
  }
}


// ====== 拖动平移（桌面端）======
const boardWrapper = document.querySelector('.board-wrapper');
let isDragging = false;
let hasDragged = false;
let dragStartX = 0, dragStartY = 0;
let scrollStartX = 0, scrollStartY = 0;
const DRAG_THRESHOLD = 5;

boardWrapper.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  isDragging = true;
  hasDragged = false;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  scrollStartX = boardWrapper.scrollLeft;
  scrollStartY = boardWrapper.scrollTop;
  boardWrapper.classList.add('dragging');
});

document.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  const dx = e.clientX - dragStartX;
  const dy = e.clientY - dragStartY;
  if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
    hasDragged = true;
    boardWrapper.scrollLeft = scrollStartX - dx;
    boardWrapper.scrollTop = scrollStartY - dy;
  }
});

document.addEventListener('mouseup', () => {
  isDragging = false;
  boardWrapper.classList.remove('dragging');
  // 短暂延迟后清除 hasDragged，避免 click 触发
  setTimeout(() => { hasDragged = false; }, 50);
});

// 处理格子点击（揭开）
function handleCellClick(x, y) {
  if (hasDragged) return; // 拖动后忽略点击
  if (!socket || !currentRoom) return;
  if (gameState && (gameState.gameStatus === 'won' || gameState.gameStatus === 'lost')) return;
  socket.emit('reveal-cell', { x, y });
}

// 处理右键点击（插旗）
function handleCellRightClick(x, y) {
  if (!socket || !currentRoom) return;
  if (gameState && (gameState.gameStatus === 'won' || gameState.gameStatus === 'lost')) return;
  socket.emit('toggle-flag', { x, y });
}

// 更新旗帜计数
function updateFlagCount(board) {
  let flagCount = 0;
  let mineCount = gameState?.mines || 40;

  if (board) {
    for (let y = 0; y < board.length; y++) {
      for (let x = 0; x < board[y].length; x++) {
        if (board[y][x].isFlagged) flagCount++;
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

// 显示游戏结束弹窗
function showGameOverModal(won, message) {
  gameOverTitle.textContent = won ? '🎉 恭喜获胜！' : '💥 游戏结束';
  gameOverMessage.textContent = message;
  gameOverModal.classList.remove('hidden');
}

function hideGameOverModal() {
  gameOverModal.classList.add('hidden');
}

// 离开房间
function leaveRoom() {
  if (socket) socket.emit('leave-room');
  currentRoom = null;
  currentPlayer = null;
  players = [];
  gameState = null;

  joinScreen.classList.remove('hidden');
  gameScreen.classList.add('hidden');
  hideGameOverModal();

  // 刷新房间列表
  socket.emit('get-rooms');
}

// 新建游戏
function startNewGame() {
  if (socket && currentRoom) {
    socket.emit('new-game');
  }
  hideGameOverModal();
}

// 显示游戏状态（临时）
function showGameStatus(message) {
  gameStatusSpan.textContent = message;
  setTimeout(() => {
    if (gameState) updateGameStatus(gameState.gameStatus);
  }, 3000);
}

// 创建面板展开/折叠
let createExpanded = false;
createBody.style.display = 'none';
createToggle.addEventListener('click', () => {
  createExpanded = !createExpanded;
  createBody.style.display = createExpanded ? 'block' : 'none';
  createToggle.querySelector('.create-arrow').textContent = createExpanded ? '▾' : '▸';
});

// 预设按钮
document.querySelectorAll('.btn-preset').forEach(btn => {
  btn.addEventListener('click', () => {
    boardWidthInput.value = btn.dataset.w;
    boardHeightInput.value = btn.dataset.h;
    boardMinesInput.value = btn.dataset.m;
    document.querySelectorAll('.btn-preset').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// 切换游戏内榜单展开/折叠
lbToggle.addEventListener('click', () => {
  leaderboardExpanded = !leaderboardExpanded;
  ingameLbBody.style.display = leaderboardExpanded ? 'block' : 'none';
  lbToggle.querySelector('.lb-arrow').textContent = leaderboardExpanded ? '▾' : '▸';
});

// 事件监听
createRoomBtn.addEventListener('click', createRoom);
refreshBtn.addEventListener('click', () => socket.emit('get-rooms'));
leaveBtn.addEventListener('click', leaveRoom);
newGameBtn.addEventListener('click', startNewGame);
restartBtn.addEventListener('click', startNewGame);

playerNameInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') createRoom();
});

// 初始化
initSocket();

console.log('Multiplayer Minesweeper (Expert Mode) client initialized');
