/**
 * PM2 Ecosystem Config — 自动扫描所有游戏服务器
 * 新增游戏只需在 games/<name>/server/server.js 放好文件，
 * 重新执行 pm2 start ecosystem.config.cjs 即可，无需修改此文件。
 */

const path = require('path');
const fs   = require('fs');

const ROOT = __dirname;

// 从 .env 读取 OpenClaw 配置（不引入额外依赖，手动解析）
function loadEnvVars() {
  const envFile = path.join(ROOT, '.env');
  const vars = {};
  if (!fs.existsSync(envFile)) return vars;
  fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^\s*(OPENCLAW_\w+)\s*=\s*(.+)/);
    if (m) vars[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  });
  return vars;
}

const openclawEnv = loadEnvVars();

// ── 固定服务 ─────────────────────────────────────────────
const apps = [
  {
    name       : 'flask-backend',
    script     : 'backend/app.py',
    interpreter: 'python3',
    cwd        : ROOT,
    env        : { FLASK_DEBUG: 'false' },
    autorestart: true,
    watch      : false,
  },
];

// ── 自动扫描 games/*/server/server.js ───────────────────
const gamesDir = path.join(ROOT, 'games');
fs.readdirSync(gamesDir).forEach(game => {
  const entry = path.join(gamesDir, game, 'server', 'server.js');
  if (fs.existsSync(entry)) {
    apps.push({
      name       : `game-${game}`,
      script     : entry,
      cwd        : path.join(gamesDir, game, 'server'),
      interpreter: 'node',
      autorestart: true,
      watch      : false,
      env        : { ...openclawEnv },
    });
  }
});

module.exports = { apps };
