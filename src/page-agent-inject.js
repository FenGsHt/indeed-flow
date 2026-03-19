/**
 * 2026-03-19: 供 ai-test.html iframe 注入的 page-agent 初始化脚本
 * 独立于 page-agent-init.js，用于动态注入到 iframe 内的同源页面
 */
import { PageAgent } from 'page-agent';

if (!window.__pageAgentInjected) {
  window.__pageAgentInjected = true;
  try {
    const agent = new PageAgent({
      model: 'qwen3.5-plus',
      baseURL: 'http://150.158.110.168:5001/api/llm/v1',
      apiKey: 'proxy',
      language: 'zh-CN',
    });
    agent.panel.show();
  } catch (e) {
    console.warn('[page-agent-inject] 初始化失败:', e);
  }
}
