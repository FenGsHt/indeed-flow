'use strict';

const fs   = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'stats.json');

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch { return { allTime: {}, daily: {} }; }
}

function save(data) {
  try { fs.writeFileSync(FILE, JSON.stringify(data)); }
  catch (e) { console.error('[stats] save error:', e.message); }
}

// UTC+8 日期键，以凌晨4点为一天的分界线
// 例：3月18日凌晨3:59 → 算 3月17日；3月18日凌晨4:00 → 算 3月18日
function todayKey() {
  const d = new Date(Date.now() + 8 * 3600_000 - 4 * 3600_000);
  return d.toISOString().slice(0, 10);
}

// ── 记录一局结束 ───────────────────────────────
// players: [{id, name, ...}]  winnerId: string  roundPoints: number
function recordGame(players, winnerId, roundPoints) {
  const data = load();
  const day  = todayKey();

  if (!data.daily[day]) data.daily[day] = {};

  // 只保留最近 60 天
  const days = Object.keys(data.daily).sort();
  while (days.length > 60) delete data.daily[days.shift()];

  for (const p of players) {
    const isWinner = p.id === winnerId;
    const pts      = isWinner ? (roundPoints || 0) : 0;

    // 全局
    const at = data.allTime[p.name] || { games: 0, wins: 0, totalPoints: 0 };
    at.games++;
    if (isWinner) { at.wins++; at.totalPoints += pts; }
    data.allTime[p.name] = at;

    // 今日
    const dy = data.daily[day][p.name] || { games: 0, wins: 0, totalPoints: 0 };
    dy.games++;
    if (isWinner) { dy.wins++; dy.totalPoints += pts; }
    data.daily[day][p.name] = dy;
  }

  save(data);
}

// ── 综合评分（满分 100） ───────────────────────
// 胜率 60% + 均分（上限 200 分/局）40%
function calcScore({ games, wins, totalPoints }) {
  if (!games) return 0;
  const winRate = wins / games;
  const avgPts  = totalPoints / games;
  return +(winRate * 60 + Math.min(avgPts / 200, 1) * 40).toFixed(1);
}

function buildRank(statsObj) {
  return Object.entries(statsObj)
    .map(([name, s]) => ({
      name,
      games:     s.games,
      wins:      s.wins,
      winRate:   s.games ? +(s.wins / s.games * 100).toFixed(1) : 0,
      avgPts:    s.games ? +(s.totalPoints / s.games).toFixed(1) : 0,
      score:     calcScore(s),
    }))
    .sort((a, b) => b.score - a.score || b.wins - a.wins)
    .slice(0, 20);
}

// ── 查询榜单 ──────────────────────────────────
function getLeaderboard() {
  const data = load();
  const day  = todayKey();
  return {
    allTime: buildRank(data.allTime),
    today:   buildRank(data.daily[day] || {}),
  };
}

module.exports = { recordGame, getLeaderboard };
