// API 基础 URL
const API_BASE = 'http://150.158.110.168:5001';

// 当前选中的游戏
let currentGames = [];
let currentTab = 'library';

// 用户身份系统 - localStorage
const USER_KEY = 'indeed_user_name';

function getUserName() {
  return localStorage.getItem(USER_KEY) || '';
}

function setUserName(name) {
  if (name.trim()) {
    localStorage.setItem(USER_KEY, name.trim());
  }
}

function initUserName() {
  const savedName = getUserName();
  if (savedName) {
    // 自动填充到用户输入框
    const userInputs = document.querySelectorAll('#game-user, #comment-user');
    userInputs.forEach(input => {
      if (input) input.value = savedName;
    });
  }
}

// Tab 切换
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    
    tab.classList.add('active');
    currentTab = tab.dataset.tab;
    document.getElementById(`tab-${currentTab}`).classList.add('active');
    
    if (currentTab === 'library') loadGames();
    if (currentTab === 'stats') loadStats();
  });
});

// 从 API 获取游戏列表
async function getGames() {
  try {
    const res = await fetch(`${API_BASE}/api/games`);
    if (res.ok) return await res.json();
  } catch (e) {
    console.log('API不可用');
  }
  // 后备：本地静态数据
  try {
    const res = await fetch('/data/games.json');
    return await res.json();
  } catch {
    return [];
  }
}

// 计算平均分
function calcAvgRating(ratings) {
  if (!ratings || Object.keys(ratings).length === 0) return 0;
  const sum = Object.values(ratings).reduce((a, b) => a + b, 0);
  return sum / Object.keys(ratings).length;
}

// 搜索过滤
let searchTerm = '';
let sortType = 'default';

document.getElementById('search-input')?.addEventListener('input', (e) => {
  searchTerm = e.target.value.toLowerCase();
  renderGames();
});

document.getElementById('sort-select')?.addEventListener('change', (e) => {
  sortType = e.target.value;
  renderGames();
});

// 渲染游戏（带搜索和排序）
function renderGames() {
  let games = [...currentGames];
  
  // 搜索过滤
  if (searchTerm) {
    games = games.filter(g => 
      g.name?.toLowerCase().includes(searchTerm) || 
      g.tags?.some(t => t.toLowerCase().includes(searchTerm))
    );
  }
  
  // 排序
  switch(sortType) {
    case 'name':
      games.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case 'rating':
      games.sort((a, b) => calcAvgRating(b.ratings) - calcAvgRating(a.ratings));
      break;
    case 'newest':
      games.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      break;
    default:
      // 默认：playing > backlog > completed
      const statusOrder = { playing: 0, backlog: 1, completed: 2 };
      games.sort((a, b) => statusOrder[a.status || 'backlog'] - statusOrder[b.status || 'backlog']);
  }
  
  const list = document.getElementById('games-list');
  if (!list) return;
  
  if (games.length === 0) {
    list.innerHTML = '<div class="empty-hint">No games found</div>';
    return;
  }
  
  list.innerHTML = games.map((g, i) => {
    const avg = calcAvgRating(g.ratings);
    const statusClass = g.status === 'playing' ? 'status-playing' : 
                       g.status === 'completed' ? 'status-completed' : '';
    const statusText = g.status === 'playing' ? 'Playing' : 
                      g.status === 'completed' ? 'Completed' : 'Backlog';
    
    // 生成标签
    const tags = g.tags || ['Game'];
    const tagsHtml = tags.map(t => `<span class="tag">${t}</span>`).join('');
    
    return `
      <div class="grid-row ${statusClass}" data-id="${g.id}" onclick="showDetail('${g.id}')">
        <div class="cell-index">${String(i + 1).padStart(2, '0')}</div>
        <div class="cell-cover" style="${g.image ? `background-image:url('${g.image}')` : 'background:linear-gradient(135deg,#FF3366,#FF9933)'}" onerror="this.style.background='linear-gradient(135deg,#FF3366,#FF9933)'"></div>
        <div class="cell-title">
          <span class="game-title">${g.name}</span>
          <span class="game-platform">${g.created_by || 'Anonymous'}</span>
        </div>
        <div class="cell-tags">${tagsHtml}</div>
        <div class="cell-status ${statusClass}">
          <span class="status-indicator"></span>${statusText}
        </div>
        <div class="cell-action">↗</div>
      </div>
    `;
  }).join('');
  
  // 更新Featured Game（第一个playing的游戏，或第一个游戏）
  const playing = games.find(g => g.status === 'playing');
  const featured = playing || games[0];
  if (featured) {
    document.getElementById('featured-title').textContent = featured.name;
    document.getElementById('featured-time').textContent = `${Object.keys(featured.ratings || {}).length} ratings`;
    const imgWrapper = document.getElementById('featured-image');
    if (featured.image) {
      imgWrapper.innerHTML = `<img src="${featured.image}" onerror="this.parentElement.innerHTML='<div class=\\'featured-placeholder\\'>🎮</div>'">`;
    }
  }
}

// 更新Hero统计
function updateHeroStats(games) {
  document.getElementById('stat-games').innerHTML = `${games.length}<span style="font-size:3rem;color:rgba(0,0,0,0.4)"> / 365</span>`;
  
  let totalRatings = 0, totalComments = 0;
  games.forEach(g => {
    totalRatings += Object.keys(g.ratings || {}).length;
    totalComments += (g.comments || []).length;
  });
  
  document.getElementById('stat-year').textContent = `${games.filter(g => g.status === 'completed').length} completed this year`;
}

// 加载Stats页面
async function loadStats() {
  const games = await getGames();
  
  let totalRatings = 0, totalComments = 0;
  games.forEach(g => {
    totalRatings += Object.keys(g.ratings || {}).length;
    totalComments += (g.comments || []).length;
  });
  
  document.getElementById('stat-ratings').textContent = totalRatings;
  document.getElementById('stat-comments').textContent = totalComments;
  document.getElementById('stat-added-this-year').textContent = games.length;
}

// 显示游戏详情
async function showDetail(id) {
  const games = await getGames();
  const game = games.find(g => g.id === id);
  if (!game) return;
  
  const avg = calcAvgRating(game.ratings);
  const comments = game.comments || [];
  
  document.getElementById('detail-content').innerHTML = `
    <h2>${game.name}</h2>
    <p style="color:var(--text-muted);font-size:0.8rem;">Added by ${game.created_by || 'Anonymous'} · ${game.created_at?.slice(0,10) || '-'}</p>
    ${game.image ? `<img src="${game.image}" class="detail-image" onerror="this.style.display='none'">` : ''}
    
    <div class="change-image-section">
      <input type="text" id="new-image-url" placeholder="New image URL" value="${game.image || ''}">
      <button class="btn" onclick="changeImage('${game.id}')">Change Cover</button>
    </div>
    
    <div class="rating-section">
      <h3>Rating: ${avg > 0 ? '⭐ ' + avg.toFixed(1) : 'No ratings'}</h3>
      <div class="rate-buttons">
        ${[1,2,3,4,5].map(n => `<button class="rate-btn" onclick="rateGame('${id}', ${n})">${n}⭐</button>`).join('')}
      </div>
    </div>
    
    <div class="comments-section">
      <h3>Comments (${comments.length})</h3>
      ${comments.length > 0 ? comments.map(c => `
        <div class="comment">
          <div class="comment-user">${c.user}</div>
          <div class="comment-text">${c.text}</div>
        </div>
      `).join('') : '<p style="color:var(--text-muted)">No comments yet</p>'}
      
      <div style="margin-top:1rem;">
        <input type="text" id="comment-user" placeholder="Your name" style="width:100%;padding:8px;margin-bottom:0.5rem;border:var(--border-thin);border-radius:var(--radius-sm);">
        <input type="text" id="comment-text" placeholder="Add a comment..." style="width:100%;padding:8px;border:var(--border-thin);border-radius:var(--radius-sm);">
        <button class="btn" style="margin-top:0.5rem;" onclick="addComment('${id}')">Post Comment</button>
      </div>
    </div>
    
    <div class="detail-actions">
      <button class="btn btn-danger" onclick="deleteGame('${id}')">Delete</button>
      <button class="btn btn-secondary" onclick="closeModal('detail-modal')">Close</button>
    </div>
  `;
  
  document.getElementById('detail-modal').style.display = 'flex';
}

// 评分
async function rateGame(id, score) {
  const user = document.getElementById('rater-name')?.value || 'Anonymous';
  
  try {
    await fetch(`${API_BASE}/api/games/${id}/rate`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({user, score})
    });
    showDetail(id);
    loadGames();
  } catch {
    alert('Rating failed. Please try again.');
  }
}

// 添加评论
async function addComment(id) {
  const user = document.getElementById('comment-user')?.value || 'Anonymous';
  const text = document.getElementById('comment-text')?.value;
  
  if (!text) return;
  
  try {
    await fetch(`${API_BASE}/api/games/${id}/comment`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({user, text})
    });
    showDetail(id);
    loadGames();
  } catch {
    alert('Comment failed. Please try again.');
  }
}

// 删除游戏
async function deleteGame(id) {
  if (!confirm('Delete this game?')) return;
  
  try {
    await fetch(`${API_BASE}/api/games/${id}`, {method: 'DELETE'});
    closeModal('detail-modal');
    loadGames();
  } catch {
    alert('Delete failed. Please try again.');
  }
}

// 更换封面
async function changeImage(id) {
  const newUrl = document.getElementById('new-image-url').value;
  
  try {
    await fetch(`${API_BASE}/api/games/${id}`, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({image: newUrl})
    });
    showDetail(id);
    loadGames();
  } catch {
    alert('Failed to change image. Please try again.');
  }
}

// 添加游戏
async function addGame() {
  const name = document.getElementById('game-name').value;
  const image = document.getElementById('game-image').value;
  const user = document.getElementById('game-user').value || 'Anonymous';
  const status = document.getElementById('game-status').value;
  const tags = document.getElementById('game-tags').value.split(',').map(t => t.trim()).filter(t => t);
  
  if (!name) {
    alert('Please enter game name');
    return;
  }
  
  try {
    await fetch(`${API_BASE}/api/games`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({name, image, user, status, tags})
    });
    
    document.getElementById('game-name').value = '';
    document.getElementById('game-image').value = '';
    document.getElementById('game-tags').value = '';
    document.getElementById('steam-results').innerHTML = '';
    
    closeModal('add-modal');
    loadGames();
  } catch {
    alert('Add failed. Please try again.');
  }
}

// Steam搜索
async function searchSteam() {
  const name = document.getElementById('game-name').value.trim();
  if (!name) return;
  
  const btn = document.getElementById('search-steam-btn');
  btn.textContent = '...';
  
  try {
    const res = await fetch(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(name)}&l=english&cc=US`);
    const data = await res.json();
    
    const resultsDiv = document.getElementById('steam-results');
    if (data.items && data.items.length > 0) {
      resultsDiv.innerHTML = data.items.slice(0, 5).map(item => `
        <div class="steam-item" onclick="selectSteamGame('${item.id}', '${item.name.replace(/'/g, "\\'")}')">
          <img src="${item.thumb}" onerror="this.style.display='none'">
          <span>${item.name}</span>
        </div>
      `).join('');
    } else {
      resultsDiv.innerHTML = '<div style="color:var(--text-muted)">No results found</div>';
    }
  } catch {
    document.getElementById('steam-results').innerHTML = '<div style="color:var(--text-muted)">Search failed</div>';
  }
  
  btn.textContent = '🔍 Steam';
}

function selectSteamGame(id, name) {
  document.getElementById('game-name').value = name;
  document.getElementById('game-image').value = `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/header.jpg`;
  document.getElementById('steam-results').innerHTML = '';
  
  // 预览图片
  const preview = document.getElementById('image-preview');
  preview.innerHTML = `<img src="https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/header.jpg" onerror="this.parentElement.innerHTML=''">`;
}

// 弹窗控制
function closeModal(id) {
  document.getElementById(id).style.display = 'none';
}

function openModal(id) {
  document.getElementById(id).style.display = 'flex';
}

// 事件绑定
document.getElementById('add-game-btn')?.addEventListener('click', () => openModal('add-modal'));
document.getElementById('confirm-add')?.addEventListener('click', addGame);
document.getElementById('search-steam-btn')?.addEventListener('click', searchSteam);

// 点击弹窗外部关闭
document.querySelectorAll('.modal').forEach(modal => {
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal(modal.id);
  });
});

// 全局函数
window.rateGame = rateGame;
window.addComment = addComment;
window.deleteGame = deleteGame;
window.showDetail = showDetail;
window.closeModal = closeModal;
window.selectSteamGame = selectSteamGame;
window.changeImage = changeImage;

// 初始化
loadGames();
initUserName();
