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
} catch (e) {
  console.warn('[page-agent] 初始化失败:', e);
}
