'use strict';

// ══════════════════════════════════════════════════════════════
// 音频引擎（Web Audio API，全程无外部文件）
// ══════════════════════════════════════════════════════════════
const SoundEngine = (() => {
  let ctx, masterGain, sfxGain, bgmGain;
  let bgmTimer = null;
  let bgmOscs  = [];
  let chordIdx = 0;

  // C Am F G 和弦（低八度，轻柔背景）
  const CHORDS = [
    [130.8, 164.8, 196.0],
    [110.0, 138.6, 164.8],
    [ 87.3, 110.0, 130.8],
    [ 98.0, 123.5, 146.8],
  ];

  function _init() {
    if (ctx) return;
    ctx        = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = ctx.createGain(); masterGain.gain.value = +(_load('vol-master') ?? 0.7);
    sfxGain    = ctx.createGain(); sfxGain.gain.value    = +(_load('vol-sfx')    ?? 1.0);
    bgmGain    = ctx.createGain(); bgmGain.gain.value    = +(_load('vol-bgm')    ?? 0.2);
    sfxGain.connect(masterGain);
    bgmGain.connect(masterGain);
    masterGain.connect(ctx.destination);
    // 同步滑块初值
    _syncSliders();
  }
  function _resume() { ctx?.state === 'suspended' && ctx.resume(); }
  function _load(k)  { try { return localStorage.getItem('uno_' + k); } catch { return null; } }
  function _save(k, v){ try { localStorage.setItem('uno_' + k, v); } catch {} }

  function _syncSliders() {
    const s = id => document.getElementById(id);
    if (s('vol-master')) s('vol-master').value = masterGain.gain.value;
    if (s('vol-sfx'))    s('vol-sfx').value    = sfxGain.gain.value;
    if (s('vol-bgm'))    s('vol-bgm').value    = bgmGain.gain.value;
  }

  // ── SFX 基础工具 ─────────────────────────────
  function _osc(type, freq, dur, vol, dest, startFreq) {
    const osc = ctx.createOscillator();
    const g   = ctx.createGain();
    osc.connect(g); g.connect(dest ?? sfxGain);
    osc.type = type;
    const t = ctx.currentTime;
    if (startFreq) {
      osc.frequency.setValueAtTime(startFreq, t);
      osc.frequency.exponentialRampToValueAtTime(freq, t + dur);
    } else {
      osc.frequency.value = freq;
    }
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.start(t); osc.stop(t + dur);
  }
  function _noise(dur, filterFreq, vol) {
    const buf  = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src    = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const g      = ctx.createGain();
    src.buffer = buf;
    filter.type = 'bandpass'; filter.frequency.value = filterFreq; filter.Q.value = 1;
    src.connect(filter); filter.connect(g); g.connect(sfxGain);
    g.gain.value = vol;
    src.start(); src.stop(ctx.currentTime + dur);
  }

  // ── 公开 SFX ─────────────────────────────────
  function playCard(isWild) {
    _init(); _resume();
    if (isWild) _osc('sine', 900, 0.32, 0.45, sfxGain, 150);
    else        _osc('sawtooth', 160, 0.18, 0.35, sfxGain, 520);
  }
  function drawCard() {
    _init(); _resume();
    _noise(0.09, 1100, 0.4);
  }
  function playSkip() {
    _init(); _resume();
    _osc('square', 250, 0.15, 0.25, sfxGain, 400);
  }
  function playDraw2() {
    _init(); _resume();
    [0, 1].forEach(i => setTimeout(() => _osc('sawtooth', 220 + i * 80, 0.18, 0.35), i * 90));
  }
  function sayUno() {
    _init(); _resume();
    [700, 1050].forEach((f, i) => setTimeout(() => _osc('sine', f, 0.35, 0.5), i * 110));
  }
  function yourTurn() {
    _init(); _resume();
    [440, 554].forEach((f, i) => setTimeout(() => _osc('sine', f, 0.28, 0.3), i * 80));
  }
  function playWin() {
    _init(); _resume();
    [523, 659, 784, 988, 1319].forEach((f, i) =>
      setTimeout(() => _osc('triangle', f, 0.45, 0.4), i * 100));
  }
  function playLose() {
    _init(); _resume();
    [494, 392, 311, 261].forEach((f, i) =>
      setTimeout(() => _osc('sine', f, 0.4, 0.3), i * 120));
  }

  // ── BGM ──────────────────────────────────────
  function _playChord() {
    bgmOscs.forEach(({ osc, g }) => {
      const t = ctx.currentTime;
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 1.8);
      osc.stop(t + 1.8);
    });
    bgmOscs = [];
    const chord = CHORDS[chordIdx++ % CHORDS.length];
    chord.forEach((freq, i) => {
      const osc    = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const g      = ctx.createGain();
      filter.type = 'lowpass'; filter.frequency.value = 500;
      osc.connect(filter); filter.connect(g); g.connect(bgmGain);
      osc.type = i === 0 ? 'triangle' : 'sine';
      osc.frequency.value = freq;
      const t = ctx.currentTime;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.14, t + 1.2);
      osc.start(t);
      bgmOscs.push({ osc, g });
    });
  }
  function startBgm() {
    _init(); _resume();
    if (bgmTimer) return;
    _playChord();
    bgmTimer = setInterval(_playChord, 4000);
  }
  function stopBgm() {
    if (bgmTimer) { clearInterval(bgmTimer); bgmTimer = null; }
    bgmOscs.forEach(({ osc, g }) => {
      const t = ctx.currentTime;
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 1);
      osc.stop(t + 1);
    });
    bgmOscs = [];
  }

  // ── 音量控制 ─────────────────────────────────
  function setMaster(v) { _init(); masterGain.gain.value = v; _save('vol-master', v); }
  function setSfx(v)    { _init(); sfxGain.gain.value    = v; _save('vol-sfx',    v); }
  function setBgm(v)    { _init(); bgmGain.gain.value    = v; _save('vol-bgm',    v); }

  return { playCard, drawCard, playSkip, playDraw2, sayUno, yourTurn, playWin, playLose,
           startBgm, stopBgm, setMaster, setSfx, setBgm };
})();

// ══════════════════════════════════════════════════════════════
// 视觉特效模块
// ══════════════════════════════════════════════════════════════
const VFX = {
  _COLORS: { red:'#ef5350', green:'#66bb6a', blue:'#42a5f5', yellow:'#fdd835', wild:'#fff' },

  particles(x, y, color, count = 10) {
    const c = this._COLORS[color] || '#fff';
    for (let i = 0; i < count; i++) {
      const p = document.createElement('div');
      p.className = 'vfx-particle';
      p.style.cssText = `left:${x}px;top:${y}px;background:${c};`;
      document.body.appendChild(p);
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const dist  = 35 + Math.random() * 45;
      requestAnimationFrame(() => {
        p.style.transform = `translate(${Math.cos(angle)*dist}px,${Math.sin(angle)*dist}px) scale(0)`;
        p.style.opacity   = '0';
      });
      setTimeout(() => p.remove(), 620);
    }
  },

  rainbowBurst(x, y) {
    const el = document.createElement('div');
    el.className = 'vfx-rainbow';
    el.style.cssText = `left:${x}px;top:${y}px;`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 700);
  },

  screenFlash(color) {
    const el = document.createElement('div');
    el.className = 'vfx-flash';
    el.style.background = color;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 420);
  },

  turnGlow() {
    const el = document.createElement('div');
    el.className = 'vfx-turn-glow';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 850);
  },

  confetti() {
    const cols = ['#ef5350','#fdd835','#43a047','#1e88e5','#ab47bc','#ff7043'];
    for (let i = 0; i < 70; i++) {
      setTimeout(() => {
        const p = document.createElement('div');
        p.className = 'vfx-confetti';
        const dur = 900 + Math.random() * 700;
        p.style.cssText = `left:${Math.random()*100}vw;background:${cols[i%cols.length]};animation-duration:${dur}ms;animation-delay:${Math.random()*400}ms;`;
        document.body.appendChild(p);
        setTimeout(() => p.remove(), dur + 450);
      }, Math.random() * 300);
    }
  },
};

// ─── 本地存储名字 ─────────────────────────────────────────────
const SAVED_NAME = localStorage.getItem('uno_player_name') || '';
if (SAVED_NAME) {
  document.addEventListener('DOMContentLoaded', () => {
    $('player-name').value = SAVED_NAME;
  });
}

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
let wasMyTurn   = false; // 用于检测回合切换

// ─── 重连存档 ────────────────────────────────────────────────
function getSavedGame() {
  try { return JSON.parse(localStorage.getItem('uno_saved_game') || 'null'); } catch { return null; }
}
function saveGame(roomId, playerName) {
  localStorage.setItem('uno_saved_game', JSON.stringify({ roomId, playerName }));
}
function clearSavedGame() {
  localStorage.removeItem('uno_saved_game');
}

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

$('player-name').addEventListener('input', () => {
  const v = $('player-name').value.trim();
  if (v) localStorage.setItem('uno_player_name', v);
});

$('btn-create').addEventListener('click', () => {
  const name = $('player-name').value.trim();
  if (!name) { toast('请输入你的名字'); return; }
  localStorage.setItem('uno_player_name', name);
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
  saveGame(roomId, $('player-name').value.trim() || getSavedGame()?.playerName || '');
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
  clearSavedGame();
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
  const currentName = state.players.find(p => p.id === state.currentPlayerId)?.name || '';

  // 顶部信息
  $('game-room-name').textContent = myRoomId;
  $('game-direction').textContent  = state.direction === 1 ? '↻' : '↺';
  $('game-turn-label').textContent = isMyTurn ? '⚡ 你的回合' : `${currentName} 的回合`;
  $('game-turn-label').style.color  = isMyTurn ? '#ffd700' : 'var(--muted)';

  // 回合横幅
  const banner = $('turn-banner');
  banner.classList.remove('hidden', 'my-turn', 'other-turn');
  if (isMyTurn) {
    const drawHint = state.pendingDraw > 0 ? `（需摸 +${state.pendingDraw} 或叠牌）` : '';
    banner.textContent = `⚡ 你的回合！出一张牌或摸牌${drawHint}`;
    banner.classList.add('my-turn');
  } else {
    banner.textContent = `等待 ${currentName} 出牌…`;
    banner.classList.add('other-turn');
  }

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
  const drawStack = $('btn-draw');
  if (isMyTurn) drawStack.classList.add('my-turn');
  else          drawStack.classList.remove('my-turn');

  // 摸牌 / 结束回合 按钮（底部）
  const drawBtn = $('btn-draw-action');
  const passBtn = $('btn-pass-turn');
  if (isMyTurn) {
    drawBtn.classList.remove('hidden');
    drawBtn.disabled = state.drawnThisTurn;
    passBtn.classList.toggle('hidden', !state.drawnThisTurn);
  } else {
    drawBtn.classList.add('hidden');
    passBtn.classList.add('hidden');
  }

  // 其他玩家
  renderOtherPlayers(state);

  // 我的手牌
  renderHand(me.hand || [], state);

  // UNO 按钮
  const unoBtn = $('btn-uno');
  // 手里 1~2 张且未喊时显示（2张时可预喊，打出倒二张后标记保留）
  if (isMyTurn && me.hand && me.hand.length <= 2 && me.hand.length >= 1 && !me.saidUno) {
    unoBtn.classList.add('show');
  } else {
    unoBtn.classList.remove('show');
  }

  // 摸牌区域高亮（本回合已摸则变暗）
  const canDraw = isMyTurn && !state.drawnThisTurn;
  $('btn-draw').style.opacity = canDraw ? '1' : '0.35';
  $('btn-draw').style.cursor  = canDraw ? 'pointer' : 'default';

  // 回合切换音效 + 视效
  if (isMyTurn && !wasMyTurn) {
    SoundEngine.yourTurn();
    VFX.turnGlow();
  }
  wasMyTurn = isMyTurn;
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
    if (!p.connected) div.classList.add('disconnected');
    div.dataset.pid = p.id;

    // 迷你背面牌（最多显示 10 张）
    const cardCount = Math.min(p.cardCount, 10);
    const miniCards = Array(cardCount).fill('<div class="mini-card"></div>').join('');

    div.innerHTML = `
      ${p.saidUno ? '<span class="uno-tag">UNO!</span>' : ''}
      ${!p.connected ? '<span class="disconnected-tag">断线中…</span>' : ''}
      <div class="other-player-name">${p.name}</div>
      <div class="other-player-cards">${miniCards}</div>
      <div class="other-player-score">🏆 ${p.score}胜 &nbsp;·&nbsp; ${p.points}分</div>
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

  sorted.forEach((card, i) => {
    const canPlay = isMyTurn && canPlayCard(card, state);
    const el = makeCard(card, { playable: isMyTurn ? canPlay : null });
    el.style.zIndex = i + 1; // 从左到右层叠，右边的牌在上
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

// ─── 飞牌动画 ────────────────────────────────────────────────
const FLIGHT_MS = 340; // 飞行时长

function flyCardToDiscard(sourceEl) {
  const srcRect  = sourceEl.getBoundingClientRect();
  const destRect = $('discard-top').getBoundingClientRect();

  const clone = sourceEl.cloneNode(true);
  clone.classList.remove('playable', 'not-playable');
  clone.classList.add('flying-card');
  clone.style.cssText += `
    left:${srcRect.left}px; top:${srcRect.top}px;
    width:${srcRect.width}px; height:${srcRect.height}px;
    transform:rotate(0deg); opacity:1;
  `;
  document.body.appendChild(clone);
  sourceEl.style.visibility = 'hidden';

  const dx    = destRect.left + destRect.width  / 2 - (srcRect.left + srcRect.width  / 2);
  const dy    = destRect.top  + destRect.height / 2 - (srcRect.top  + srcRect.height / 2);
  const scale = destRect.width / srcRect.width;
  const rot   = (Math.random() - 0.5) * 22; // 随机轻微旋转，增加手抛感

  requestAnimationFrame(() => requestAnimationFrame(() => {
    clone.style.transition = `transform ${FLIGHT_MS}ms cubic-bezier(0.25, 0.46, 0.45, 0.94)`;
    clone.style.transform  = `translate(${dx}px,${dy}px) scale(${scale}) rotate(${rot}deg)`;
  }));

  // 落地后快速消隐（实际牌堆 card-land 动画接替）
  setTimeout(() => {
    clone.style.transition = 'opacity 80ms ease';
    clone.style.opacity    = '0';
    setTimeout(() => clone.remove(), 100);
  }, FLIGHT_MS + 10);
}

function flyCardFromDeck() {
  const srcRect  = $('btn-draw').getBoundingClientRect();
  const destRect = $('hand-scroll').getBoundingClientRect();

  const W = 72, H = 100;
  const startX = srcRect.left + srcRect.width  / 2 - W / 2;
  const startY = srcRect.top  + srcRect.height / 2 - H / 2;

  const clone = makeCardBack();
  clone.classList.add('flying-card');
  clone.style.cssText += `
    left:${startX}px; top:${startY}px;
    width:${W}px; height:${H}px;
    transform:rotate(0deg); opacity:1;
  `;
  document.body.appendChild(clone);

  const dx  = destRect.left + destRect.width  / 2 - (startX + W / 2);
  const dy  = destRect.top  + destRect.height / 2 - (startY + H / 2);
  const rot = (Math.random() - 0.5) * 18;

  requestAnimationFrame(() => requestAnimationFrame(() => {
    clone.style.transition = `transform ${FLIGHT_MS}ms cubic-bezier(0.25, 0.46, 0.45, 0.94)`;
    clone.style.transform  = `translate(${dx}px,${dy}px) rotate(${rot}deg)`;
  }));

  setTimeout(() => {
    clone.style.transition = 'opacity 80ms ease';
    clone.style.opacity    = '0';
    setTimeout(() => clone.remove(), 100);
  }, FLIGHT_MS + 10);
}

function onCardClick(card) {
  const el = $('hand-scroll').querySelector(`[data-id="${card.id}"]`);
  if (el) flyCardToDiscard(el);

  // 出牌后短暂屏蔽 hover，避免重绘后相邻牌误触选中状态
  const scroll = $('hand-scroll');
  scroll.classList.add('no-hover');
  setTimeout(() => scroll.classList.remove('no-hover'), FLIGHT_MS + 300);

  const isWild = card.type === 'wild' || card.type === 'wild_draw4';
  SoundEngine.playCard(isWild);

  // 落地后触发粒子特效
  setTimeout(() => {
    const dest = $('discard-top').getBoundingClientRect();
    const cx = dest.left + dest.width / 2;
    const cy = dest.top  + dest.height / 2;
    VFX.particles(cx, cy, card.color);
    if (isWild) VFX.rainbowBurst(cx, cy);
    if (card.type === 'draw2' || card.type === 'wild_draw4') VFX.screenFlash('rgba(239,83,80,0.25)');
  }, FLIGHT_MS + 50);

  if (isWild) {
    pendingCard = card.id;
    // 略微延迟，等飞牌动画开始后再弹颜色选择
    setTimeout(() => $('color-picker').classList.remove('hidden'), 80);
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

// 摸牌（牌堆 + 底部按钮都能触发）
function doDraw() {
  if (!gameState) return;
  if (gameState.currentPlayerId !== myId) return;
  if (gameState.drawnThisTurn) return; // 本回合已摸过，不能再摸
  flyCardFromDeck();
  SoundEngine.drawCard();
  socket.emit('draw-card');
}
$('btn-draw').addEventListener('click', doDraw);
$('btn-draw-action').addEventListener('click', doDraw);

// 结束回合（摸牌后不出牌）
$('btn-pass-turn').addEventListener('click', () => {
  socket.emit('pass-turn');
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
  clearSavedGame();
  myRoomId = null;
  gameState = null;
  showScreen('lobby');
});

// ─── 游戏结束 ────────────────────────────────────────────────
socket.on('game-over', winner => {
  const isWinner = winner.id === myId;
  if (isWinner) { SoundEngine.playWin(); VFX.confetti(); }
  else          { SoundEngine.playLose(); }
  const pts = winner.roundPoints ?? 0;
  $('game-over-msg').textContent = isWinner
    ? `🎉 恭喜你赢得了这局！获得 ${pts} 分`
    : `🏆 ${winner.name} 赢了！获得 ${pts} 分`;

  // 积分榜：按累计分数排序
  if (gameState) {
    const sorted = [...gameState.players].sort((a, b) => (b.points || 0) - (a.points || 0));
    $('score-list').innerHTML = sorted.map((p, i) => `
      <div class="score-row ${p.id === winner.id ? 'winner' : ''}">
        <span class="score-rank">${['🥇','🥈','🥉'][i] || (i + 1)}</span>
        <span class="score-name">${p.name}${p.id === myId ? ' (你)' : ''}</span>
        <span class="score-val">${p.score || 0}胜 &nbsp; ${p.points || 0}分</span>
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
  clearSavedGame();
  $('game-over-modal').classList.add('hidden');
  myRoomId = null;
  gameState = null;
  showScreen('lobby');
});

// ─── 广播事件 ────────────────────────────────────────────────
socket.on('uno-called', ({ playerName }) => {
  toast(`🔔 ${playerName} 喊了 UNO！`, 3000);
  SoundEngine.sayUno();
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
  // 刷新后自动尝试重连
  const saved = getSavedGame();
  if (saved) socket.emit('reconnect-game', saved);
});

socket.on('disconnect', () => {
  toast('连接断开，正在重连…');
});

// ─── 榜单 ────────────────────────────────────────────────────
socket.on('leaderboard', ({ allTime, today }) => {
  renderLb('lb-today',   today);
  renderLb('lb-alltime', allTime);
});

function renderLb(tbodyId, entries) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  if (!entries || !entries.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="lb-empty">暂无数据</td></tr>';
    return;
  }
  const medals = ['🥇', '🥈', '🥉'];
  tbody.innerHTML = entries.slice(0, 10).map((e, i) => `
    <tr class="${['lb-gold','lb-silver','lb-bronze'][i] || ''}">
      <td>${medals[i] || (i + 1)}</td>
      <td class="lb-name" title="${e.name}（${e.games}场）">${e.name}</td>
      <td>${e.winRate}%</td>
      <td>${e.avgPts}</td>
      <td class="lb-score">${e.score}</td>
    </tr>
  `).join('');
}

$('btn-refresh-lb').addEventListener('click', () => socket.emit('get-leaderboard'));

socket.on('reconnected', ({ roomId }) => {
  myRoomId = roomId;
  toast('✅ 重连成功！');
  // 等待 game-state / lobby-state 事件自动切换界面
});

socket.on('reconnect-failed', ({ reason }) => {
  clearSavedGame();
  toast(`重连失败：${reason}`);
  showScreen('lobby');
});

// ─── 音量控制 ────────────────────────────────────────────────
$('btn-vol').addEventListener('click', () => {
  $('vol-sliders').classList.toggle('hidden');
});

$('vol-master').addEventListener('input', e => SoundEngine.setMaster(+e.target.value));
$('vol-sfx').addEventListener('input',    e => SoundEngine.setSfx(+e.target.value));
$('vol-bgm').addEventListener('input',    e => SoundEngine.setBgm(+e.target.value));

// 首次用户交互后启动 BGM（浏览器自动播放限制）
let bgmStarted = false;
document.addEventListener('click', () => {
  if (!bgmStarted) {
    bgmStarted = true;
    SoundEngine.startBgm();
  }
}, { once: false, capture: true });
