const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const GRID        = 30;
const FOOD_COUNT  = 12;
const TICK_MS     = 150;
const RESPAWN_MS  = 3000;
const INIT_LEN    = 3;
const COLORS = [
  '#00ff88','#ff6b6b','#66c0f4','#ffd700',
  '#ff69b4','#c084fc','#ff8c00','#00d4ff',
  '#ff4da6','#4dffb4'
];

let players  = {};
let foods    = [];
let colorIdx = 0;

// ── helpers ───────────────────────────────────────────────────────

function isOccupied(x, y) {
  for (const p of Object.values(players)) {
    if (p.alive && p.snake.some(s => s.x === x && s.y === y)) return true;
  }
  if (foods.some(f => f.x === x && f.y === y)) return true;
  return false;
}

function randomFreePos() {
  let pos, tries = 0;
  do {
    pos = { x: Math.floor(Math.random() * GRID), y: Math.floor(Math.random() * GRID) };
    tries++;
  } while (isOccupied(pos.x, pos.y) && tries < 300);
  return pos;
}

function findSpawnPos() {
  let best = null, bestScore = -1;
  for (let t = 0; t < 100; t++) {
    const x = Math.floor(Math.random() * GRID);
    const y = Math.floor(Math.random() * GRID);
    let score = 0;
    for (let dx = -4; dx <= 4; dx++) {
      for (let dy = -4; dy <= 4; dy++) {
        const nx = (x + dx + GRID) % GRID;
        const ny = (y + dy + GRID) % GRID;
        if (!isOccupied(nx, ny)) score++;
      }
    }
    if (score > bestScore) { bestScore = score; best = { x, y }; }
    if (score >= 80) break;
  }
  return best || { x: Math.floor(Math.random() * GRID), y: Math.floor(Math.random() * GRID) };
}

function spawnSnake(player) {
  const pos  = findSpawnPos();
  const dirs = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
  const dir  = dirs[Math.floor(Math.random() * dirs.length)];
  const snake = [];
  for (let i = 0; i < INIT_LEN; i++) {
    snake.push({
      x: (pos.x - dir.x * i + GRID) % GRID,
      y: (pos.y - dir.y * i + GRID) % GRID,
    });
  }
  player.snake     = snake;
  player.direction = { ...dir };
  player.nextDir   = { ...dir };
  player.alive     = true;
  player.respawnAt = null;
}

function initFoods() {
  foods = [];
  for (let i = 0; i < FOOD_COUNT; i++) {
    foods.push(randomFreePos());
  }
}

// ── game tick ─────────────────────────────────────────────────────

function tick() {
  const now = Date.now();

  // 1. Move all alive snakes
  for (const p of Object.values(players)) {
    if (!p.alive) continue;
    p.direction = { ...p.nextDir };
    const h = p.snake[0];
    const nh = {
      x: (h.x + p.direction.x + GRID) % GRID,
      y: (h.y + p.direction.y + GRID) % GRID,
    };
    p.snake.unshift(nh);

    // Food?
    const fi = foods.findIndex(f => f.x === nh.x && f.y === nh.y);
    if (fi >= 0) {
      p.score += 10;
      foods.splice(fi, 1);
      foods.push(randomFreePos());
      // Don't pop tail → snake grows
    } else {
      p.snake.pop();
    }
  }

  // 2. Collect deaths simultaneously
  // deathMap: victimId -> killerId (or null for self-collision)
  const deathMap = {};

  for (const [id, p] of Object.entries(players)) {
    if (!p.alive) continue;
    const head = p.snake[0];
    for (const [oid, op] of Object.entries(players)) {
      if (!op.alive) continue;
      const body = oid === id ? op.snake.slice(1) : op.snake;
      if (body.some(s => s.x === head.x && s.y === head.y)) {
        deathMap[id] = (oid !== id) ? oid : null;
        break;
      }
    }
  }

  // 2b. Resolve head-on collisions: mutual kills → longer snake survives
  //  If A killed B AND B killed A, it's a pure head-on. The longer snake wins;
  //  equal length → both die (classic rule).
  const resolved = new Set();
  for (const [victimId, killerId] of Object.entries(deathMap)) {
    if (resolved.has(victimId) || !killerId) continue;
    if (deathMap[killerId] === victimId) {
      // Mutual — head-on collision between victimId and killerId
      const a = players[victimId];
      const b = players[killerId];
      const lenA = a ? a.snake.length : 0;
      const lenB = b ? b.snake.length : 0;
      if (lenA > lenB) {
        // victimId (A) is longer → A survives, remove from deathMap
        delete deathMap[victimId];
      } else if (lenB > lenA) {
        // killerId (B) is longer → B survives, remove from deathMap
        delete deathMap[killerId];
      }
      // equal length: both stay in deathMap (both die)
      resolved.add(victimId);
      resolved.add(killerId);
    }
  }

  // 3. Apply deaths
  for (const [victimId, killerId] of Object.entries(deathMap)) {
    const victim = players[victimId];
    if (!victim) continue;

    const victimLen  = victim.snake.length;   // capture before clearing
    victim.alive     = false;
    victim.snake     = [];
    victim.score     = 0;
    victim.respawnAt = now + RESPAWN_MS;

    // Award kill (only if killer not also dying this tick)
    if (killerId && players[killerId] && !deathMap[killerId]) {
      const killer = players[killerId];
      killer.kills  = (killer.kills  || 0) + 1;
      killer.score += 30;

      // Length bonus: gain half the victim's length (min 3 segments)
      const bonus = Math.max(3, Math.floor(victimLen / 2));
      const tail  = killer.snake[killer.snake.length - 1];
      for (let i = 0; i < bonus; i++) {
        killer.snake.push({ ...tail });
      }
    }

    const killerName = killerId && players[killerId] ? players[killerId].name : null;
    io.emit('player-died', {
      id:         victimId,
      name:       victim.name,
      killedBy:   killerName,
      killedById: killerId || null,
    });

    const vid = victimId;
    setTimeout(() => {
      if (players[vid]) {
        spawnSnake(players[vid]);
        players[vid].respawnAt = null;
        io.emit('player-respawned', { id: vid, name: players[vid].name });
      }
    }, RESPAWN_MS);
  }

  // 4. Broadcast game state
  io.emit('game-state', {
    players: Object.values(players).map(p => ({
      id:        p.id,
      name:      p.name,
      color:     p.color,
      snake:     p.snake,
      alive:     p.alive,
      score:     p.score,
      kills:     p.kills || 0,
      dir:       p.direction,
      respawnIn: p.respawnAt
        ? Math.max(0, Math.ceil((p.respawnAt - Date.now()) / 1000))
        : null,
    })),
    foods,
  });
}

// ── socket events ─────────────────────────────────────────────────

io.on('connection', socket => {
  console.log('+ connected:', socket.id);

  socket.on('join', ({ name }) => {
    if (players[socket.id]) return;
    const color = COLORS[colorIdx % COLORS.length];
    colorIdx++;
    const player = {
      id:        socket.id,
      name:      String(name || 'Anonymous').slice(0, 16),
      color,
      snake:     [],
      direction: { x: 1, y: 0 },
      nextDir:   { x: 1, y: 0 },
      score:     0,
      kills:     0,
      alive:     true,
      respawnAt: null,
    };
    spawnSnake(player);
    players[socket.id] = player;
    socket.emit('joined', { id: socket.id, color });
  });

  socket.on('direction', dir => {
    const p = players[socket.id];
    if (!p || !p.alive) return;
    const map = {
      up:    { x:  0, y: -1 },
      down:  { x:  0, y:  1 },
      left:  { x: -1, y:  0 },
      right: { x:  1, y:  0 },
    };
    const nd = map[dir];
    if (!nd) return;
    // Prevent reverse
    if (nd.x !== -p.direction.x || nd.y !== -p.direction.y) {
      p.nextDir = nd;
    }
  });

  socket.on('disconnect', () => {
    console.log('- disconnected:', socket.id);
    const p = players[socket.id];
    if (p) {
      const name = p.name;
      delete players[socket.id];
      io.emit('player-left', { id: socket.id, name });
    }
  });
});

// ── init ──────────────────────────────────────────────────────────

initFoods();
setInterval(tick, TICK_MS);

const PORT = process.env.PORT || 3003;
server.listen(PORT, () => console.log(`Snake server running on port ${PORT}`));
