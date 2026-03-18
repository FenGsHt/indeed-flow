'use strict';

// ─── Socket 连接 ─────────────────────────────────────────────
const PROXY  = { url: window.location.origin, path: '/uno-ws/socket.io' };
const DIRECT = { url: 'http://150.158.110.168:3004', path: '/socket.io' };

let cfg = PROXY;
let socket = io(cfg.url, { path: cfg.path, transports: ['websocket', 'polling'] });

socket.on('connect_error', () => {
  if (cfg === PROXY) {
    cfg = DIRECT;
    socket.io.uri = cfg.url;
    socket.io.opts.path = cfg.path;
    socket.connect();
  }
});

// ─── 状态 ───────────────────────────────────────────────────
let myId        = null;
let myRoomId    = null;
let isReady     = false;
let gameState   = null;
let pendingCard = null; // 等待选色的卡牌 id

// ─── DOM 快捷引用 ────────────────────────────────────────────
const $ = id => document.getElementById(id);

const screens = {
  lobby:   $('lobby-screen'),
  waiting: $('waiting-screen'),
  game:    $('game-screen'),
};

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.add('hidden'));
  screens[name].classList.remove('hidden');
}

// ─── 玩家头像颜色 ────────────────────────────────────────────
const AVATAR_COLORS = ['#e53935','#1e88e5','#43a047','#fdd835','#ab47bc','#ff7043','#00acc1','#8d6e63'];
function avatarColor(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

// ─── Toast ───────────────────────────────────────────────────
function toast(msg, duration = 2800) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  $('toast-container').appendChild(el);
  setTimeout(() => el.remove(), duration);
}

// ─── 随机房间名 ──────────────────────────────────────────────
const ADJECTIVES = ['疯狂', '彩虹', '闪电', '神秘', '宇宙', '暗黑', '极速', '魔法'];
const NOUNS      = ['牌局', '对决', '战场', '挑战', '擂台', '联盟', '风暴'];
function randomRoomName() {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const n = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return a + n + Math.floor(Math.random() * 90 + 10);
}

// ─── 卡牌渲染 ────────────────────────────────────────────────
const COLOR_NAMES = { red: '红', green: '绿', blue: '蓝', yellow: '黄', wild: '万能' };
const COLOR_HEX   = { red: '#e53935', green: '#43a047', blue: '#1e88e5', yellow: '#fdd835' };

function cardSymbol(card) {
  if (card.type === 'number')     return String(card.value);
  if (card.type === 'skip')       return '⊘';
  if (card.type === 'reverse')    return '⇄';
  if (card.type === 'draw2')      return '+2';
  if (card.type === 'wild')       return '★';
  if (card.type === 'wild_draw4') return '+4';
  return '?';
}

function makeCard(card, opts = {}) {
  const sym = cardSymbol(card);
  const el  = document.createElement('div');
  el.className  = `uno-card ${card.color}`;
  el.dataset.id = card.id;

  if (opts.playable === false) el.classList.add('not-playable');
  if (opts.playable === true)  el.classList.add('playable');

  el.innerHTML = `
    <span class="card-corner tl">${sym}</span>
    <div class="card-oval"><span class="card-symbol">${sym}</span></div>
    <span class="card-corner br">${sym}</span>
  `;
  return el;
}

function makeCardBack() {
  const el = document.createElement('div');
  el.className = 'card-back';
  el.innerHTML = '<span class="card-back-label">UNO</span>';
  return el;
}

// ─── 大厅 ───────────────────────────────────────────────────
$('create-toggle').addEventListener('click', () => {
  const body  = $('create-body');
  const arrow = $('create-arrow');
  const open  = body.style.display !== 'none';
  body.style.display = open ? 'none' : '';
  arrow.textContent  = open ? '▼' : '▲';
});

$('btn-refresh').addEventListener('click', () => socket.emit('get-rooms'));

$('btn-create').addEventListener('click', () => {
  const name = $('player-name').value.trim();
  if (!name) { toast('请输入你的名字'); return; }
  const rid = randomRoomName();
  socket.emit('join-room', {
    roomId: rid,
    playerName: name,
    settings: {
      stackDraw:  $('opt-stack').checked,
      sevensZero: $('opt-sevens').checked,
      forcePlay:  $('opt-force').checked,
    },
  });
});

socket.on('room-list', rooms => {
  const list = $('room-list');
  if (!rooms.length) {
    list.innerHTML = '<div class="room-empty">暂无房间，快来创建第一个！</div>';
    return;
  }
  list.innerHTML = rooms.map(r => `
    <div class="room-card">
      <div class="room-card-info">
        <div class="room-card-name">${r.roomId}</div>
        <div class="room-card-meta">${r.playerCount} 名玩家</div>
      </div>
      <div class="room-card-right">
        <span class="badge badge-${r.status}">${r.status === 'waiting' ? '等待中' : r.status === 'playing' ? '游戏中' : '已结束'}</span>
        ${r.canJoin ? `<button class="btn btn-primary btn-sm join-btn" data-room="${r.roomId}">加入</button>` : ''}
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.join-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = $('player-name').value.trim();
      if (!name) { toast('请输入你的名字'); return; }
      socket.emit('join-room', { roomId: btn.dataset.room, playerName: name });
    });
  });
});

// ─── 等待室 ──────────────────────────────────────────────────
socket.on('joined', ({ roomId }) => {
  myRoomId = roomId;
  $('waiting-room-name').textContent = `🃏 ${roomId}`;
  isReady = false;
  $('btn-ready').textContent = '准备';
  $('btn-ready').className = 'btn btn-primary';
  showScreen('waiting');
});

socket.on('lobby-state', state => {
  if (state.status === 'playing') return; // game started, handled by game-state

  renderWaitingPlayers(state.players);

  const hint = state.canStart
    ? '所有人已准备，即将开始！'
    : `等待玩家准备… (${state.players.filter(p => p.ready).length}/${state.players.length})`;
  $('waiting-hint-text').textContent = hint;
});

function renderWaitingPlayers(players) {
  $('waiting-players').innerHTML = players.map((p, i) => `
    <div class="waiting-player">
      <div class="player-avatar" style="background:${avatarColor(p.name)}">${p.name[0].toUpperCase()}</div>
      <div class="waiting-player-name">${p.name}${p.id === myId ? ' (你)' : ''}</div>
      <span class="ready-badge ${p.ready ? 'ready-yes' : 'ready-no'}">${p.ready ? '已准备 ✓' : '未准备'}</span>
    </div>
  `).join('');
}

$('btn-ready').addEventListener('click', () => {
  isReady = !isReady;
  socket.emit('set-ready', { ready: isReady });
  $('btn-ready').textContent = isReady ? '取消准备' : '准备';
  $('btn-ready').className = isReady ? 'btn btn-ghost' : 'btn btn-primary';
});

$('btn-leave-waiting').addEventListener('click', () => {
  socket.emit('leave-room');
  myRoomId = null;
  showScreen('lobby');
});

// ─── 游戏 ───────────────────────────────────────────────────
socket.on('game-state', state => {
  gameState = state;
  if (state.status === 'playing') {
    showScreen('game');
    renderGame(state);
  }
});

function renderGame(state) {
  const me = state.players.find(p => p.isYou);
  if (!me) return;

  const isMyTurn = state.currentPlayerId === myId;

  // 顶部信息
  $('game-room-name').textContent = myRoomId;
  $('game-direction').textContent  = state.direction === 1 ? '↻' : '↺';
  const currentName = state.players.find(p => p.id === state.currentPlayerId)?.name || '';
  $('game-turn-label').textContent = isMyTurn ? '⚡ 你的回合' : `${currentName} 的回合`;
  $('game-turn-label').style.color  = isMyTurn ? '#ffd700' : 'var(--muted)';

  // 颜色指示
  const dot = $('color-dot');
  dot.style.background = COLOR_HEX[state.currentColor] || 'rgba(255,255,255,0.3)';
  $('color-label').textContent = COLOR_NAMES[state.currentColor] || '';

  const pdb = $('pending-draw-badge');
  if (state.pendingDraw > 0) {
    pdb.textContent = `+${state.pendingDraw} 待摸`;
    pdb.classList.remove('hidden');
  } else {
    pdb.classList.add('hidden');
  }

  // 弃牌堆顶牌
  const discardEl = $('discard-top');
  discardEl.innerHTML = '';
  if (state.topCard) discardEl.appendChild(makeCard(state.topCard));

  // 摸牌堆
  $('deck-count').textContent = `${state.deckCount} 张`;

  // 其他玩家
  renderOtherPlayers(state);

  // 我的手牌
  renderHand(me.hand || [], state);

  // UNO 按钮
  const unoBtn = $('btn-uno');
  if (isMyTurn && me.hand && me.hand.length === 1 && !me.saidUno) {
    unoBtn.classList.add('show');
  } else {
    unoBtn.classList.remove('show');
  }

  // 摸牌区域高亮
  $('btn-draw').style.opacity = isMyTurn ? '1' : '0.5';
  $('btn-draw').style.cursor  = isMyTurn ? 'pointer' : 'default';
}

function renderOtherPlayers(state) {
  const others = state.players.filter(p => !p.isYou);
  const el = $('other-players');
  el.innerHTML = '';

  others.forEach(p => {
    const div = document.createElement('div');
    div.className = 'other-player';
    if (p.id === state.currentPlayerId) div.classList.add('active');
    if (p.cardCount === 1 && !p.saidUno) div.classList.add('uno-danger');
    div.dataset.pid = p.id;

    // 迷你背面牌（最多显示 10 张）
    const cardCount = Math.min(p.cardCount, 10);
    const miniCards = Array(cardCount).fill('<div class="mini-card"></div>').join('');

    div.innerHTML = `
      ${p.saidUno ? '<span class="uno-tag">UNO!</span>' : ''}
      <div class="other-player-name">${p.name}</div>
      <div class="other-player-cards">${miniCards}</div>
      <div class="other-player-score">🏆 ${p.score} 胜</div>
    `;

    // 点击抓 UNO（对方有1张且未喊）
    if (p.cardCount === 1 && !p.saidUno) {
      div.title = '点击抓 UNO！';
      div.addEventListener('click', () => {
        socket.emit('catch-uno', { targetId: p.id });
      });
    }

    el.appendChild(div);
  });
}

function renderHand(hand, state) {
  const scroll = $('hand-scroll');
  scroll.innerHTML = '';
  const isMyTurn = state.currentPlayerId === myId;

  // 排序（可按颜色+数字）
  const sorted = [...hand].sort((a, b) => {
    const colorOrder = { red: 0, green: 1, blue: 2, yellow: 3, wild: 4 };
    if (a.color !== b.color) return (colorOrder[a.color] || 0) - (colorOrder[b.color] || 0);
    return (a.value ?? 99) - (b.value ?? 99);
  });

  sorted.forEach(card => {
    const canPlay = isMyTurn && canPlayCard(card, state);
    const el = makeCard(card, { playable: isMyTurn ? canPlay : null });
    if (isMyTurn && canPlay) {
      el.addEventListener('click', () => onCardClick(card));
    }
    scroll.appendChild(el);
  });
}

function canPlayCard(card, state) {
  const def_isWild    = card.type === 'wild' || card.type === 'wild_draw4';
  const def_canStack  = card.type === 'draw2' || card.type === 'wild_draw4';
  const top = state.topCard;

  if (state.pendingDraw > 0) {
    if (!state.settings?.stackDraw) return false;
    return def_canStack && card.type === top?.type;
  }

  if (def_isWild) return true;
  if (card.color === state.currentColor) return true;
  if (card.type !== 'number' && card.type === top?.type) return true;
  if (card.type === 'number' && top?.type === 'number' && card.value === top.value) return true;
  return false;
}

function onCardClick(card) {
  const needsColor = card.type === 'wild' || card.type === 'wild_draw4';
  if (needsColor) {
    pendingCard = card.id;
    $('color-picker').classList.remove('hidden');
  } else {
    socket.emit('play-card', { cardId: card.id });
  }
}

// 颜色选择
$('color-picker').querySelectorAll('.color-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const color = btn.dataset.color;
    $('color-picker').classList.add('hidden');
    if (pendingCard !== null) {
      socket.emit('play-card', { cardId: pendingCard, chosenColor: color });
      pendingCard = null;
    }
  });
});

// 摸牌
$('btn-draw').addEventListener('click', () => {
  if (!gameState) return;
  const isMyTurn = gameState.currentPlayerId === myId;
  if (!isMyTurn) return;
  socket.emit('draw-card');
});

// 喊 UNO
$('btn-uno').addEventListener('click', () => {
  socket.emit('say-uno');
});

// 整理手牌（重新排序）
$('btn-sort').addEventListener('click', () => {
  if (gameState) renderHand(gameState.players.find(p => p.isYou)?.hand || [], gameState);
});

// 离开游戏
$('btn-leave-game').addEventListener('click', () => {
  socket.emit('leave-room');
  myRoomId = null;
  gameState = null;
  showScreen('lobby');
});

// ─── 游戏结束 ────────────────────────────────────────────────
socket.on('game-over', winner => {
  const isWinner = winner.id === myId;
  $('game-over-msg').textContent = isWinner
    ? `🎉 恭喜你赢得了这局！`
    : `🏆 ${winner.name} 赢得了这局！`;

  // 积分榜
  if (gameState) {
    const sorted = [...gameState.players].sort((a, b) => (b.score || 0) - (a.score || 0));
    $('score-list').innerHTML = sorted.map((p, i) => `
      <div class="score-row ${p.id === winner.id ? 'winner' : ''}">
        <span class="score-rank">${['🥇','🥈','🥉'][i] || (i+1)}</span>
        <span class="score-name">${p.name}${p.id === myId ? ' (你)' : ''}</span>
        <span class="score-val">${p.score || 0} 胜</span>
      </div>
    `).join('');
  }

  $('game-over-modal').classList.remove('hidden');
});

$('btn-play-again').addEventListener('click', () => {
  socket.emit('play-again');
  $('game-over-modal').classList.add('hidden');
  isReady = false;
  $('btn-ready').textContent = '准备';
  $('btn-ready').className = 'btn btn-primary';
  showScreen('waiting');
});

$('btn-back-lobby').addEventListener('click', () => {
  socket.emit('leave-room');
  $('game-over-modal').classList.add('hidden');
  myRoomId = null;
  gameState = null;
  showScreen('lobby');
});

// ─── 广播事件 ────────────────────────────────────────────────
socket.on('uno-called', ({ playerName }) => {
  toast(`🔔 ${playerName} 喊了 UNO！`, 3000);
});

socket.on('uno-caught', ({ targetName }) => {
  toast(`🚨 ${targetName} 忘喊 UNO，被抓了！摸 2 张`, 3000);
});

socket.on('error', ({ message }) => {
  toast(`⚠️ ${message}`, 2500);
});

// ─── Socket 连接 ────────────────────────────────────────────
socket.on('connect', () => {
  myId = socket.id;
});

socket.on('disconnect', () => {
  toast('连接断开，正在重连…');
});
