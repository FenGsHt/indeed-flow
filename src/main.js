// indeed-flow - 待玩游戏列表

import './style.css';
import gamesData from './games.json';

const app = document.getElementById('app');

// 路由
const routes = {
  '/': renderHome,
  '/games': renderGames,
  '/game/:id': renderGameDetail
};

function navigate(path) {
  window.history.pushState({}, '', path);
  render();
}

function render() {
  const path = window.location.pathname;
  const hash = window.location.hash.slice(1);
  
  if (path === '/' || path === '/index.html') {
    renderHome();
  } else if (path === '/games' || hash === 'games') {
    renderGames();
  } else if (path.startsWith('/game/')) {
    const id = path.split('/game/')[1];
    renderGameDetail(id);
  }
}

// 首页
function renderHome() {
  app.innerHTML = `
    <nav class="nav">
      <div class="nav-brand">INDEED</div>
      <div class="nav-links">
        <a href="/" class="active">首页</a>
        <a href="#games">待玩游戏</a>
        <a href="#console">控制台</a>
      </div>
    </nav>
    <div class="container home">
      <h1 class="rainbow-text">INDEED</h1>
      <p class="subtitle">自动化工作流演示项目</p>
      <div class="menu-grid">
        <a href="#games" class="menu-card">
          <div class="menu-icon">🎮</div>
          <h3>待玩游戏</h3>
          <p>查看群里想玩的游戏列表，按优先级排序</p>
        </a>
        <a href="#console" class="menu-card">
          <div class="menu-icon">⚙️</div>
          <h3>控制台</h3>
          <p>OpenClaw 管理界面</p>
        </a>
        <a href="https://github.com/FenGsHt/indeed-flow" target="_blank" class="menu-card">
          <div class="menu-icon">📖</div>
          <h3>文档</h3>
          <p>项目源码和说明</p>
        </a>
      </div>
    </div>
  `;
}

// 游戏列表页
function renderGames() {
  const games = gamesData;
  
  app.innerHTML = `
    <nav class="nav">
      <div class="nav-brand">INDEED</div>
      <div class="nav-links">
        <a href="/">首页</a>
        <a href="#games" class="active">待玩游戏</a>
        <a href="#console">控制台</a>
      </div>
    </nav>
    <div class="container games-page">
      <div class="page-header">
        <h1>🎮 待玩游戏列表</h1>
        <p>共 ${games.length} 个游戏，按优先级排序</p>
      </div>
      <div class="games-list">
        ${games.map((game, index) => `
          <a href="#game/${game.id}" class="game-card">
            <div class="game-rank">#${index + 1}</div>
            <div class="game-info">
              <h3>${game.name}</h3>
              ${game.desc ? `<p>${game.desc}</p>` : ''}
            </div>
            <div class="game-arrow">→</div>
          </a>
        `).join('')}
      </div>
    </div>
  `;
}

// 游戏详情页
function renderGameDetail(id) {
  const game = gamesData.find(g => g.id === id);
  
  if (!game) {
    app.innerHTML = `
      <nav class="nav">
        <div class="nav-brand">INDEED</div>
        <div class="nav-links">
          <a href="/">首页</a>
          <a href="#games">待玩游戏</a>
        </div>
      </nav>
      <div class="container">
        <h1>游戏未找到</h1>
        <a href="#games" class="btn">返回列表</a>
      </div>
    `;
    return;
  }
  
  app.innerHTML = `
    <nav class="nav">
      <div class="nav-brand">INDEED</div>
      <div class="nav-links">
        <a href="/">首页</a>
        <a href="#games">待玩游戏</a>
      </div>
    </nav>
    <div class="container game-detail">
      <a href="#games" class="back-link">← 返回列表</a>
      <div class="detail-card">
        <h1>${game.name}</h1>
        ${game.desc ? `<p class="desc">${game.desc}</p>` : ''}
        <div class="detail-stats">
          <div class="stat">
            <span class="stat-label">评分</span>
            <span class="stat-value">暂无</span>
          </div>
          <div class="stat">
            <span class="stat-label">留言</span>
            <span class="stat-value">0</span>
          </div>
        </div>
        <div class="detail-actions">
          <button class="btn btn-primary">评分</button>
          <button class="btn">留言</button>
        </div>
      </div>
    </div>
  `;
}

// 监听 hashchange
window.addEventListener('hashchange', render);

// 初始化
render();