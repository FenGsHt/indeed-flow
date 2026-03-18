'use strict';

const COLORS = ['red', 'green', 'blue', 'yellow'];

// ─────────────────────────────────────────────────────────────
// CardRegistry — 可扩展卡牌类型系统
// 注册新卡牌类型只需调用 CardRegistry.register(type, def)
// ─────────────────────────────────────────────────────────────
const CardRegistry = {
  types: new Map(),

  register(type, def) {
    this.types.set(type, {
      isWild: false,        // 万能牌（可随时出）
      requiresColor: false, // 出牌后需选色
      canStack: false,      // 支持叠加（house rule）
      canChallenge: false,  // 可被质疑（+4）
      ...def,
    });
  },

  get(type) {
    return this.types.get(type) || {};
  },

  symbol(card) {
    const def = this.get(card.type);
    return typeof def.symbol === 'function' ? def.symbol(card) : (def.symbol || '?');
  },
};

// 标准牌型注册
CardRegistry.register('number',      { symbol: c => String(c.value) });
CardRegistry.register('skip',        { symbol: () => '⊘' });
CardRegistry.register('reverse',     { symbol: () => '⇄' });
CardRegistry.register('draw2',       { symbol: () => '+2', canStack: true });
CardRegistry.register('wild',        { symbol: () => '★', isWild: true, requiresColor: true });
CardRegistry.register('wild_draw4',  { symbol: () => '+4', isWild: true, requiresColor: true, canStack: true, canChallenge: true });

// ─────────────────────────────────────────────────────────────
// 构建标准108张牌组
// ─────────────────────────────────────────────────────────────
let _id = 1;
function buildDeck() {
  const cards = [];
  for (const color of COLORS) {
    cards.push({ id: _id++, type: 'number', color, value: 0 });
    for (let v = 1; v <= 9; v++) {
      cards.push({ id: _id++, type: 'number', color, value: v });
      cards.push({ id: _id++, type: 'number', color, value: v });
    }
    for (const type of ['skip', 'reverse', 'draw2']) {
      cards.push({ id: _id++, type, color, value: null });
      cards.push({ id: _id++, type, color, value: null });
    }
  }
  for (let i = 0; i < 4; i++) {
    cards.push({ id: _id++, type: 'wild',       color: 'wild', value: null });
    cards.push({ id: _id++, type: 'wild_draw4', color: 'wild', value: null });
  }
  return shuffle(cards);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─────────────────────────────────────────────────────────────
// UnoGame — 主游戏逻辑
// ─────────────────────────────────────────────────────────────
class UnoGame {
  constructor(settings = {}) {
    this.deck = [];
    this.discardPile = [];
    this.players = [];   // { id, name, hand[], saidUno, ready, score }
    this.currentIdx = 0;
    this.direction = 1;  // 1=顺时针 -1=逆时针
    this.currentColor = null;
    this.pendingDraw = 0;
    this.drawnThisTurn = false; // 本回合已摸过1张牌
    this.status = 'waiting'; // waiting | playing | finished
    this.winner = null;
    this.roundCount = 0;
    this.settings = {
      stackDraw:  true,   // 叠加 +2/+4
      sevensZero: false,  // 7换牌/0传递
      forcePlay:  true,   // 摸到的牌若能出必须出
      ...settings,
    };
    this.eventLog = [];
  }

  // ── 玩家管理 ──────────────────────────────
  addPlayer(id, name) {
    if (this.status !== 'waiting') return false;
    if (this.players.find(p => p.id === id)) return false;
    if (this.players.length >= 10) return false;
    this.players.push({ id, name, hand: [], saidUno: false, ready: false, score: 0, connected: true });
    return true;
  }

  removePlayer(id) {
    const idx = this.players.findIndex(p => p.id === id);
    if (idx === -1) return;
    if (this.status === 'playing') this.deck.push(...this.players[idx].hand);
    this.players.splice(idx, 1);
    if (this.players.length > 0 && this.currentIdx >= this.players.length) {
      this.currentIdx = 0;
    }
  }

  // 标记断线（保留手牌，等待重连）
  disconnectPlayer(id) {
    const p = this.players.find(p => p.id === id);
    if (!p) return null;
    p.connected = false;
    // 若轮到断线玩家，自动跳过
    if (this.status === 'playing' && this.currentPlayer?.id === id) {
      this.drawnThisTurn = false;
      this._advance();
    }
    return p.name;
  }

  // 重连：按名字找回玩家，更新 socket id
  reconnectPlayer(name, newId) {
    const p = this.players.find(p => p.name === name && !p.connected);
    if (!p) return false;
    p.id   = newId;
    p.connected = true;
    return true;
  }

  // 按名字移除（宽限期结束时用）
  removePlayerByName(name) {
    const idx = this.players.findIndex(p => p.name === name);
    if (idx === -1) return;
    if (this.status === 'playing') this.deck.push(...this.players[idx].hand);
    this.players.splice(idx, 1);
    if (this.players.length > 0 && this.currentIdx >= this.players.length) {
      this.currentIdx = 0;
    }
  }

  setReady(id, ready) {
    const p = this.players.find(p => p.id === id);
    if (p) p.ready = ready;
  }

  canStart() {
    return this.players.length >= 2 && this.players.every(p => p.ready);
  }

  // ── 开始游戏 ─────────────────────────────
  start() {
    this.deck = buildDeck();
    this.discardPile = [];
    this.direction = 1;
    this.pendingDraw = 0;
    this.currentIdx = 0;
    this.winner = null;
    this.roundCount++;

    for (const p of this.players) {
      p.hand = this.deck.splice(0, 7);
      p.saidUno = false;
      p.ready = false;
    }

    // 翻开第一张：跳过万能牌
    let first;
    do {
      first = this.deck.shift();
      if (first.color === 'wild') this.deck.push(first);
    } while (first.color === 'wild');

    this.discardPile.push(first);
    this.currentColor = first.color;
    this.status = 'playing';
    this._applyEffect(first, null);
    return true;
  }

  // ── 属性 ─────────────────────────────────
  get topCard()       { return this.discardPile[this.discardPile.length - 1]; }
  get currentPlayer() { return this.players[this.currentIdx]; }

  // ── 判断是否可出牌 ────────────────────────
  canPlay(card) {
    if (this.status !== 'playing') return false;
    const def = CardRegistry.get(card.type);
    const top = this.topCard;

    if (this.pendingDraw > 0) {
      if (!this.settings.stackDraw) return false;
      return def.canStack && card.type === top.type;
    }

    if (def.isWild) return true;
    if (card.color === this.currentColor) return true;
    if (card.type !== 'number' && card.type === top.type) return true;
    if (card.type === 'number' && top.type === 'number' && card.value === top.value) return true;
    return false;
  }

  // ── 出牌 ─────────────────────────────────
  playCard(playerId, cardId, chosenColor = null) {
    if (this.status !== 'playing')         return { ok: false, reason: 'not_playing' };
    if (this.currentPlayer.id !== playerId) return { ok: false, reason: 'not_your_turn' };

    const player = this.currentPlayer;
    const cardIdx = player.hand.findIndex(c => c.id === cardId);
    if (cardIdx === -1) return { ok: false, reason: 'card_not_found' };

    const card = player.hand[cardIdx];
    if (!this.canPlay(card)) return { ok: false, reason: 'cannot_play' };

    const def = CardRegistry.get(card.type);
    if (def.requiresColor && !chosenColor) return { ok: false, reason: 'needs_color' };

    player.hand.splice(cardIdx, 1);
    player.saidUno = false;
    this.drawnThisTurn = false;
    this.discardPile.push(card);
    if (!def.isWild) this.currentColor = card.color;

    this.eventLog.push({
      type: 'play', playerId, playerName: player.name,
      card: { ...card }, chosenColor, ts: Date.now(),
    });

    if (player.hand.length === 0) {
      this.status = 'finished';
      this.winner = player;
      player.score = (player.score || 0) + 1;
      return { ok: true, finished: true, winner: { id: player.id, name: player.name } };
    }

    this._applyEffect(card, chosenColor);
    return { ok: true };
  }

  // ── 摸牌 ─────────────────────────────────
  drawCard(playerId) {
    if (this.status !== 'playing')         return { ok: false, reason: 'not_playing' };
    if (this.currentPlayer.id !== playerId) return { ok: false, reason: 'not_your_turn' };
    if (this.drawnThisTurn && !this.pendingDraw) return { ok: false, reason: 'already_drawn' };

    const player = this.currentPlayer;
    const count = this.pendingDraw || 1;
    this.pendingDraw = 0;

    const drawn = [];
    for (let i = 0; i < count; i++) {
      if (this.deck.length === 0) this._reshuffle();
      if (this.deck.length === 0) break;
      drawn.push(this.deck.shift());
    }
    player.hand.push(...drawn);
    this.eventLog.push({ type: 'draw', playerId, playerName: player.name, count: drawn.length, ts: Date.now() });

    if (count > 1) {
      // 惩罚摸牌，直接跳过
      this._advance();
      return { ok: true, drawn, advanced: true };
    }

    // 自愿摸1张：留在本回合，玩家可出牌或手动结束回合
    this.drawnThisTurn = true;
    const canPlay = drawn.length > 0 && this.canPlay(drawn[0]);
    return { ok: true, drawn, canPlay };
  }

  // ── UNO 喊叫 / 抓人 ──────────────────────
  sayUno(playerId) {
    const p = this.players.find(p => p.id === playerId);
    if (p && p.hand.length === 1) { p.saidUno = true; return true; }
    return false;
  }

  // ── 结束回合（摸牌后手动跳过）────────────
  passTurn(playerId) {
    if (this.status !== 'playing') return false;
    if (this.currentPlayer.id !== playerId) return false;
    if (!this.drawnThisTurn) return false; // 必须先摸过牌
    this._advance();
    return true;
  }

  catchUno(catcherId, targetId) {
    const target = this.players.find(p => p.id === targetId);
    if (!target || target.hand.length !== 1 || target.saidUno) return false;
    for (let i = 0; i < 2; i++) {
      if (this.deck.length === 0) this._reshuffle();
      if (this.deck.length > 0) target.hand.push(this.deck.shift());
    }
    this.eventLog.push({ type: 'catch_uno', catcherId, targetId, ts: Date.now() });
    return true;
  }

  // ── 私有方法 ─────────────────────────────
  _applyEffect(card, chosenColor) {
    switch (card.type) {
      case 'reverse':
        this.direction *= -1;
        // 双人时 reverse = skip
        this._advance();
        if (this.players.length === 2) this._advance();
        break;
      case 'skip':
        this._advance(); this._advance();
        break;
      case 'draw2':
        this.pendingDraw += 2;
        this._advance();
        if (!this.settings.stackDraw) this._advance(); // 传统规则跳过
        break;
      case 'wild':
        this.currentColor = chosenColor;
        this._advance();
        break;
      case 'wild_draw4':
        this.currentColor = chosenColor;
        this.pendingDraw += 4;
        this._advance();
        if (!this.settings.stackDraw) this._advance();
        break;
      default:
        if (this.settings.sevensZero) {
          if (card.value === 0) {
            // 所有玩家手牌轮转
            const first = this.players[0].hand;
            for (let i = 0; i < this.players.length - 1; i++) {
              this.players[i].hand = this.players[i + 1].hand;
            }
            this.players[this.players.length - 1].hand = first;
          }
        }
        this._advance();
    }
  }

  _advance() {
    this.currentIdx = (this.currentIdx + this.direction + this.players.length) % this.players.length;
    this.drawnThisTurn = false;
  }

  _reshuffle() {
    if (this.discardPile.length <= 1) return;
    const top = this.discardPile.pop();
    this.deck = shuffle(this.discardPile);
    for (const c of this.deck) {
      if (c.type.startsWith('wild')) c.chosenColor = null;
    }
    this.discardPile = [top];
  }

  // ── 状态序列化 ───────────────────────────
  getStateFor(playerId) {
    return {
      status:          this.status,
      currentColor:    this.currentColor,
      currentPlayerId: this.currentPlayer?.id,
      topCard:         this.topCard || null,
      pendingDraw:     this.pendingDraw,
      drawnThisTurn:   this.currentPlayer?.id === playerId ? this.drawnThisTurn : false,
      direction:       this.direction,
      deckCount:       this.deck.length,
      winner:          this.winner ? { id: this.winner.id, name: this.winner.name } : null,
      settings:        this.settings,
      players: this.players.map(p => ({
        id:        p.id,
        name:      p.name,
        cardCount: p.hand.length,
        saidUno:   p.saidUno,
        ready:     p.ready,
        score:     p.score || 0,
        connected: p.connected,
        isYou:     p.id === playerId,
        hand:      p.id === playerId ? p.hand : null,
      })),
    };
  }

  getLobbyState() {
    return {
      status:      this.status,
      playerCount: this.players.length,
      canStart:    this.canStart(),
      settings:    this.settings,
      players:     this.players.map(p => ({
        id: p.id, name: p.name, ready: p.ready, score: p.score || 0,
      })),
    };
  }
}

module.exports = { UnoGame, CardRegistry, COLORS };
