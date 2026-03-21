/**
 * Billiards game state manager (server-side, no physics).
 * Physics runs on the client; server tracks rule state.
 * 2026-03-19: 新增三人分区八球制（mode: '3player'）
 *   - Player 0: 1-5，Player 1: 6,7,9,10，Player 2: 11-15，8号球为终结球
 * 2026-03-19: 新增四人分区模式（mode: '4player'）
 *   - Player 0: 1-4，Player 1: 5-8，Player 2: 9-12，Player 3: 13-15
 *   - 无特殊8号球规则，清空本组所有球即获胜
 */

const TYPE = { SOLID: 'solid', STRIPE: 'stripe', EIGHT: 'eight', CUE: 'cue' };

// 各人数模式的球组分配
const GROUPS_BY_MODE = {
  '3player': [[1,2,3,4,5],[6,7,9,10],[11,12,13,14,15]],   // 8号为终结球
  '4player': [[1,2,3,4],[5,6,7,8],[9,10,11,12],[13,14,15]], // 无特殊8号
};

const GROUP_COLORS = ['#f5c518','#64b5f6','#81c784','#ff7043'];

function ballType(num) {
  if (num === 0) return TYPE.CUE;
  if (num === 8) return TYPE.EIGHT;
  return num <= 7 ? TYPE.SOLID : TYPE.STRIPE;
}

// 通用：查找球属于哪个分区玩家（-1=不在任何组）
function getGroupOfByMode(ballNum, mode) {
  const groups = GROUPS_BY_MODE[mode] || [];
  for (let i = 0; i < groups.length; i++) {
    if (groups[i].includes(ballNum)) return i;
  }
  return -1;
}

const DEFAULT_OPTIONS = {
  gameType: '8ball',
  mode: '2player',   // '2player' | '3player' | '4player'
  timeLimit: 0,
  ballInHand: 'full',
};

class BilliardsGame {
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.maxPlayers = { '3player': 3, '4player': 4 }[this.options.mode] || 2;
    this.players = [];
    this.status = 'waiting';
    this.currentTurn = 0;
    this.phase = 'aiming';
    this.pocketed = [];
    this.ballPositions = {};
    this.winner = null;
    this.shotCount = 0;
    this.breakDone = false;
    this.readyTimestamp = null;
  }

  isPartitionMode() {
    return this.options.mode === '3player' || this.options.mode === '4player';
  }

  is3Player() { return this.options.mode === '3player'; }
  is4Player() { return this.options.mode === '4player'; }

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
    const groups = GROUPS_BY_MODE[this.options.mode] || [];
    this.players.forEach((p, i) => {
      p.type = null;
      p.group = groups[i] || null;
    });
  }

  // 通用：获取某玩家已打进的本组球
  getPocketedForPlayer(playerIdx) {
    const groups = GROUPS_BY_MODE[this.options.mode] || [];
    const group = groups[playerIdx] || [];
    return this.pocketed.filter(n => group.includes(n));
  }

  // 通用：判断某玩家是否已清空本组
  isGroupClearedForPlayer(playerIdx) {
    const groups = GROUPS_BY_MODE[this.options.mode] || [];
    const group = groups[playerIdx] || [];
    return group.length > 0 && group.every(n => this.pocketed.includes(n));
  }

  applyShot({ pocketed, scratch, ballPositions, shooterSocketId }) {
    const shooterIdx = this.players.findIndex(p => p.socketId === shooterSocketId);
    if (shooterIdx !== this.currentTurn) return null;
    if (this.phase !== 'simulating') return null;

    this.shotCount++;
    this.breakDone = true;
    if (ballPositions) this.ballPositions = ballPositions;

    const newlyPocketed = [];
    pocketed.forEach(num => {
      if (num !== 0 && !this.pocketed.includes(num)) {
        this.pocketed.push(num);
        newlyPocketed.push(num);
      }
    });

    if (this.isPartitionMode()) {
      return this._applyShotPartition(shooterIdx, newlyPocketed, scratch);
    } else {
      return this._applyShot2P(shooterIdx, newlyPocketed, scratch);
    }
  }

  // ── 原2人逻辑（保持不变）─────────────────────────────────────────────────
  _applyShot2P(shooterIdx, newlyPocketed, scratch) {
    const shooter = this.players[shooterIdx];
    const opponent = this.players[1 - shooterIdx];
    let foul = scratch;

    if (!shooter.type) {
      const firstLegal = newlyPocketed.find(n => n !== 8);
      if (firstLegal) {
        shooter.type = ballType(firstLegal);
        opponent.type = shooter.type === TYPE.SOLID ? TYPE.STRIPE : TYPE.SOLID;
      }
    }

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

  // ── 通用分区模式（3人/4人）────────────────────────────────────────────────
  _applyShotPartition(shooterIdx, newlyPocketed, scratch) {
    const mode = this.options.mode;
    const is3P = this.is3Player();
    const foul = scratch;

    // 3P 专有：8号球终结规则
    if (is3P && newlyPocketed.includes(8)) {
      if (scratch) return this._endGamePartition(shooterIdx, 'scratch_on_eight', false);
      if (this.isGroupClearedForPlayer(shooterIdx)) {
        return this._endGamePartition(shooterIdx, 'win', true);
      } else {
        return this._endGamePartition(shooterIdx, 'early_eight', false);
      }
    }

    // 4P：清空本组球立即获胜（任意一颗本组球在此回合入袋且组全清）
    if (!is3P) {
      const groups = GROUPS_BY_MODE[mode] || [];
      const myGroup = groups[shooterIdx] || [];
      const myNewBallsCheck = newlyPocketed.some(n => myGroup.includes(n));
      if (myNewBallsCheck && this.isGroupClearedForPlayer(shooterIdx)) {
        return this._endGamePartition(shooterIdx, 'win', true);
      }
    }

    // 通用：本回合打进了本组的球 → 继续
    const myNewBalls = newlyPocketed.filter(n => getGroupOfByMode(n, mode) === shooterIdx);
    const keepTurn = !foul && myNewBalls.length > 0;

    if (scratch) {
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

  // 通用分区模式结束（isWin=true: protagonist 胜；false: 其余进度最多者胜）
  _endGamePartition(protagonistIdx, reason, isWin) {
    this.status = 'finished';
    let winnerIdx;
    if (isWin) {
      winnerIdx = protagonistIdx;
    } else {
      let bestProgress = -1;
      winnerIdx = -1;
      this.players.forEach((p, i) => {
        if (i === protagonistIdx) return;
        const progress = this.getPocketedForPlayer(i).length;
        if (progress > bestProgress) { bestProgress = progress; winnerIdx = i; }
      });
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

    if (this.isPartitionMode()) {
      // 分区模式：currentTurn 已推进到拥有球权的玩家
      if (idx !== this.currentTurn) return false;
      this.ballPositions[0] = pos;
      this.phase = 'aiming';
      return true;
    } else {
      // 2人模式：犯规方对手放球，放完后轮到放球者
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
    if (first) this.players.push(first);
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
    const groups = GROUPS_BY_MODE[this.options.mode] || [];
    return {
      status: this.status,
      phase: this.phase,
      currentTurn: this.currentTurn,
      winner: this.winner,
      pocketed: this.pocketed,
      ballPositions: this.ballPositions,
      options: this.options,
      maxPlayers: this.maxPlayers,
      groupColors: this.isPartitionMode() ? GROUP_COLORS.slice(0, this.maxPlayers) : null,
      players: this.players.map((p, i) => ({
        name: p.name,
        socketId: p.socketId,
        type: p.type,
        score: p.score,
        ready: p.ready,
        disconnected: p.disconnected,
        group: groups[i] || null,
      })),
    };
  }
}

module.exports = { BilliardsGame, GROUPS_BY_MODE };
