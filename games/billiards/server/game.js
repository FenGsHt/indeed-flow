/**
 * Billiards game state manager (server-side, no physics).
 * Physics runs on the client; server tracks rule state.
 */

// Ball types
const TYPE = { SOLID: 'solid', STRIPE: 'stripe', EIGHT: 'eight', CUE: 'cue' };

function ballType(num) {
  if (num === 0) return TYPE.CUE;
  if (num === 8) return TYPE.EIGHT;
  return num <= 7 ? TYPE.SOLID : TYPE.STRIPE;
}

const DEFAULT_OPTIONS = {
  gameType: '8ball',   // Future: '9ball', 'straight'
  timeLimit: 0,        // Future: seconds per shot (0 = unlimited)
  ballInHand: 'full',  // Future: 'kitchen' (behind head string) | 'full'
};

class BilliardsGame {
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.players = [];       // [{ id, name, socketId, type, score, ready, disconnected }]
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

  addPlayer(name, socketId) {
    if (this.players.length >= 2) return false;
    this.players.push({ name, socketId, type: null, score: 0, ready: false, disconnected: false });
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
    return this.players.length === 2 && this.players.every(p => p.ready);
  }

  start() {
    this.status = 'playing';
    this.currentTurn = 0;
    this.phase = 'aiming';
    this.pocketed = [];
    this.shotCount = 0;
    this.breakDone = false;
    this.players.forEach(p => { p.type = null; });
    // Ball positions are initialized client-side from the standard rack
  }

  // Called with shooter's shot result after simulation ends
  applyShot({ pocketed, scratch, ballPositions, shooterSocketId }) {
    const shooterIdx = this.players.findIndex(p => p.socketId === shooterSocketId);
    if (shooterIdx !== this.currentTurn) return null;
    if (this.phase !== 'simulating') return null;

    this.shotCount++;
    this.breakDone = true;
    if (ballPositions) this.ballPositions = ballPositions;

    const shooter = this.players[this.currentTurn];
    const opponent = this.players[1 - this.currentTurn];

    // Record newly pocketed balls
    const newlyPocketed = [];
    pocketed.forEach(num => {
      if (num !== 0 && !this.pocketed.includes(num)) {
        this.pocketed.push(num);
        newlyPocketed.push(num);
      }
    });

    // === Assign ball types on first legal pocket ===
    if (!shooter.type) {
      const firstLegal = newlyPocketed.find(n => n !== 8);
      if (firstLegal) {
        shooter.type = ballType(firstLegal);
        opponent.type = shooter.type === TYPE.SOLID ? TYPE.STRIPE : TYPE.SOLID;
      }
    }

    // === Detect fouls ===
    let foul = false;

    // Scratch (cue ball pocketed)
    if (scratch) {
      foul = true;
    }

    // === 8-ball logic ===
    if (newlyPocketed.includes(8)) {
      if (scratch) {
        // Scratch on 8 = automatic loss
        return this._endGame(1 - this.currentTurn, 'scratch_on_eight');
      }
      const shootersDone = shooter.type
        ? this.pocketed.filter(n => ballType(n) === shooter.type).length >= 7
        : false;
      if (shootersDone) {
        return this._endGame(this.currentTurn, 'win');
      } else {
        // Early 8-ball = loss
        return this._endGame(1 - this.currentTurn, 'early_eight');
      }
    }

    // === Turn continuation ===
    let keepTurn = false;
    if (!foul && shooter.type) {
      keepTurn = newlyPocketed.some(n => ballType(n) === shooter.type);
    } else if (!foul && !shooter.type) {
      keepTurn = newlyPocketed.some(n => n !== 8);
    }

    if (scratch) {
      this.phase = 'placing_cue';
      // Turn passes to opponent after cue placement
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

  placeCueBall(socketId, pos) {
    if (this.phase !== 'placing_cue') return false;
    // Opponent of the one who scratched places the cue ball
    const idx = this.players.findIndex(p => p.socketId === socketId);
    if (idx === this.currentTurn) return false; // scratching player can't place
    this.ballPositions[0] = pos;
    this.phase = 'aiming';
    this.currentTurn = 1 - this.currentTurn; // turn passes to who placed
    return true;
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
    const p0 = this.players[0];
    const p1 = this.players[1];
    // Swap who breaks
    if (p0 && p1) {
      [this.players[0], this.players[1]] = [p1, p0];
    }
    this.status = 'waiting';
    this.phase = 'aiming';
    this.pocketed = [];
    this.ballPositions = {};
    this.winner = null;
    this.shotCount = 0;
    this.breakDone = false;
    this.players.forEach(p => { p.type = null; p.ready = false; });
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
      players: this.players.map(p => ({
        name: p.name,
        socketId: p.socketId,
        type: p.type,
        score: p.score,
        ready: p.ready,
        disconnected: p.disconnected,
      })),
    };
  }
}

module.exports = { BilliardsGame };
