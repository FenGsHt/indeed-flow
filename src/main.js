// API 基础 URL
const API_BASE = 'http://150.158.110.168:5001';

// 当前选中的游戏
let currentGames = [];
let currentTab = 'library';
let bookmarks = []; // 收藏列表

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

// Hero Tabs (Library / News)
document.querySelectorAll('.hero-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.hero-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.hero-content').forEach(c => c.classList.remove('active'));
    
    tab.classList.add('active');
    const hero = tab.dataset.hero;
    document.getElementById(`hero-${hero}`).classList.add('active');
    
    if (hero === 'news') loadIranNews();
  });
});

// Tab 切换
let currentStatusFilter = ''; // 状态筛选

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    
    tab.classList.add('active');
    currentTab = tab.dataset.tab;
    document.getElementById(`tab-${currentTab}`).classList.add('active');
    
    // 设置状态筛选
    if (currentTab === 'all') {
      currentStatusFilter = '';
    } else if (currentTab === 'todo' || currentTab === 'playing' || currentTab === 'completed') {
      currentStatusFilter = currentTab;
    }
    
    if (currentTab === 'all' || currentTab === 'todo' || currentTab === 'playing' || currentTab === 'completed') {
      loadGames();
    }
    if (currentTab === 'stats') loadStats();
  });
});

// 从 API 获取游戏列表
async function getGames(status = '') {
  try {
    const url = status ? `${API_BASE}/api/games?status=${status}` : `${API_BASE}/api/games`;
    const res = await fetch(url);
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

// 加载游戏列表
async function loadGames() {
  const games = await getGames(currentStatusFilter);
  currentGames = games;
  updateHeroStats(games);
  renderGames();
}

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
      // 默认：playing > todo > completed
      const statusOrder = { playing: 0, todo: 1, completed: 2 };
      games.sort((a, b) => statusOrder[a.status || 'todo'] - statusOrder[b.status || 'todo']);
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
                       g.status === 'completed' ? 'status-completed' : 
                       g.status === 'todo' ? 'status-wishlist' : '';
    const statusText = g.status === 'playing' ? '游玩中' : 
                      g.status === 'completed' ? '已完' : '待玩';
    
    // 生成标签
    const tags = g.tags || ['Game'];
    const tagsHtml = tags.map(t => `<span class="tag">${t}</span>`).join('');
    
    // 推荐人信息
    const recommenderText = g.recommender ? ` · 推荐人: ${g.recommender}` : '';
    
    return `
      <div class="grid-row ${statusClass}" data-id="${g.id}" onclick="showDetail('${g.id}')">
        <div class="cell-index">${String(i + 1).padStart(2, '0')}</div>
        <div class="cell-cover" style="${g.image ? `background-image:url('${g.image}')` : 'background:linear-gradient(135deg,#FF3366,#FF9933)'}" onerror="this.style.background='linear-gradient(135deg,#FF3366,#FF9933)'"></div>
        <div class="cell-title">
          <span class="game-title">${g.name}</span>
          <span class="game-platform">${g.created_by || 'Anonymous'}${recommenderText}${g.source ? ' · ' + g.source : ''}</span>
        </div>
        <div class="cell-tags">${tagsHtml}</div>
        <div class="cell-status ${statusClass}">
          <span class="status-indicator"></span>${statusText}
        </div>
        <div class="cell-action">↗</div>
      </div>
    `;
  }).join('');
  
  // 更新Featured Game（根据当前tab显示对应状态的游戏）
  let featured;
  if (currentTab === 'playing') {
    featured = games.find(g => g.status === 'playing') || games[0];
  } else if (currentTab === 'todo') {
    featured = games.find(g => g.status === 'todo') || games[0];
  } else if (currentTab === 'completed') {
    featured = games.find(g => g.status === 'completed') || games[0];
  } else {
    // all tab - 显示playing或第一个
    featured = games.find(g => g.status === 'playing') || games[0];
  }
  
  // 如果没有游戏，显示默认
  if (!featured && games.length > 0) {
    featured = games[0];
  }
  
  if (featured) {
    const tabLabel = currentTab === 'all' ? '全部' : currentTab === 'todo' ? '待玩' : currentTab === 'playing' ? '游玩中' : currentTab === 'completed' ? '已完' : currentTab;
    document.getElementById('featured-title').textContent = featured.name;
    document.getElementById('featured-time').textContent = `${tabLabel} · ${Object.keys(featured.ratings || {}).length} ratings`;
    const imgWrapper = document.getElementById('featured-image');
    if (featured.image) {
      imgWrapper.innerHTML = `<img src="${featured.image}" onerror="this.parentElement.innerHTML='<div class=\\'featured-placeholder\\'>🎮</div>'">`;
    } else {
      imgWrapper.innerHTML = '<div class="featured-placeholder">🎮</div>';
    }
  } else {
    document.getElementById('featured-title').textContent = '暂无游戏';
    document.getElementById('featured-time').textContent = '0 ratings';
    document.getElementById('featured-image').innerHTML = '<div class="featured-placeholder">🎮</div>';
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

// 加载伊朗新闻
async function loadIranNews() {
  const list = document.getElementById('iran-news-list');
  if (!list) return;
  
  // 加载收藏列表
  await loadBookmarks();
  
  try {
    const res = await fetch('/data/news.json');
    const data = await res.json();
    
    if (data.iran && data.iran.length > 0) {
      list.innerHTML = data.iran.map(item => {
        const isBookmarked = bookmarks.some(b => b.id === item.id);
        return `
        <div class="news-item">
          <h3>${item.title}</h3>
          <p>${item.summary || ''}</p>
          <div class="news-actions">
            <button class="bookmark-btn ${isBookmarked ? 'bookmarked' : ''}" onclick="toggleBookmark('${item.id}', '${item.title.replace(/'/g, "\\'")}', '${item.summary || ''}', '${item.url || ''}', 'iran')">
              ${isBookmarked ? '★' : '☆'}
            </button>
            ${item.url ? `<a href="${item.url}" target="_blank">查看详情 →</a>` : ''}
          </div>
        </div>
      `}).join('');
    } else {
      list.innerHTML = '<div class="empty-hint">暂无新闻</div>';
    }
  } catch (e) {
    list.innerHTML = '<div class="empty-hint">加载失败</div>';
  }
}

// 加载收藏列表
async function loadBookmarks() {
  try {
    const res = await fetch(`${API_BASE}/api/bookmarks`);
    if (res.ok) {
      bookmarks = await res.json();
    }
  } catch (e) {
    console.log('Failed to load bookmarks');
    bookmarks = [];
  }
}

// 切换收藏状态
async function toggleBookmark(id, title, summary, url, source) {
  const isBookmarked = bookmarks.some(b => b.id === id);
  
  try {
    if (isBookmarked) {
      // 取消收藏
      const res = await fetch(`${API_BASE}/api/bookmarks/${id}`, { method: 'DELETE' });
      if (res.ok) {
        const data = await res.json();
        bookmarks = data.bookmarks || [];
      }
    } else {
      // 添加收藏
      const res = await fetch(`${API_BASE}/api/bookmarks`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ id, title, summary, url, source })
      });
      if (res.ok) {
        const data = await res.json();
        bookmarks = data.bookmarks || [];
      }
    }
    
    // 重新渲染新闻列表
    if (document.getElementById('iran-news-list')) {
      loadIranNews();
    }
    // 如果在收藏页面，也刷新
    if (document.getElementById('bookmarks-list')) {
      renderBookmarks();
    }
  } catch (e) {
    console.error('Bookmark error:', e);
  }
}

// 渲染收藏列表
function renderBookmarks() {
  const list = document.getElementById('bookmarks-list');
  if (!list) return;
  
  if (bookmarks.length === 0) {
    list.innerHTML = '<div class="empty-hint">暂无收藏</div>';
    return;
  }
  
  list.innerHTML = bookmarks.map(item => `
    <div class="news-item">
      <h3>${item.title}</h3>
      <p>${item.summary || ''}</p>
      <div class="news-actions">
        <button class="bookmark-btn bookmarked" onclick="toggleBookmark('${item.id}', '${item.title.replace(/'/g, "\\'")}', '${item.summary || ''}', '${item.url || ''}', '${item.source || ''}')">★</button>
        ${item.url ? `<a href="${item.url}" target="_blank">查看详情 →</a>` : ''}
      </div>
    </div>
  `).join('');
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
  const currentStatus = game.status || 'todo';
  
  const statusOptions = [
    {value: 'todo', label: '待玩'},
    {value: 'playing', label: '游玩中'},
    {value: 'completed', label: '已完'}
  ].map(opt => `<option value="${opt.value}" ${opt.value === currentStatus ? 'selected' : ''}>${opt.label}</option>`).join('');
  
  document.getElementById('detail-content').innerHTML = `
    <div class="form-group">
      <label>游戏名称</label>
      <input type="text" id="detail-name" value="${game.name || ''}" style="width:100%;padding:8px;border:var(--border-thin);border-radius:var(--radius-sm);">
      <button class="btn" style="margin-top:0.5rem;" onclick="updateGameName('${game.id}')">保存名称</button>
    </div>
    <p style="color:var(--text-muted);font-size:0.8rem;">Added by ${game.created_by || 'Anonymous'}${game.recommender ? ' · 推荐人: ' + game.recommender : ''}${game.source ? ' · Source: ' + game.source : ''} · ${game.created_at?.slice(0,10) || '-'}</p>
    ${game.image ? `<img src="${game.image}" class="detail-image" onerror="this.style.display='none'">` : ''}
    
    <div class="change-image-section">
      <input type="text" id="new-image-url" placeholder="New image URL" value="${game.image || ''}">
      <button class="btn" onclick="changeImage('${game.id}')">Change Cover</button>
      <button class="btn" onclick="fetchSteamImage('${game.id}', '${game.name.replace(/'/g, "\\'")}')">🔍 Steam</button>
    </div>
    
    <div class="form-group">
      <label>推荐人</label>
      <input type="text" id="detail-recommender" value="${game.recommender || ''}" placeholder="推荐人（选填）" style="width:100%;padding:8px;border:var(--border-thin);border-radius:var(--radius-sm);">
    </div>
    
    <div class="form-group">
      <label>备注</label>
      <textarea id="detail-notes" placeholder="备注（选填）" style="width:100%;padding:8px;border:var(--border-thin);border-radius:var(--radius-sm);min-height:60px;">${game.notes || ''}</textarea>
      <button class="btn" style="margin-top:0.5rem;" onclick="updateGameInfo('${game.id}')">保存推荐人和备注</button>
    </div>
    
    <div class="status-section">
      <h3>Status</h3>
      <select id="detail-status" onchange="updateGameStatus('${game.id}', this.value)">
        ${statusOptions}
      </select>
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

// 更新游戏状态
async function updateGameStatus(id, newStatus) {
  try {
    await fetch(`${API_BASE}/api/games/${id}/status`, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({status: newStatus})
    });
    loadGames();
  } catch {
    alert('Failed to update status. Please try again.');
  }
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
  const userInput = document.getElementById('comment-user')?.value || getUserName() || 'Anonymous';
  const text = document.getElementById('comment-text')?.value;
  
  // 保存用户名
  setUserName(userInput);
  
  if (!text) return;
  
  try {
    await fetch(`${API_BASE}/api/games/${id}/comment`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({user: userInput, text})
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

// 更新游戏名称
async function updateGameName(id) {
  const newName = document.getElementById('detail-name').value;
  if (!newName) {
    alert('请输入游戏名称');
    return;
  }
  
  try {
    await fetch(`${API_BASE}/api/games/${id}`, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({name: newName})
    });
    showDetail(id);
    loadGames();
  } catch {
    alert('Failed to update name. Please try again.');
  }
}

// 更新游戏推荐人和备注
async function updateGameInfo(id) {
  const recommender = document.getElementById('detail-recommender').value;
  const notes = document.getElementById('detail-notes').value;
  
  try {
    await fetch(`${API_BASE}/api/games/${id}`, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({recommender, notes})
    });
    showDetail(id);
    loadGames();
  } catch {
    alert('Failed to update info. Please try again.');
  }
}

// 从Steam获取图片
async function fetchSteamImage(id, gameName) {
  try {
    const res = await fetch(`${API_BASE}/api/steam-images?q=${encodeURIComponent(gameName)}`);
    const data = await res.json();
    
    if (data.headerUrl) {
      document.getElementById('new-image-url').value = data.headerUrl;
      // 自动保存
      await fetch(`${API_BASE}/api/games/${id}`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({image: data.headerUrl})
      });
      showDetail(id);
      loadGames();
    } else {
      alert('No Steam image found for this game');
    }
  } catch (e) {
    alert('Failed to fetch Steam image: ' + e.message);
  }
}

// 添加游戏
async function addGame() {
  const name = document.getElementById('game-name').value;
  const image = document.getElementById('game-image-url').value || document.getElementById('game-image')?.value || '';
  // 不再发送 user 字段，后端默认用 Anonymous
  const status = document.getElementById('game-status').value;
  const tagsEl = document.getElementById('game-tags');
  const tags = tagsEl ? tagsEl.value.split(',').map(t => t.trim()).filter(t => t) : [];
  const source = document.getElementById('game-source').value;
  const recommender = document.getElementById('game-recommender').value;
  const notes = document.getElementById('game-notes').value;
  
  if (!name) {
    alert('Please enter game name');
    return;
  }
  
  try {
    await fetch(`${API_BASE}/api/games`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({name, image, status, tags, source, recommender, notes})
    });
    
    document.getElementById('game-name').value = '';
    document.getElementById('game-image-url').value = '';
    if (tagsEl) tagsEl.value = '';
    document.getElementById('game-source').value = '';
    document.getElementById('game-recommender').value = '';
    document.getElementById('game-notes').value = '';
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
window.fetchSteamImage = fetchSteamImage;
window.updateGameStatus = updateGameStatus;
window.toggleBookmark = toggleBookmark;
window.updateGameName = updateGameName;
window.updateGameInfo = updateGameInfo;

// 新闻 Tab 切换
document.querySelectorAll('.news-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.news-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.news-content').forEach(c => c.classList.remove('active'));
    
    tab.classList.add('active');
    const newsType = tab.dataset.news;
    document.getElementById(`news-${newsType}`).classList.add('active');
    
    if (newsType === 'bookmarks') {
      loadBookmarks().then(() => renderBookmarks());
    }
  });
});

// 初始化
loadGames();
initUserName();
