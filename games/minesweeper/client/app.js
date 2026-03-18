// 多人扫雷前端逻辑
const SERVER_URL = 'http://150.158.110.168:3002';
const DEFAULT_ROOM = '游乐场';
const PLAYER_NAME_KEY = 'minesweeper_player_name';

// 游戏状态
let socket = null;
let currentRoom = null;
let currentPlayer = null;
let currentPlayerName = '';
let players = [];
let gameState = null;
let activeLeaderboardTab = 'score';
let autoRestartTimer = null;

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
const playersListDiv = document.getElementById('players-list');
const flagCountSpan = document.getElementById('flag-count');
const mineCountSpan = document.getElementById('mine-count');
const gameStatusSpan = document.getElementById('game-status');
const boardDiv = document.getElementById('board');
const gameOverModal = document.getElementById('game-over-modal');
const gameOverTitle = document.getElementById('game-over-title');
const gameOverMessage = document.getElementById('game-over-message');
const gameOverHint = document.getElementById('game-over-hint');
const roomListDiv = document.getElementById('room-list');
const leaderboardDiv = document.getElementById('leaderboard');
const ingameScoreLb = document.getElementById('ingame-score-leaderboard');
const ingameMineLb = document.getElementById('ingame-mine-leaderboard');

// 名字弹窗
const nameModal = document.getElementById('name-modal');
const playerNameModalInput = document.getElementById('player-name-modal-input');
const startGameBtn = document.getElementById('start-game-btn');

// 随机棋盘配置（多种尺寸和难度）
function getRandomBoardConfig() {
  const presets = [
    { width: 9,  height: 9,  mines: 10 },
    { width: 9,  height: 9,  mines: 15 },
    { width: 12, height: 12, mines: 20 },
    { width: 16, height: 12, mines: 30 },
    { width: 16, height: 16, mines: 40 },
    { width: 20, height: 16, mines: 55 },
    { width: 25, height: 16, mines: 80 },
    { width: 30, height: 16, mines: 99 },
  ];
  return presets[Math.floor(Math.random() * presets.length)];
}

// 加入默认房间
function joinDefaultRoom() {
  currentRoom = DEFAULT_ROOM;
  socket.emit('join-room', { roomId: DEFAULT_ROOM, playerName: currentPlayerName });
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
    if (currentPlayerName) {
      joinDefaultRoom();
    }
  });

  socket.on('disconnect', () => {
    showGameStatus('连接断开，正在重连...');
  });

  socket.on('room-list', (rooms) => {
    renderRoomList(rooms);
  });

  socket.on('leaderboard-update', (data) => {
    renderMineLeaderboard(data);
  });

  socket.on('score-leaderboard-update', (data) => {
    console.log('[score-lb] received:', data);
    renderScoreLeaderboard(data);
  });

  socket.on('game-state', (state) => {
    updateGameState(state);
  });

  socket.on('player-info', (player) => {
    currentPlayer = player;
  });

  socket.on('game-over', (data) => {
    showGameOverModal(data.won, data.message);
  });

  socket.on('error', (error) => {
    if (joinError) joinError.textContent = error.message || '发生错误';
  });
}

// 渲染房间列表（大厅用，隐藏状态）
function renderRoomList(rooms) {
  if (!roomListDiv) return;
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

// 渲染暴雷榜
function renderMineLeaderboard(data) {
  // 大厅榜单（隐藏状态）
  if (leaderboardDiv) {
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
  }

  // 游戏内暴雷榜
  if (!data || data.length === 0) {
    ingameMineLb.innerHTML = '<div class="leaderboard-empty">暂无记录</div>';
  } else {
    ingameMineLb.innerHTML = '';
    data.slice(0, 10).forEach((entry, index) => {
      const row = document.createElement('div');
      row.className = 'lb-row lb-row-sm';
      const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
      row.innerHTML = `
        <span class="lb-rank">${medal}</span>
        <span class="lb-name">${entry.name}</span>
        <span class="lb-hits">💥 ${entry.hits}</span>
      `;
      ingameMineLb.appendChild(row);
    });
  }
}

// 渲染得分榜
function renderScoreLeaderboard(data) {
  if (!data || data.length === 0) {
    ingameScoreLb.innerHTML = '<div class="leaderboard-empty">暂无记录</div>';
    return;
  }
  ingameScoreLb.innerHTML = '';
  data.slice(0, 10).forEach((entry, index) => {
    const row = document.createElement('div');
    row.className = 'lb-row lb-row-sm';
    const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
    row.innerHTML = `
      <span class="lb-rank">${medal}</span>
      <span class="lb-name">${entry.name}</span>
      <span class="lb-score">⭐ ${entry.score}</span>
    `;
    ingameScoreLb.appendChild(row);
  });
}

// 加入房间（大厅用）
function joinRoom(roomId) {
  const playerName = playerNameInput?.value.trim() || currentPlayerName || '匿名玩家';
  if (!roomId) {
    if (joinError) joinError.textContent = '请选择或创建一个房间';
    return;
  }
  if (joinError) joinError.textContent = '';
  currentRoom = roomId;
  socket.emit('join-room', { roomId, playerName });
}

// 创建新房间（大厅用）
function createRoom() {
  const playerName = playerNameInput?.value.trim() || currentPlayerName || '匿名玩家';
  const roomId = generateRoomId();
  const width = parseInt(boardWidthInput?.value) || 16;
  const height = parseInt(boardHeightInput?.value) || 16;
  const mines = parseInt(boardMinesInput?.value) || 40;
  currentRoom = roomId;
  socket.emit('join-room', { roomId, playerName, width, height, mines });
}

// 生成随机房间号
function generateRoomId() {
  const adjectives = ['红色', '蓝色', '快速', '猛烈', '神秘', '闪亮', '暗黑', '极速'];
  const nouns = ['炸弹', '猎人', '战士', '雷达', '扫雷', '勇士', '探险', '英雄'];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(Math.random() * 100);
  return `${adj}${noun}${num}`;
}

// 更新游戏状态
function updateGameState(state) {
  const prevStatus = gameState?.gameStatus;
  gameState = state;
  players = state.players || [];

  renderBoard(state.board);
  renderPlayers();
  updateFlagCount(state.board);
  updateGameStatus(state.gameStatus);

  // 加入一个已结束的房间时（如刷新后），自动触发新局
  if (state.gameStatus === 'lost' && prevStatus === undefined && !autoRestartTimer) {
    gameOverHint.classList.remove('hidden');
    gameOverHint.textContent = '3秒后自动开始新游戏...';
    autoRestartTimer = setTimeout(() => {
      autoRestartTimer = null;
      gameOverHint.classList.add('hidden');
      socket.emit('new-game', getRandomBoardConfig());
    }, 3000);
  }

  // 切换到游戏界面
  if (currentRoom && gameScreen.classList.contains('hidden')) {
    joinScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');
    document.body.classList.add('in-game');
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

      let longPressTimer = null;
      let longPressOccurred = false;

      cell.addEventListener('click', () => {
        if (longPressOccurred) { longPressOccurred = false; return; }
        handleCellClick(x, y);
      });
      cell.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        handleCellRightClick(x, y);
      });
      cell.addEventListener('touchstart', () => {
        longPressOccurred = false;
        longPressTimer = setTimeout(() => {
          if (!hasDragged) {
            longPressOccurred = true;
            handleCellRightClick(x, y);
          }
        }, 500);
      }, { passive: true });
      cell.addEventListener('touchend', () => clearTimeout(longPressTimer));
      cell.addEventListener('touchmove', () => clearTimeout(longPressTimer));

      boardDiv.appendChild(cell);
    }
  }

  requestAnimationFrame(updateScrollHints);
}


// ====== 滚动提示 ======
const boardWrapper = document.querySelector('.board-wrapper');
const hintRight  = document.querySelector('.scroll-hint-right');
const hintLeft   = document.querySelector('.scroll-hint-left');
const hintBottom = document.querySelector('.scroll-hint-bottom');
const hintTop    = document.querySelector('.scroll-hint-top');

function updateScrollHints() {
  const bw = boardWrapper;
  const canRight  = bw.scrollLeft < bw.scrollWidth  - bw.clientWidth  - 1;
  const canLeft   = bw.scrollLeft > 1;
  const canBottom = bw.scrollTop  < bw.scrollHeight - bw.clientHeight - 1;
  const canTop    = bw.scrollTop  > 1;
  hintRight .classList.toggle('visible', canRight);
  hintLeft  .classList.toggle('visible', canLeft);
  hintBottom.classList.toggle('visible', canBottom);
  hintTop   .classList.toggle('visible', canTop);
}

boardWrapper.addEventListener('scroll', updateScrollHints);

// ====== 拖动平移（桌面端）======
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
    updateScrollHints();
  }
});

document.addEventListener('mouseup', () => {
  isDragging = false;
  boardWrapper.classList.remove('dragging');
  setTimeout(() => { hasDragged = false; }, 50);
});

// ====== 触摸拖动（移动端）======
boardWrapper.addEventListener('touchstart', (e) => {
  if (e.touches.length !== 1) return;
  const t = e.touches[0];
  isDragging = true;
  hasDragged = false;
  dragStartX = t.clientX;
  dragStartY = t.clientY;
  scrollStartX = boardWrapper.scrollLeft;
  scrollStartY = boardWrapper.scrollTop;
}, { passive: true });

boardWrapper.addEventListener('touchmove', (e) => {
  if (!isDragging || e.touches.length !== 1) return;
  const t = e.touches[0];
  const dx = t.clientX - dragStartX;
  const dy = t.clientY - dragStartY;
  if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
    hasDragged = true;
    boardWrapper.scrollLeft = scrollStartX - dx;
    boardWrapper.scrollTop  = scrollStartY - dy;
    updateScrollHints();
    e.preventDefault();
  }
}, { passive: false });

boardWrapper.addEventListener('touchend', () => {
  isDragging = false;
  setTimeout(() => { hasDragged = false; }, 50);
});

// 处理格子点击（揭开）
function handleCellClick(x, y) {
  if (hasDragged) return;
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

  // 只有胜利或失败时才显示"新游戏"按钮
  if (status === 'won' || status === 'lost') {
    newGameBtn.classList.remove('hidden');
  } else {
    newGameBtn.classList.add('hidden');
  }
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

  if (!won) {
    // 暴雷：2秒后自动开新局（随机尺寸）
    gameOverHint.classList.remove('hidden');
    gameOverHint.textContent = '2秒后自动开始新游戏...';
    if (autoRestartTimer) clearTimeout(autoRestartTimer);
    autoRestartTimer = setTimeout(() => {
      autoRestartTimer = null;
      hideGameOverModal();
      socket.emit('new-game', getRandomBoardConfig());
    }, 2000);
  } else {
    gameOverHint.classList.add('hidden');
  }
}

function hideGameOverModal() {
  gameOverModal.classList.add('hidden');
}

// 离开房间（退出到名字界面）
function leaveRoom() {
  if (autoRestartTimer) {
    clearTimeout(autoRestartTimer);
    autoRestartTimer = null;
  }
  if (socket) socket.emit('leave-room');
  currentRoom = null;
  currentPlayer = null;
  players = [];
  gameState = null;
  currentPlayerName = '';
  localStorage.removeItem(PLAYER_NAME_KEY);

  gameScreen.classList.add('hidden');
  document.body.classList.remove('in-game');
  hideGameOverModal();

  // 显示名字输入弹窗
  nameModal.classList.remove('hidden');
  playerNameModalInput.value = '';
  setTimeout(() => playerNameModalInput.focus(), 100);
}

// 显示游戏状态（临时）
function showGameStatus(message) {
  gameStatusSpan.textContent = message;
  setTimeout(() => {
    if (gameState) updateGameStatus(gameState.gameStatus);
  }, 3000);
}

// 大厅：创建面板展开/折叠
if (createBody) {
  let createExpanded = false;
  createBody.style.display = 'none';
  createToggle?.addEventListener('click', () => {
    createExpanded = !createExpanded;
    createBody.style.display = createExpanded ? 'block' : 'none';
    createToggle.querySelector('.create-arrow').textContent = createExpanded ? '▾' : '▸';
  });
}

// 大厅：预设按钮
document.querySelectorAll('.btn-preset').forEach(btn => {
  btn.addEventListener('click', () => {
    if (boardWidthInput) boardWidthInput.value = btn.dataset.w;
    if (boardHeightInput) boardHeightInput.value = btn.dataset.h;
    if (boardMinesInput) boardMinesInput.value = btn.dataset.m;
    document.querySelectorAll('.btn-preset').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// 榜单标签切换
document.querySelectorAll('.lb-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const tabName = tab.dataset.tab;
    activeLeaderboardTab = tabName;
    document.querySelectorAll('.lb-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    ingameScoreLb.classList.toggle('hidden', tabName !== 'score');
    ingameMineLb.classList.toggle('hidden', tabName !== 'mine');
  });
});

// 名字弹窗：提交名字
function submitName() {
  const name = playerNameModalInput.value.trim();
  if (!name) {
    playerNameModalInput.focus();
    return;
  }
  currentPlayerName = name.slice(0, 12);
  localStorage.setItem(PLAYER_NAME_KEY, currentPlayerName);
  nameModal.classList.add('hidden');
  if (socket && socket.connected) {
    joinDefaultRoom();
  }
}

startGameBtn.addEventListener('click', submitName);
playerNameModalInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') submitName();
});

// 按钮事件
createRoomBtn?.addEventListener('click', createRoom);
refreshBtn?.addEventListener('click', () => socket.emit('get-rooms'));
leaveBtn.addEventListener('click', leaveRoom);
newGameBtn.addEventListener('click', () => socket.emit('new-game', getRandomBoardConfig()));
restartBtn.addEventListener('click', () => {
  if (autoRestartTimer) {
    clearTimeout(autoRestartTimer);
    autoRestartTimer = null;
  }
  hideGameOverModal();
  socket.emit('new-game', getRandomBoardConfig());
});

playerNameInput?.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') createRoom();
});

// 初始化
function init() {
  const savedName = localStorage.getItem(PLAYER_NAME_KEY);
  if (savedName) {
    currentPlayerName = savedName;
    nameModal.classList.add('hidden');
  } else {
    nameModal.classList.remove('hidden');
    setTimeout(() => playerNameModalInput.focus(), 100);
  }
  initSocket();
}

init();

console.log('Multiplayer Minesweeper client initialized');
