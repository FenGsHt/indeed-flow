/**
 * 2026-03-19: 吹牛骰 Socket.IO 服务（公共大厅模式）
 * - 无房间概念，所有人进入同一个大厅
 * - 准备后开始，结束后回大厅
 * - 结果上报 Flask API 记录积分
 */
const http = require('http');
const { Server } = require('socket.io');
const { DiceGame } = require('./game');

const server = http.createServer();
const io = new Server(server, { cors: { origin: '*' } });

const FLASK_URL = process.env.FLASK_URL || 'http://127.0.0.1:5001';

// ── 大厅状态 ─────────────────────────────────────────
const lobby = {
  players: new Map(),   // socketId → { id, name, ready, inGame }
  game: null,           // 当前进行中的 DiceGame
  gamePlayerIds: [],    // 本局参与的 socketId 列表
};

function lobbyState() {
  const players = [];
  for (const [sid, p] of lobby.players) {
    players.push({
      id: sid,
      name: p.name,
      ready: p.ready,
      inGame: p.inGame,
    });
  }
  const readyCount = players.filter(p => p.ready && !p.inGame).length;
  return {
    players,
    canStart: readyCount >= 2,
    gameInProgress: !!lobby.game,
  };
}

function broadcastLobby() {
  io.emit('lobby-update', lobbyState());
}

function broadcastGameState() {
  if (!lobby.game) return;
  for (const sid of lobby.gamePlayerIds) {
    const s = io.sockets.sockets.get(sid);
    if (s) s.emit('game-state', lobby.game.getStateFor(sid));
  }
}

async function reportResult(winnerName, loserNames) {
  try {
    const body = JSON.stringify({ winner: winnerName, losers: loserNames });
    const resp = await fetch(`${FLASK_URL}/api/dice/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    const data = await resp.json();
    if (!data.ok) console.error('[dice] report result error:', data);
  } catch (e) {
    console.error('[dice] report result fetch error:', e.message);
  }
}

// ── Socket 事件 ──────────────────────────────────────
io.on('connection', (socket) => {
  const sid = socket.id;

  socket.on('join-lobby', ({ name }) => {
    const cleanName = (name || '').trim().substring(0, 20) || '酒客';
    lobby.players.set(sid, { id: sid, name: cleanName, ready: false, inGame: false });
    socket.emit('joined', { id: sid, name: cleanName });
    broadcastLobby();
  });

  socket.on('toggle-ready', () => {
    const p = lobby.players.get(sid);
    if (!p || p.inGame) return;
    p.ready = !p.ready;
    broadcastLobby();
  });

  socket.on('update-settings', (settings) => {
    if (lobby.game) return;
    if (settings.diceCount) {
      lobby.diceCount = Math.min(10, Math.max(1, parseInt(settings.diceCount) || 5));
    }
    io.emit('settings-update', { diceCount: lobby.diceCount || 5 });
  });

  socket.on('start-game', () => {
    if (lobby.game) return socket.emit('error-msg', '已有游戏进行中');

    const readyPlayers = [];
    for (const [sid, p] of lobby.players) {
      if (p.ready && !p.inGame) readyPlayers.push(sid);
    }
    if (readyPlayers.length < 2) return socket.emit('error-msg', '至少需要 2 人准备');

    const game = new DiceGame({ diceCount: lobby.diceCount || 5 });
    for (const sid of readyPlayers) {
      const p = lobby.players.get(sid);
      game.addPlayer(sid, p.name);
      p.inGame = true;
    }
    lobby.game = game;
    lobby.gamePlayerIds = [...readyPlayers];

    game.start();

    for (const sid of lobby.gamePlayerIds) {
      const s = io.sockets.sockets.get(sid);
      if (s) s.emit('game-started');
    }
    broadcastGameState();
    broadcastLobby();
  });

  socket.on('make-bid', ({ quantity, face }) => {
    if (!lobby.game) return;
    const r = lobby.game.makeBid(sid, parseInt(quantity), parseInt(face));
    if (!r.ok) return socket.emit('error-msg', r.reason);

    const p = lobby.players.get(sid);
    for (const s of lobby.gamePlayerIds) {
      const sock = io.sockets.sockets.get(s);
      if (sock) sock.emit('bid-made', {
        playerId: sid, playerName: p?.name,
        quantity, face, wildOnes: lobby.game.wildOnes,
      });
    }
    broadcastGameState();
  });

  socket.on('challenge', () => {
    if (!lobby.game) return;
    const r = lobby.game.challenge(sid);
    if (!r.ok) return socket.emit('error-msg', r.reason);

    for (const s of lobby.gamePlayerIds) {
      const sock = io.sockets.sockets.get(s);
      if (sock) sock.emit('challenge-result', r);
    }

    // 每轮结束即上报：赢家 +100，输家 -50
    if (r.winnerName && r.loserName) {
      reportResult(r.winnerName, [r.loserName]);
    }

    setTimeout(() => broadcastGameState(), 100);
  });

  socket.on('next-round', () => {
    if (!lobby.game || lobby.game.status !== 'roundEnd') return;
    lobby.game.startRound();
    for (const s of lobby.gamePlayerIds) {
      const sock = io.sockets.sockets.get(s);
      if (sock) sock.emit('new-round');
    }
    broadcastGameState();
  });

  socket.on('back-to-lobby', () => {
    if (!lobby.game) return;
    endGame();
  });

  socket.on('disconnect', () => {
    const p = lobby.players.get(sid);
    lobby.players.delete(sid);

    if (p?.inGame && lobby.game) {
      lobby.game.removePlayer(sid);
      lobby.gamePlayerIds = lobby.gamePlayerIds.filter(s => s !== sid);

      // 只剩不到 2 人，结束游戏回大厅
      if (lobby.gamePlayerIds.length < 2) {
        for (const s of lobby.gamePlayerIds) {
          const sock = io.sockets.sockets.get(s);
          if (sock) sock.emit('player-left-game', { name: p.name });
        }
        endGame();
      } else {
        for (const s of lobby.gamePlayerIds) {
          const sock = io.sockets.sockets.get(s);
          if (sock) sock.emit('player-left-game', { name: p.name });
        }
        broadcastGameState();
      }
    }

    broadcastLobby();
    if (p) io.emit('player-left', { name: p.name });
  });

  function endGame() {
    for (const s of lobby.gamePlayerIds) {
      const pp = lobby.players.get(s);
      if (pp) { pp.inGame = false; pp.ready = false; }
    }
    lobby.game = null;
    lobby.gamePlayerIds = [];
    io.emit('game-ended');
    broadcastLobby();
  }
});

// ── 初始化默认设置 ───────────────────────────────────
lobby.diceCount = 5;

const PORT = process.env.PORT || 3005;
server.listen(PORT, () => {
  console.log(`🎲 吹牛骰服务器运行在端口 ${PORT}（公共大厅模式）`);
});
