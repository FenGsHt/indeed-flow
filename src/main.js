// API 基础 URL
const API_BASE = 'http://150.158.110.168:5001'; // API 后端地址

// 夜间模式切换
const themeToggle = document.getElementById('theme-toggle');
if (themeToggle) {
  // 读取保存的主题
  const isDark = localStorage.getItem('theme') === 'dark';
  if (isDark) document.body.classList.add('dark-mode');
  
  themeToggle.addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
    const dark = document.body.classList.contains('dark-mode');
    themeToggle.textContent = dark ? '☀️' : '🌙';
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  });
  
  // 初始化图标
  if (isDark) themeToggle.textContent = '☀️';
}

// 从 API 获取游戏列表，失败则用本地静态数据
async function getGames() {
  try {
    const res = await fetch(`${API_BASE}/api/games`);
    if (res.ok) return await res.json();
  } catch (e) {
    console.log('API不可用，使用本地数据');
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

// 页面切换
document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const page = e.target.dataset.page;
    
    // 更新导航
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    e.target.classList.add('active');
    
    // 切换页面
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(`${page}-page`).classList.add('active');
    
    if (page === 'games') loadGames();
    if (page === 'news') loadNewsTabs();
  });
});

// 搜索和排序事件
document.getElementById('search-games')?.addEventListener('input', loadGames);
document.getElementById('sort-games')?.addEventListener('change', loadGames);

// 加载游戏列表
async function loadGames() {
  let games = await getGames();
  
  // 搜索过滤
  const search = document.getElementById('search-games')?.value?.toLowerCase() || '';
  if (search) games = games.filter(g => g.name.toLowerCase().includes(search));
  
  // 排序
  const sort = document.getElementById('sort-games')?.value || 'time';
  if (sort === 'rating') games.sort((a,b) => (b.avg_rating||0) - (a.avg_rating||0));
  else if (sort === 'name') games.sort((a,b) => a.name.localeCompare(b.name, 'zh'));
  else games.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
  
  document.getElementById('total-games').textContent = games.length;
  
  const list = document.getElementById('games-list');
  
  if (games.length === 0) {
    list.innerHTML = '<p class="empty-hint">暂无游戏，点击添加</p>';
    return;
  }
  
  list.innerHTML = games.map((g, i) => `
    <div class="game-card" data-id="${g.id}">
      <div class="game-rank">${i + 1}</div>
      ${g.image && g.image.startsWith('http') ? 
        `<img src="${g.image}" alt="${g.name}" onerror="this.style.display='none'">` : 
        `<div class="game-placeholder">${g.name[0]}</div>`}
      <div class="game-info">
        <h3>${g.name}</h3>
        <div class="game-meta">
          <span class="rating">${g.avg_rating > 0 ? '⭐ ' + g.avg_rating.toFixed(1) : '暂无评分'}</span>
          <span class="stats">${Object.keys(g.ratings || {}).length}评 · ${(g.comments || []).length}言</span>
        </div>
      </div>
    </div>
  `).join('');
  
  // 添加点击事件
  document.querySelectorAll('.game-card').forEach(card => {
    card.addEventListener('click', () => showDetail(card.dataset.id));
  });
  
  // 更新首页统计
  loadStats(games);
}

// 加载首页统计
function loadStats(games) {
  let totalRatings = 0, totalComments = 0;
  games.forEach(g => {
    totalRatings += Object.keys(g.ratings || {}).length;
    totalComments += (g.comments || []).length;
  });
  document.getElementById('stat-games').textContent = games.length;
  document.getElementById('stat-ratings').textContent = totalRatings;
  document.getElementById('stat-comments').textContent = totalComments;
}

// 显示游戏详情
async function showDetail(id) {
  const games = await getGames();
  const game = games.find(g => g.id === id);
  if (!game) return;
  
  const avg = game.avg_rating || 0;
  
  document.getElementById('detail-content').innerHTML = `
    <h2>${game.name}</h2>
    <p class="added-by">添加者: ${game.created_by} · ${game.created_at?.slice(0,10) || '-'}</p>
    ${game.image && game.image.startsWith('http') ? `<img src="${game.image}" class="detail-image" onerror="this.style.display='none'">` : ''}
    
    <div class="rating-section">
      <h3>评分: ${avg > 0 ? '⭐ ' + avg.toFixed(1) : '暂无'}</h3>
      <div class="rate-buttons">
        ${[1,2,3,4,5].map(n => `<button onclick="rateGame('${id}', ${n})" class="rate-btn">${n}⭐</button>`).join('')}
      </div>
      <input type="text" id="rater-name" placeholder="你的名字">
    </div>
    
    <div class="comments-section">
      <h3>💬 留言 (${(game.comments || []).length})</h3>
      <div class="comments-list">
        ${(game.comments || []).length ? game.comments.map(c => `
          <div class="comment"><strong>${c.user}</strong>: ${c.text} <span class="time">${c.timestamp?.slice(0,10) || ''}</span></div>
        `).join('') : '<p class="hint">暂无留言</p>'}
      </div>
      <div class="add-comment">
        <input type="text" id="comment-user" placeholder="名字" style="width:80px;">
        <input type="text" id="comment-text" placeholder="留言...">
        <button onclick="addComment('${id}')" class="btn-small">发送</button>
      </div>
    </div>
    
    <div class="detail-actions">
      <button onclick="deleteGame('${id}')" class="btn-danger">删除</button>
      <button onclick="closeModal('detail-modal')" class="btn-secondary">关闭</button>
    </div>
  `;
  
  document.getElementById('detail-modal').style.display = 'flex';
}

// 评分
async function rateGame(id, score) {
  const user = document.getElementById('rater-name').value || '匿名';
  
  try {
    await fetch(`${API_BASE}/api/games/${id}/rate`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({user, score})
    });
    showDetail(id);
    loadGames();
  } catch {
    alert('评分功能需要后端服务，请稍后重试');
  }
}

// 留言
async function addComment(id) {
  const user = document.getElementById('comment-user').value || '匿名';
  const text = document.getElementById('comment-text').value;
  if (!text) return;
  
  try {
    await fetch(`${API_BASE}/api/games/${id}/comment`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({user, text})
    });
    showDetail(id);
  } catch {
    alert('留言功能需要后端服务，请稍后重试');
  }
}

// 删除游戏
async function deleteGame(id) {
  if (!confirm('确定删除？')) return;
  
  try {
    await fetch(`${API_BASE}/api/games/${id}`, {method: 'DELETE'});
  } catch {
    alert('删除功能需要后端服务，请稍后重试');
  }
  closeModal('detail-modal');
  loadGames();
}

// 弹窗控制
function closeModal(id) {
  document.getElementById(id).style.display = 'none';
}

// 添加游戏按钮
document.getElementById('add-game-btn').addEventListener('click', () => {
  document.getElementById('add-modal').style.display = 'flex';
});

document.getElementById('cancel-add').addEventListener('click', () => {
  closeModal('add-modal');
});

// 自动搜索游戏图片
let searchTimeout;
document.getElementById('game-name').addEventListener('input', (e) => {
  clearTimeout(searchTimeout);
  const name = e.target.value.trim();
  const preview = document.getElementById('image-preview');
  
  if (name.length < 2) {
    preview.style.display = 'none';
    return;
  }
  
  // 防抖搜索
  searchTimeout = setTimeout(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/search-image?q=${encodeURIComponent(name)}`);
      const data = await res.json();
      if (data.image) {
        document.getElementById('game-image').value = data.image;
        preview.innerHTML = `<img src="${data.image}" alt="${data.name}">`;
        preview.style.display = 'block';
      } else {
        preview.style.display = 'none';
      }
    } catch (e) {
      console.error('Search error:', e);
    }
  }, 500);
});

// 添加游戏
document.getElementById('confirm-add').addEventListener('click', async () => {
  const name = document.getElementById('game-name').value;
  const image = document.getElementById('game-image').value;
  const user = document.getElementById('game-user').value || '匿名';
  
  if (!name) {
    alert('请输入游戏名称');
    return;
  }
  
  try {
    const res = await fetch(`${API_BASE}/api/games`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({name, image, user})
    });
    
    if (!res.ok) {
      const err = await res.json();
      alert('添加失败: ' + (err.error || '未知错误'));
      return;
    }
    
    const data = await res.json();
    if (!data.success) {
      alert('添加失败: ' + (data.error || '未知错误'));
      return;
    }
    
    // 成功后才清空和刷新
    document.getElementById('game-name').value = '';
    document.getElementById('game-image').value = '';
    document.getElementById('game-user').value = '';
    
    closeModal('add-modal');
    loadGames();
  } catch (e) {
    alert('后端服务未运行，添加功能暂时不可用');
    console.error('Add game error:', e);
  }
});

// 关闭弹窗
document.querySelectorAll('.modal').forEach(modal => {
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.style.display = 'none';
    }
  });
});

// ============== Steam 图片搜索 ==============

// Steam搜索按钮
document.getElementById('search-steam-btn')?.addEventListener('click', async () => {
  const name = document.getElementById('game-name').value.trim();
  if (!name) {
    alert('请先输入游戏名称');
    return;
  }
  
  const resultsDiv = document.getElementById('steam-results');
  resultsDiv.innerHTML = '<div class="loading">搜索中...</div>';
  
  try {
    // Steam 商店搜索API
    const res = await fetch(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(name)}&l=schinese&cc=CN`);
    const data = await res.json();
    
    if (data.items && data.items.length > 0) {
      resultsDiv.innerHTML = data.items.slice(0, 5).map(item => `
        <div class="steam-item" onclick="selectSteamImage('${item.price?.final?.final?.replace(/[^0-9]/g, '') ? 'https://cdn.cloudflare.steamstatic.com/steam/apps/' + item.id + '/header.jpg' : ''}', '${item.name}')">
          <img src="${item.thumb}" onerror="this.style.display='none'">
          <span>${item.name}</span>
        </div>
      `).join('');
    } else {
      resultsDiv.innerHTML = '<div class="empty-hint">未找到相关游戏</div>';
    }
  } catch (e) {
    resultsDiv.innerHTML = '<div class="error-state">搜索失败，请手动输入图片URL</div>';
  }
});

function selectSteamImage(url, name) {
  document.getElementById('game-image').value = url;
  document.getElementById('steam-results').innerHTML = '';
  document.getElementById('image-preview').innerHTML = url ? `<img src="${url}" onerror="this.parentElement.innerHTML=''">` : '';
}

// ============== 新闻专区 ==============

// 加载新闻Tab配置
async function loadNewsTabs() {
  try {
    const res = await fetch('/data/config.json');
    const config = await res.json();
    const tabsContainer = document.querySelector('.news-tabs');
    if (tabsContainer && config.newsTabs) {
      tabsContainer.innerHTML = config.newsTabs.map(t => 
        `<button class="news-tab ${t.id === 'hot' ? 'active' : ''}" data-tab="${t.id}">${t.name}</button>`
      ).join('');
      
      // 重新绑定事件
      initNewsTabs();
    }
  } catch (e) {
    console.log('使用默认新闻Tab');
  }
}

function initNewsTabs() {
  document.querySelectorAll('.news-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      document.querySelectorAll('.news-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.news-tab-content').forEach(c => c.classList.remove('active'));
      
      e.target.classList.add('active');
      document.getElementById(`${e.target.dataset.tab}-tab`).classList.add('active');
      
      if (e.target.dataset.tab === 'hot') loadHotNews();
      if (e.target.dataset.tab === 'iran') loadIranNews();
    });
  });
}

// 新闻 Tab 切换（已废弃，用initNewsTabs）
document.querySelectorAll('.news-tab').forEach(tab => {
  tab.addEventListener('click', (e) => {
    document.querySelectorAll('.news-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.news-tab-content').forEach(c => c.classList.remove('active'));
    
    e.target.classList.add('active');
    document.getElementById(`${e.target.dataset.tab}-tab`).classList.add('active');
    
    if (e.target.dataset.tab === 'hot') {
      loadHotNews();
    } else {
      loadIranNews();
    }
  });
});

async function loadHotNews() {
  try {
    const res = await fetch('/data/news.json');
    const data = await res.json();
    
    // 贴吧
    document.getElementById('tieba-hot').innerHTML = data.tieba?.map((item, i) => {
      const title = typeof item === 'string' ? item : (item.title || '');
      const url = typeof item === 'object' ? item.url : '';
      const summary = typeof item === 'object' ? (item.summary || '') : '';
      return url ? `<li><span class="rank">${i+1}</span><a href="${url}" target="_blank">${title}</a><p class="hot-summary">${summary}</p></li>` : `<li><span class="rank">${i+1}</span>${title}</li>`;
    }).join('') || '<li class="error-state">加载失败 <button onclick="loadHotNews()">重试</button></li>';
    
    // 微博
    document.getElementById('weibo-hot').innerHTML = data.weibo?.map((item, i) => {
      const title = typeof item === 'string' ? item : (item.title || '');
      const url = typeof item === 'object' ? item.url : '';
      const summary = typeof item === 'object' ? (item.summary || '') : '';
      return url ? `<li><span class="rank">${i+1}</span><a href="${url}" target="_blank">${title}</a><p class="hot-summary">${summary}</p></li>` : `<li><span class="rank">${i+1}</span>${title}</li>`;
    }).join('') || '<li class="error-state">加载失败 <button onclick="loadHotNews()">重试</button></li>';
    
    // B站
    document.getElementById('bilibili-hot').innerHTML = data.bilibili?.map((item, i) => {
      const title = typeof item === 'string' ? item : (item.title || '');
      const url = typeof item === 'object' ? item.url : '';
      const summary = typeof item === 'object' ? (item.summary || '') : '';
      return url ? `<li><span class="rank">${i+1}</span><a href="${url}" target="_blank">${title}</a><p class="hot-summary">${summary}</p></li>` : `<li><span class="rank">${i+1}</span>${title}</li>`;
    }).join('') || '<li class="error-state">加载失败 <button onclick="loadHotNews()">重试</button></li>';
    
    // 抖音
    document.getElementById('douyin-hot').innerHTML = data.douyin?.map((item, i) => {
      const title = typeof item === 'string' ? item : (item.title || '');
      const url = typeof item === 'object' ? item.url : '';
      const summary = typeof item === 'object' ? (item.summary || '') : '';
      return url ? `<li class="hot-item"><span class="rank">${i+1}</span><a href="${url}" target="_blank">${title}</a><div class="hot-tooltip">${summary || title}</div></li>` : `<li><span class="rank">${i+1}</span>${title}</li>`;
    }).join('') || '<li class="error-state">加载失败 <button onclick="loadHotNews()">重试</button></li>';
    
    // 小红书
    document.getElementById('xiaohongshu-hot').innerHTML = data.xiaohongshu?.map((item, i) => {
      const title = typeof item === 'string' ? item : (item.title || '');
      const url = typeof item === 'object' ? item.url : '';
      const summary = typeof item === 'object' ? (item.summary || '') : '';
      return url ? `<li><span class="rank">${i+1}</span><a href="${url}" target="_blank">${title}</a><p class="hot-summary">${summary}</p></li>` : `<li><span class="rank">${i+1}</span>${title}</li>`;
    }).join('') || '<li class="error-state">加载失败 <button onclick="loadHotNews()">重试</button></li>';
    
    // 公共热点
    const publicHot = document.getElementById('public-hot');
    if (data.public && data.public.length > 0) {
      publicHot.innerHTML = '<h3>🌐 公共热点</h3><ul>' + 
        data.public.map(item => 
          `<li>${item.topic}<span class="platforms">${item.platforms.join(', ')}</span></li>`
        ).join('') + '</ul>';
    } else {
      publicHot.innerHTML = '<h3>🌐 公共热点</h3><p class="hint">暂无公共热点</p>';
    }
  } catch (e) {
    console.error('加载热点失败:', e);
  }
}

async function loadIranNews() {
  try {
    const res = await fetch('/data/news.json');
    const data = await res.json();
    
    const container = document.getElementById('iran-news');
    if (data.iran && data.iran.length > 0) {
      container.innerHTML = data.iran.map((item, idx) => `
        <div class="iran-item" data-idx="${idx}">
          <h4>${item.title}</h4>
          <div class="meta">
            <span class="source">${item.source}</span> | <span>${item.time}</span>
          </div>
          <p class="summary">${item.summary}</p>
          <a href="${item.url}" target="_blank" class="news-link">查看详情 →</a>
        </div>
      `).join('');
    } else {
      container.innerHTML = '<p class="hint">暂无新闻</p>';
    }
  } catch (e) {
    console.error('加载伊朗新闻失败:', e);
  }
}

// 页面切换时加载新闻
const originalNavHandler = document.querySelector('.nav-link[data-page="news"]');
document.querySelector('.nav-link[data-page="news"]').addEventListener('click', () => {
  loadHotNews();
});

// 全局函数
window.rateGame = rateGame;
window.addComment = addComment;
window.deleteGame = deleteGame;
window.closeModal = closeModal;