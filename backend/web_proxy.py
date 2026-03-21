#!/usr/bin/env python3
"""
2026-03-19: Web 反向代理 Blueprint
将外部网页通过本站域名返回，绕过 iframe 跨域 / X-Frame-Options 限制
配合 ai-test.html 使用，使 page-agent 可注入任意页面
"""

import re
import requests as http_requests
from urllib.parse import urljoin, urlparse, quote
from flask import Blueprint, request, Response

proxy_bp = Blueprint('proxy', __name__)

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                  '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate',
}

# 允许代理的域名白名单为空 = 不限制（简单场景）
# 如需限制可添加：ALLOWED_DOMAINS = {'baidu.com', 'bing.com', ...}
ALLOWED_DOMAINS = set()


@proxy_bp.route('/api/browse')
def browse():
    """
    反向代理外部网页
    用法: /api/browse?url=https://example.com
    - HTML 页面：注入 <base> 标签 + 移除 X-Frame-Options
    - 其他资源：直接透传
    """
    url = request.args.get('url', '').strip()
    if not url:
        return Response('Missing "url" parameter', status=400, content_type='text/plain')

    parsed = urlparse(url)
    if parsed.scheme not in ('http', 'https'):
        return Response('Only http/https URLs allowed', status=400, content_type='text/plain')

    if ALLOWED_DOMAINS:
        domain = parsed.hostname or ''
        if not any(domain == d or domain.endswith('.' + d) for d in ALLOWED_DOMAINS):
            return Response('Domain not allowed', status=403, content_type='text/plain')

    try:
        resp = http_requests.get(url, headers=HEADERS, timeout=20, allow_redirects=True, stream=True)
    except http_requests.RequestException as e:
        return Response(f'Fetch failed: {e}', status=502, content_type='text/plain')

    content_type = resp.headers.get('Content-Type', '')

    # HTML 内容：注入 <base> 标签让资源从原站加载，并注入 page-agent
    if 'text/html' in content_type:
        html = resp.text
        final_url = resp.url  # 跟随重定向后的最终 URL

        # 计算 base href（保留到最后一个 /）
        base_href = final_url
        last_slash = base_href.rfind('/')
        if last_slash > 8:  # 保留 https://domain/
            base_href = base_href[:last_slash + 1]

        base_tag = f'<base href="{base_href}" target="_self">'

        # 注入 <base> 标签（放在 <head> 最前面）
        head_pattern = re.compile(r'(<head[^>]*>)', re.IGNORECASE)
        if head_pattern.search(html):
            html = head_pattern.sub(r'\1' + base_tag, html, count=1)
        else:
            html = base_tag + html

        # 注入 page-agent 初始化脚本（页面已经是同源，可以直接用）
        agent_script = '''
<script type="module">
if (!window.__pageAgentInjected) {
  window.__pageAgentInjected = true;
  try {
    const { PageAgent } = await import("/src/page-agent-inject.js");
  } catch(e) {
    console.warn("[page-agent proxy inject] failed:", e);
  }
}
</script>
'''
        html = html.replace('</body>', agent_script + '</body>')

        # 将页面内的同域链接改写为走代理（可选，让页面内导航也走代理）
        # 重写 <a href="..."> 中的绝对链接
        def rewrite_link(match):
            tag = match.group(1)
            attr = match.group(2)
            href = match.group(3)
            # 跳过锚点、javascript:、data: 等
            if href.startswith(('#', 'javascript:', 'data:', 'mailto:')):
                return match.group(0)
            # 绝对 URL → 走代理
            if href.startswith(('http://', 'https://')):
                return f'<{tag} {attr}="/api/browse?url={quote(href, safe="")}"'
            return match.group(0)

        html = re.sub(
            r'<(a)\s+([^>]*?href=")([^"]*)"',
            rewrite_link, html, flags=re.IGNORECASE
        )

        # 构建响应，移除阻止 iframe 嵌入的头
        proxy_resp = Response(html, status=resp.status_code, content_type='text/html; charset=utf-8')
        proxy_resp.headers.pop('X-Frame-Options', None)
        proxy_resp.headers.pop('Content-Security-Policy', None)
        return proxy_resp

    # 非 HTML 资源（CSS/JS/图片/字体等）：直接透传
    excluded_headers = {'content-encoding', 'content-length', 'transfer-encoding',
                        'connection', 'x-frame-options', 'content-security-policy'}
    headers = {k: v for k, v in resp.headers.items() if k.lower() not in excluded_headers}

    return Response(resp.content, status=resp.status_code, headers=headers, content_type=content_type)
