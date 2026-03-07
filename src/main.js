// 动态时间显示
document.addEventListener('DOMContentLoaded', () => {
  console.log('Indeed Flow 已加载');

  // 添加卡片入场动画
  const cards = document.querySelectorAll('.feature-card');
  cards.forEach((card, index) => {
    card.style.opacity = '0';
    card.style.transform = 'translateY(20px)';
    setTimeout(() => {
      card.style.transition = 'all 0.5s ease';
      card.style.opacity = '1';
      card.style.transform = 'translateY(0)';
    }, 200 * (index + 1));
  });

  // 状态项动画
  const statusItems = document.querySelectorAll('.status-item');
  statusItems.forEach((item, index) => {
    item.style.opacity = '0';
    setTimeout(() => {
      item.style.transition = 'opacity 0.4s ease';
      item.style.opacity = '1';
    }, 600 + index * 150);
  });
});