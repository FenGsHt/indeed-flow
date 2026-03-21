/**
 * Billiards game state manager (server-side, no physics).
 * Physics runs on the client; server tracks rule state.
 * 2026-03-19: 新增三人分区八球制（mode: '3player'）
 *   - Player 0: 球 1-5，Player 1: 球 6,7,9,10，Player 2: 球 11-15
 *   - 8号球为终结球：清空本组后打进8号球即获胜
 *   - 提前打进8号球 = 该玩家输，对局结束
 */

// Ball types (used in 2-player mode)
const TYPE = { SOLID: 'solid', STRIPE: 'stripe', EIGHT: 'eight', CUE: 'cue' };

// 三人模式分组常量
const GROUPS_3P = [
  [1, 2, 3, 4, 5],        // 玩家0
  [6, 7, 9, 10],          // 玩家1（8号球单独作为终结球）
  [11, 12, 13, 14, 15],   // 玩家2
];
// 三人模式每个玩家对应的颜色标识（传给客户端）
const GROUP_COLORS_3P = ['#f5c518', '#64b5f6', '#81c784'];

function ballType(num) {
  if (num === 0) return TYPE.CUE;
  if (num === 8) return TYPE.EIGHT;
  return num <= 7 ? TYPE.SOLID : TYPE.STRIPE;
}

// 三人模式：判断球属于哪组（-1=8号球或母球）
function getGroupOf3P(ballNum) {
  if (ballNum >= 1 && ballNum <= 5) return 0;
  if (ballNum === 6 || ballNum === 7 || ballNum === 9 || ballNum === 10) return 1;
  if (ballNum >= 11 && ballNum <= 15) return 2;
  return -1;
}

const DEFAULT_OPTIONS = {
  gameType: '8ball',
  mode: '2player',   // '2player' | '3player'
  timeLimit: 0,
  ballInHand: 'full',
};

class BilliardsGame {
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.maxPlayers = this.options.mode === '3player' ? 3 : 2;
    this.players = [];       // [{ id, name, socketId, type, score, ready, disconnected, group }]
    this.status = 'waiting'; // waiting | playing | finished
    this.currentTurn = 0;    // player index
    this.phase = 'aiming';   // aiming | simulating | placing_cue
    this.pocketed = [];      // ball numbers pocketed this game
    this.ballPositions = {}; // num -> {x, y}, updated after each shot
    this.winner = null;
    this.shotCount = 0;
    this.breakDone = false;
    this.readyTimestamp = null;
  }

  is3Player() { return this.options.mode === '3player'; }

  addPlayer(name, socketId) {
    if (this.players.length >= this.maxPlayers) return false;
    this.players.push({ name, socketId, type: null, score: 0, ready: false, disconnected: false, group: null });
    return true;
  }

  removePlayer(socketId) {
    const idx = this.players.findIndex(p => p.socketId === socketId);
    if (idx === -1) return null;
    const player = this.players[idx];
    this.players.splice(idx, 1);
    return player;
  }

  setReady(socketId, ready) {
    const p = this.players.find(p => p.socketId === socketId);
    if (p) p.ready = ready;
    return this.players.length === this.maxPlayers && this.players.every(p => p.ready);
  }

  start() {
    this.status = 'playing';
    this.currentTurn = 0;
    this.phase = 'aiming';
    this.pocketed = [];
    this.shotCount = 0;
    this.breakDone = false;
    this.players.forEach((p, i) => {
      p.type = null;
      // 三人模式预分配球组
      p.group = this.is3Player() ? (GROUPS_3P[i] || []) : null;
    });
  }

  // 三人模式：获取某玩家已打进的本组球
  getPocketedForPlayer3P(playerIdx) {
    const group = GROUPS_3P[playerIdx] || [];
    return this.pocketed.filter(n => group.includes(n));
  }

  // 三人模式：判断某玩家是否已清空本组
  isGroupCleared3P(playerIdx) {
    const group = GROUPS_3P[playerIdx] || [];
    return group.length > 0 && group.every(n => this.pocketed.includes(n));
  }

  // Called with shooter's shot result after simulation ends
  applyShot({ pocketed, scratch, ballPositions, shooterSocketId }) {
    const shooterIdx = this.players.findIndex(p => p.socketId === shooterSocketId);
    if (shooterIdx !== this.currentTurn) return null;
    if (this.phase !== 'simulating') return null;

    this.shotCount++;
    this.breakDone = true;
    if (ballPositions) this.ballPositions = ballPositions;

    // 记录新入袋球
    const newlyPocketed = [];
    pocketed.forEach(num => {
      if (num !== 0 && !this.pocketed.includes(num)) {
        this.pocketed.push(num);
        newlyPocketed.push(num);
      }
    });

    if (this.is3Player()) {
      return this._applyShot3P(shooterIdx, newlyPocketed, scratch);
    } else {
      return this._applyShot2P(shooterIdx, newlyPocketed, scratch);
    }
  }

  // ── 原2人逻辑（保持不变）─────────────────────────────────────────────────
  _applyShot2P(shooterIdx, newlyPocketed, scratch) {
    const shooter = this.players[shooterIdx];
    const opponent = this.players[1 - shooterIdx];
    let foul = scratch;

    // 首次合法入袋时分配球型
    if (!shooter.type) {
      const firstLegal = newlyPocketed.find(n => n !== 8);
      if (firstLegal) {
        shooter.type = ballType(firstLegal);
        opponent.type = shooter.type === TYPE.SOLID ? TYPE.STRIPE : TYPE.SOLID;
      }
    }

    // 8号球判定
    if (newlyPocketed.includes(8)) {
      if (scratch) return this._endGame(1 - shooterIdx, 'scratch_on_eight');
      const shootersDone = shooter.type
        ? this.pocketed.filter(n => ballType(n) === shooter.type).length >= 7
        : false;
      if (shootersDone) return this._endGame(shooterIdx, 'win');
      else return this._endGame(1 - shooterIdx, 'early_eight');
    }

    let keepTurn = false;
    if (!foul && shooter.type) {
      keepTurn = newlyPocketed.some(n => ballType(n) === shooter.type);
    } else if (!foul && !shooter.type) {
      keepTurn = newlyPocketed.some(n => n !== 8);
    }

    if (scratch) {
      this.phase = 'placing_cue';
    } else {
      this.phase = 'aiming';
      if (!keepTurn) this.currentTurn = 1 - this.currentTurn;
    }

    return {
      type: 'continue',
      foul,
      keepTurn: !scratch && keepTurn,
      newlyPocketed,
      shooterType: shooter.type,
      opponentType: opponent.type,
      nextTurn: this.currentTurn,
      phase: this.phase,
    };
  }

  // ── 三人分区八球制逻辑 ─────────────────────────────────────────────────────
  _applyShot3P(shooterIdx, newlyPocketed, scratch) {
    let foul = scratch;
    const groupCleared = this.isGroupCleared3P(shooterIdx);

    // 8号球判定
    if (newlyPocketed.includes(8)) {
      if (scratch) {
        // 打进8号球同时犯规 = 该玩家输
        return this._endGame3P(shooterIdx, 'scratch_on_eight', false);
      }
      if (groupCleared) {
        // 已清空本组，打进8号球 = 获胜
        return this._endGame3P(shooterIdx, 'win', true);
      } else {
        // 提前打进8号球 = 该玩家输
        return this._endGame3P(shooterIdx, 'early_eight', false);
      }
    }

    // 本轮打进了本组的球 → 继续回合
    const myNewBalls = newlyPocketed.filter(n => getGroupOf3P(n) === shooterIdx);
    const keepTurn = !foul && myNewBalls.length > 0;

    if (scratch) {
      // 犯规：推进到下一玩家，由下一玩家放置母球
      this.phase = 'placing_cue';
      this.currentTurn = (this.currentTurn + 1) % this.players.length;
    } else {
      this.phase = 'aiming';
      if (!keepTurn) this.currentTurn = (this.currentTurn + 1) % this.players.length;
    }

    return {
      type: 'continue',
      foul,
      keepTurn: !scratch && keepTurn,
      newlyPocketed,
      nextTurn: this.currentTurn,
      phase: this.phase,
    };
  }

  // 三人模式结束游戏
  // isWin=true: protagonistIdx 获胜；isWin=false: protagonistIdx 失败（其余人中进度最多者胜）
  _endGame3P(protagonistIdx, reason, isWin) {
    this.status = 'finished';
    let winnerIdx;
    if (isWin) {
      winnerIdx = protagonistIdx;
    } else {
      // 提前打进8号球/犯规 → 其余玩家中打进本组球最多的胜
      let bestProgress = -1;
      winnerIdx = -1;
      this.players.forEach((p, i) => {
        if (i === protagonistIdx) return;
        const progress = this.getPocketedForPlayer3P(i).length;
        if (progress > bestProgress) { bestProgress = progress; winnerIdx = i; }
      });
      // 兜底：下一位玩家
      if (winnerIdx === -1) winnerIdx = (protagonistIdx + 1) % this.players.length;
    }
    this.winner = winnerIdx;
    if (this.players[winnerIdx]) this.players[winnerIdx].score++;
    return {
      type: 'game_over',
      winner: winnerIdx,
      winnerName: this.players[winnerIdx]?.name,
      loserName: this.players[protagonistIdx]?.name,
      reason,
    };
  }

  placeCueBall(socketId, pos) {
    if (this.phase !== 'placing_cue') return false;
    const idx = this.players.findIndex(p => p.socketId === socketId);

    if (this.is3Player()) {
      // 三人模式：currentTurn 已推进到拥有球权的玩家，由该玩家放球
      if (idx !== this.currentTurn) return false;
      this.ballPositions[0] = pos;
      this.phase = 'aiming';
      return true;
    } else {
      // 二人模式：犯规方对手放球，放完后轮到放球者
      if (idx === this.currentTurn) return false;
      this.ballPositions[0] = pos;
      this.phase = 'aiming';
      this.currentTurn = 1 - this.currentTurn;
      return true;
    }
  }

  setPhase(phase) {
    this.phase = phase;
  }

  _endGame(winnerIdx, reason) {
    this.status = 'finished';
    this.winner = winnerIdx;
    const winner = this.players[winnerIdx];
    const loser = this.players[1 - winnerIdx];
    if (winner) winner.score++;
    return {
      type: 'game_over',
      winner: winnerIdx,
      winnerName: winner?.name,
      loserName: loser?.name,
      reason,
    };
  }

  resetForRematch() {
    const first = this.players.shift();
    if (first) this.players.push(first); // 轮换开球顺序
    this.status = 'waiting';
    this.phase = 'aiming';
    this.pocketed = [];
    this.ballPositions = {};
    this.winner = null;
    this.shotCount = 0;
    this.breakDone = false;
    this.players.forEach(p => { p.type = null; p.ready = false; p.group = null; });
  }

  getState() {
    return {
      status: this.status,
      phase: this.phase,
      currentTurn: this.currentTurn,
      winner: this.winner,
      pocketed: this.pocketed,
      ballPositions: this.ballPositions,
      options: this.options,
      maxPlayers: this.maxPlayers,
      groupColors: this.is3Player() ? GROUP_COLORS_3P : null,
      players: this.players.map((p, i) => ({
        name: p.name,
        socketId: p.socketId,
        type: p.type,
        score: p.score,
        ready: p.ready,
        disconnected: p.disconnected,
        group: this.is3Player() ? (GROUPS_3P[i] || []) : null,
      })),
    };
  }
}

module.exports = { BilliardsGame, GROUPS_3P };
