/**
 * 2026-03-19: 吹牛骰（Liar's Dice）核心逻辑
 */

let _nextId = 1;
function uid() { return 'p' + (_nextId++); }

class DiceGame {
  constructor(settings = {}) {
    this.players = [];
    this.settings = {
      diceCount:  5,
      maxPlayers: 8,
      beerMode:   false,
      exactPenalty: false,  // 精准开骰：恰好等于叫价时，除叫价者外全体算输
      ...settings,
    };
    this.status = 'waiting'; // waiting | playing | roundEnd | finished
    this.currentIdx = 0;
    this.currentBid = null;   // { playerId, playerName, quantity, face }
    this.wildOnes = true;     // 1 当万能（有人叫 1 时变 false）
    this.roundLog = [];
    this.lastResult = null;
    this.eventLog = [];
  }

  get currentPlayer() {
    return this.players[this.currentIdx];
  }

  get activePlayers() {
    return this.players.filter(p => !p.eliminated);
  }

  addPlayer(id, name) {
    if (this.players.length >= this.settings.maxPlayers) return null;
    if (this.status !== 'waiting') return null;
    if (this.players.find(p => p.id === id)) return null;
    const player = {
      id,
      name: (name || `玩家${this.players.length + 1}`).substring(0, 20),
      dice: [],
      diceCount: this.settings.diceCount,
      eliminated: false,
      ready: false,
      wins: 0,
      beerLevel: 0,         // 啤酒肚等级 0-10
      roundsSinceLoss: 0,   // 连续未输轮数，满 3 则 beerLevel-1
    };
    this.players.push(player);
    return player;
  }

  removePlayer(id) {
    const idx = this.players.findIndex(p => p.id === id);
    if (idx === -1) return false;
    this.players.splice(idx, 1);
    if (this.status === 'playing' && this.activePlayers.length < 2) {
      this.status = 'finished';
    }
    return true;
  }

  setReady(id) {
    const p = this.players.find(p => p.id === id);
    if (p) p.ready = !p.ready;
  }

  canStart() {
    return this.activePlayers.length >= 2 && this.players.every(p => p.ready);
  }

  // ── 摇骰子，开始新一轮 ────────────────────────────────────
  startRound() {
    if (this.activePlayers.length < 2) return false;
    this.status = 'playing';
    this.currentBid = null;
    this.wildOnes = true;
    this.roundLog = [];
    for (const p of this.activePlayers) {
      p.dice = [];
      for (let i = 0; i < p.diceCount; i++) {
        p.dice.push(Math.floor(Math.random() * 6) + 1);
      }
      p.dice.sort((a, b) => a - b);
    }
    return true;
  }

  start() {
    if (!this.canStart()) return false;
    this.currentIdx = 0;
    while (this.players[this.currentIdx]?.eliminated) {
      this.currentIdx = (this.currentIdx + 1) % this.players.length;
    }
    return this.startRound();
  }

  // ── 叫价验证（必须比上一个高）────────────────────────────
  isValidBid(quantity, face) {
    if (!Number.isInteger(quantity) || !Number.isInteger(face)) return false;
    if (quantity < 1 || face < 1 || face > 6) return false;
    if (!this.currentBid) return true;
    const prev = this.currentBid;
    if (quantity > prev.quantity) return true;
    if (quantity === prev.quantity && face > prev.face) return true;
    return false;
  }

  // ── 叫价 ──────────────────────────────────────────────────
  makeBid(playerId, quantity, face) {
    if (this.status !== 'playing') return { ok: false, reason: 'not_playing' };
    if (this.currentPlayer.id !== playerId) return { ok: false, reason: 'not_your_turn' };
    if (!this.isValidBid(quantity, face)) return { ok: false, reason: 'invalid_bid' };

    // 只看第一个叫价：开轮首叫 1（叫斋）→ 整轮 1 不万能；否则 1 整轮万能
    if (!this.currentBid) {
      this.wildOnes = (face !== 1);
    }

    this.currentBid = {
      playerId,
      playerName: this.currentPlayer.name,
      quantity,
      face,
    };
    this.roundLog.push({ ...this.currentBid, ts: Date.now() });
    this._advance();
    return { ok: true };
  }

  // ── 开骰（质疑） ─────────────────────────────────────────
  challenge(playerId) {
    if (this.status !== 'playing') return { ok: false, reason: 'not_playing' };
    if (this.currentPlayer.id !== playerId) return { ok: false, reason: 'not_your_turn' };
    if (!this.currentBid) return { ok: false, reason: 'no_bid' };

    const bid = this.currentBid;
    const challenger = this.currentPlayer;
    const bidder = this.players.find(p => p.id === bid.playerId);

    // 顺子检测：玩家所有骰子互不重复 → 该玩家骰子全部不计入
    const straights = [];
    const counts = {};
    for (const p of this.activePlayers) {
      const unique = new Set(p.dice).size === p.dice.length;
      if (unique && p.dice.length > 1) {
        straights.push(p.id);
      } else {
        for (const d of p.dice) {
          counts[d] = (counts[d] || 0) + 1;
        }
      }
    }

    let actualCount;
    if (this.wildOnes && bid.face !== 1) {
      actualCount = (counts[bid.face] || 0) + (counts[1] || 0);
    } else {
      actualCount = (counts[bid.face] || 0);
    }

    // 实际 >= 叫价 → 叫价者赢（开的人猜错），否则叫价者吹牛被抓
    const bidderWins = actualCount >= bid.quantity;
    // 精准开骰：恰好等于叫价 → 叫价者独赢，其余全部算输
    const isExact = this.settings.exactPenalty && actualCount === bid.quantity;

    let losers = [];  // 可能多人输
    let winner, loser;

    if (isExact) {
      winner = bidder;
      losers = this.activePlayers.filter(p => p.id !== bidder.id);
      loser = challenger; // 主输家仍是开骰的人（下轮由他先叫）
    } else {
      loser  = bidderWins ? challenger : bidder;
      winner = bidderWins ? bidder : challenger;
      losers = [loser];
    }

    // 啤酒模式：输家喝酒肚子变大，赢家累计未输轮数（满3缩小1级）
    if (this.settings.beerMode) {
      for (const lo of losers) {
        lo.beerLevel = Math.min(10, lo.beerLevel + 1);
        lo.roundsSinceLoss = 0;
      }
      for (const p of this.activePlayers) {
        if (losers.some(lo => lo.id === p.id)) continue;
        p.roundsSinceLoss++;
        if (p.roundsSinceLoss >= 3) {
          p.beerLevel = Math.max(0, p.beerLevel - 1);
          p.roundsSinceLoss = 0;
        }
      }
    }

    const result = {
      ok: true,
      challengerId: challenger.id,
      challengerName: challenger.name,
      bidderId: bidder.id,
      bidderName: bidder.name,
      bid: { quantity: bid.quantity, face: bid.face },
      actualCount,
      wildOnes: this.wildOnes,
      straights,
      bidderWins,
      isExact,
      winnerId: winner.id,
      winnerName: winner.name,
      loserId: loser.id,
      loserName: loser.name,
      loserNames: losers.map(l => l.name),
      allDice: this.activePlayers.map(p => ({
        id: p.id, name: p.name, dice: [...p.dice],
        isStraight: straights.includes(p.id),
      })),
    };

    this.lastResult = result;
    this.eventLog.push({ type: 'challenge', ...result, ts: Date.now() });

    this.status = 'roundEnd';
    this.currentIdx = this.players.indexOf(loser);

    return result;
  }

  _advance() {
    const n = this.players.length;
    let next = this.currentIdx;
    for (let i = 0; i < n; i++) {
      next = (next + 1) % n;
      if (!this.players[next].eliminated) {
        this.currentIdx = next;
        return;
      }
    }
  }

  getStateFor(playerId) {
    const isActive = this.status === 'playing' || this.status === 'roundEnd';
    return {
      status:          this.status,
      currentPlayerId: this.currentPlayer?.id,
      currentBid:      this.currentBid,
      wildOnes:        this.wildOnes,
      roundLog:        this.roundLog,
      lastResult:      this.lastResult,
      settings:        this.settings,
      players: this.players.map(p => ({
        id:         p.id,
        name:       p.name,
        diceCount:  p.diceCount,
        eliminated: p.eliminated,
        ready:      p.ready,
        wins:       p.wins,
        beerLevel:  p.beerLevel,
        dice:       (p.id === playerId && isActive) ? p.dice : null,
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
        id: p.id, name: p.name, ready: p.ready,
        diceCount: p.diceCount, eliminated: p.eliminated, wins: p.wins,
      })),
    };
  }

  restart() {
    for (const p of this.players) {
      p.diceCount = this.settings.diceCount;
      p.eliminated = false;
      p.dice = [];
      p.ready = false;
    }
    this.status = 'waiting';
    this.currentBid = null;
    this.wildOnes = true;
    this.roundLog = [];
    this.lastResult = null;
  }
}

module.exports = { DiceGame };
