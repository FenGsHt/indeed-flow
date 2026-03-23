/**
 * page-agent AI 助手初始化（模块化，异步加载不阻塞页面）
 * 2026-03-19: 接入 page-agent，通过 Flask 后端代理保护 API Key
 */
import { PageAgent } from 'page-agent';

try {
  const agent = new PageAgent({
    model: 'qwen3.5-plus',
    baseURL: 'http://150.158.110.168:5001/api/llm/v1',
    apiKey: 'proxy',
    language: 'zh-CN',
  });

  agent.panel.show();

  // 1秒后优雅地飞入启动按钮
  setTimeout(() => {
    const wrapper = agent.panel.wrapper;
    const fab = document.querySelector('.ai-fab');
    if (!wrapper || !fab) {
      agent.panel.hide();
      return;
    }

    const panelRect = wrapper.getBoundingClientRect();
    const fabRect  = fab.getBoundingClientRect();

    // 面板中心 → 按钮中心 的偏移量
    const panelCx = panelRect.left + panelRect.width  / 2;
    const panelCy = panelRect.top  + panelRect.height / 2;
    const fabCx   = fabRect.left   + fabRect.width    / 2;
    const fabCy   = fabRect.top    + fabRect.height   / 2;
    const dx = fabCx - panelCx;
    const dy = fabCy - panelCy;

    // 覆盖 panel 原有 transition，使用自定义时长
    wrapper.style.transition = 'opacity 0.55s cubic-bezier(0.4,0,1,1), transform 0.55s cubic-bezier(0.4,0,1,1)';
    wrapper.style.opacity    = '0';
    // translateX(-50%) 是 panel 本身的水平居中偏移，保留它并追加位移+缩放
    wrapper.style.transform  = `translateX(calc(-50% + ${dx}px)) translateY(${dy}px) scale(0.08)`;

    wrapper.addEventListener('transitionend', () => {
      wrapper.style.display = 'none';
    }, { once: true });
  }, 1000);

} catch (e) {
  console.warn('[page-agent] 初始化失败:', e);
}
