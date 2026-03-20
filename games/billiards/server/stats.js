const fs = require('fs');
const path = require('path');

const STATS_FILE = path.join(__dirname, 'stats.json');
const MAX_DAYS = 60;

function getToday() {
  // UTC+8, day resets at 4am
  const now = new Date();
  const local = new Date(now.getTime() + 8 * 3600000 - 4 * 3600000);
  return local.toISOString().slice(0, 10);
}

function load() {
  try {
    if (fs.existsSync(STATS_FILE)) return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
  } catch (e) {}
  return { allTime: {}, daily: {} };
}

function save(stats) {
  try { fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2)); } catch (e) {}
}

function recordGame(playerName, won) {
  const stats = load();
  const today = getToday();

  if (!stats.allTime[playerName]) stats.allTime[playerName] = { games: 0, wins: 0 };
  stats.allTime[playerName].games++;
  if (won) stats.allTime[playerName].wins++;

  if (!stats.daily[today]) stats.daily[today] = {};
  if (!stats.daily[today][playerName]) stats.daily[today][playerName] = { games: 0, wins: 0 };
  stats.daily[today][playerName].games++;
  if (won) stats.daily[today][playerName].wins++;

  // Trim old days
  const days = Object.keys(stats.daily).sort();
  while (days.length > MAX_DAYS) delete stats.daily[days.shift()];

  save(stats);
}

function buildBoard(data) {
  return Object.entries(data)
    .map(([name, s]) => ({
      name,
      games: s.games,
      wins: s.wins,
      winRate: s.games > 0 ? Math.round(s.wins / s.games * 100) : 0,
    }))
    .filter(p => p.games > 0)
    .sort((a, b) => b.wins - a.wins || b.winRate - a.winRate)
    .slice(0, 20);
}

function getLeaderboard() {
  const stats = load();
  const today = getToday();
  return {
    allTime: buildBoard(stats.allTime),
    daily: buildBoard(stats.daily[today] || {}),
  };
}

module.exports = { recordGame, getLeaderboard };
