// 入口文件
console.log('Indeed Flow 已加载');

// 简单的动态效果
document.addEventListener('DOMContentLoaded', () => {
  const app = document.getElementById('app');
  app.style.opacity = '0';
  app.style.transition = 'opacity 0.5s ease';
  setTimeout(() => {
    app.style.opacity = '1';
  }, 100);
});