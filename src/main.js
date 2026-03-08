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

// 全局函数
window.rateGame = rateGame;
window.addComment = addComment;
window.deleteGame = deleteGame;
window.closeModal = closeModal;