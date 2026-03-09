// API 基础 URL
const API_BASE = ''; // 与静态网站同源

// 从 API 获取游戏列表
async function getGames() {
  const res = await fetch(`${API_BASE}/api/games`);
  return await res.json();
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
  });
});

// 加载游戏列表
async function loadGames() {
  const games = await getGames();
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
  
  await fetch(`${API_BASE}/api/games/${id}/rate`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({user, score})
  });
  
  showDetail(id);
  loadGames();
}

// 留言
async function addComment(id) {
  const user = document.getElementById('comment-user').value || '匿名';
  const text = document.getElementById('comment-text').value;
  if (!text) return;
  
  await fetch(`${API_BASE}/api/games/${id}/comment`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({user, text})
  });
  
  showDetail(id);
}

// 删除游戏
async function deleteGame(id) {
  if (!confirm('确定删除？')) return;
  
  await fetch(`${API_BASE}/api/games/${id}`, {method: 'DELETE'});
  
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
  
  await fetch(`${API_BASE}/api/games`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({name, image, user})
  });
  
  // 清空输入
  document.getElementById('game-name').value = '';
  document.getElementById('game-image').value = '';
  
  closeModal('add-modal');
  loadGames();
});

// 关闭弹窗
document.querySelectorAll('.modal').forEach(modal => {
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.style.display = 'none';
    }
  });
});

// ============== 新闻专区 ==============

// 新闻 Tab 切换
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
    document.getElementById('tieba-hot').innerHTML = data.tieba?.map((item, i) => 
      `<li><span class="rank">${i+1}</span>${item}</li>`
    ).join('') || '<li>加载失败</li>';
    
    // 微博
    document.getElementById('weibo-hot').innerHTML = data.weibo?.map((item, i) => 
      `<li><span class="rank">${i+1}</span>${item}</li>`
    ).join('') || '<li>加载失败</li>';
    
    // B站
    document.getElementById('bilibili-hot').innerHTML = data.bilibili?.map((item, i) => 
      `<li><span class="rank">${i+1}</span>${item}</li>`
    ).join('') || '<li>加载失败</li>';
    
    // 抖音
    document.getElementById('douyin-hot').innerHTML = data.douyin?.map((item, i) => 
      `<li><span class="rank">${i+1}</span>${item}</li>`
    ).join('') || '<li>加载失败</li>';
    
    // 小红书
    document.getElementById('xiaohongshu-hot').innerHTML = data.xiaohongshu?.map((item, i) => 
      `<li><span class="rank">${i+1}</span>${item}</li>`
    ).join('') || '<li>加载失败</li>';
    
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
      container.innerHTML = data.iran.map(item => `
        <div class="iran-item">
          <h4>${item.title}</h4>
          <div class="meta">
            <span class="source">${item.source}</span> | <span>${item.time}</span>
          </div>
          <p>${item.summary}</p>
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