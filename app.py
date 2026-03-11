#!/usr/bin/env python3
"""
OpenClaw 控制台 Web 服务
轻量级 Flask 应用
CORS enabled
"""

import json
import re
import subprocess
import requests
from collections import Counter
from flask import Flask, jsonify, request, send_file
from flask_cors import CORS
from pathlib import Path

from games_api import games_bp, init_db

app = Flask(__name__, template_folder='.')
CORS(app)

# 挂载游戏模块 Blueprint（所有 /api/games、/api/bookmarks 等路由）
app.register_blueprint(games_bp)

DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(exist_ok=True)

SKILLS_FILE = DATA_DIR / "skills.json"
NEWS_FILE = DATA_DIR / "news.json"


def load_json(filepath, default=None):
    if default is None:
        default = []
    if filepath.exists():
        with open(filepath, "r", encoding="utf-8") as f:
            return json.load(f)
    return default


def save_json(filepath, data):
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


# ============== 页面路由 ==============

@app.route("/")
def index():
    return send_file('index.html')


@app.route("/console")
def console():
    return send_file('index.html')


@app.route("/skill")
def skill_page():
    return send_file('index.html')


@app.route("/games")
def games_page():
    return send_file('index.html')


@app.route("/news")
def news_page():
    return send_file('index.html')


# ============== API: 技能管理 ==============

@app.route("/api/skills", methods=["GET"])
def get_skills():
    skills = load_json(SKILLS_FILE, [
        {"id": "games-backlog", "name": "待玩游戏", "description": "记录想玩的游戏，支持评分和留言", "enabled": True, "icon": "🎮"},
        {"id": "weather", "name": "天气查询", "description": "查询任意城市的天气和预报", "enabled": True, "icon": "🌤️"},
        {"id": "translator", "name": "翻译助手", "description": "多语言翻译工具", "enabled": False, "icon": "🌐"},
    ])
    return jsonify(skills)


@app.route("/api/skills/<skill_id>", methods=["PUT"])
def update_skill(skill_id):
    skills = load_json(SKILLS_FILE)
    data = request.json
    for skill in skills:
        if skill["id"] == skill_id:
            skill.update(data)
            save_json(SKILLS_FILE, skills)
            return jsonify({"success": True, "skill": skill})
    return jsonify({"success": False, "error": "未找到技能"}), 404


@app.route("/api/skills", methods=["POST"])
def add_skill():
    skills = load_json(SKILLS_FILE, [])
    data = request.json
    data["id"] = data.get("id") or f"skill-{len(skills) + 1}"
    data["enabled"] = data.get("enabled", True)
    skills.append(data)
    save_json(SKILLS_FILE, skills)
    return jsonify({"success": True, "skill": data})


# ============== API: 新闻专区 - 实时抓取 ==============

def fetch_tieba():
    """获取贴吧热点"""
    try:
        url = "https://tieba.baidu.com/hottopic/browse?pn=1"
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        }
        resp = requests.get(url, headers=headers, timeout=15)
        resp.encoding = 'utf-8'
        html = resp.text
        
        items = []
        
        # 尝试多种模式匹配
        # 模式1: topic-item 卡片
        pattern1 = r'<div[^>]*class="topic-item[^"]*"[^>]*>.*?<a[^>]*href="([^"]*topic/[^"]*)"[^>]*>(.*?)</a>'
        matches = re.findall(pattern1, html, re.DOTALL)
        
        # 模式2: 直接匹配话题标题
        if not matches:
            pattern2 = r'"topic_name":"([^"]+)"'
            titles = re.findall(pattern2, html)
            for title in titles[:10]:
                items.append({
                    "title": title.encode('utf-8').decode('unicode_escape') if '\\u' in title else title,
                    "url": f"https://tieba.baidu.com/hottopic/browse?keyword={title}"
                })
        else:
            for match in matches[:10]:
                link, title = match
                title = re.sub(r'<[^>]+>', '', title).strip()
                if title and len(title) > 3:
                    items.append({
                        "title": title,
                        "url": "https://tieba.baidu.com" + link if link.startswith('/') else link
                    })
        
        # 模式3: 从JSON数据中提取
        if not items:
            pattern3 = r'"topic_list":(\[.*?\])'
            json_match = re.search(pattern3, html)
            if json_match:
                try:
                    topics = json.loads(json_match.group(1))
                    for topic in topics[:10]:
                        title = topic.get('topic_name', '') or topic.get('title', '')
                        if title:
                            items.append({
                                "title": title,
                                "url": topic.get('topic_url', f"https://tieba.baidu.com/hottopic/browse?keyword={title}")
                            })
                except:
                    pass
        
        return items if items else [{"title": "获取失败", "url": ""}]
    except Exception as e:
        print(f"Tieba fetch error: {e}")
        return [{"title": "获取失败", "url": ""}]


def fetch_weibo():
    """获取微博热搜"""
    try:
        url = "https://weibo.com/ajax/side/hotSearch"
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": "https://weibo.com/"
        }
        resp = requests.get(url, headers=headers, timeout=10)
        data = resp.json()
        
        items = []
        if data.get('data', {}).get('realtime'):
            for item in data['data']['realtime'][:10]:
                title = item.get('word', '')
                if title:
                    items.append({
                        "title": title,
                        "url": f"https://s.weibo.com/weibo?q=%23{title}%23"
                    })
        
        return items if items else [{"title": "获取失败", "url": ""}]
    except Exception as e:
        print(f"Weibo fetch error: {e}")
        return [{"title": "获取失败", "url": ""}]


def fetch_bilibili():
    """获取B站热点"""
    try:
        url = "https://api.bilibili.com/x/web-interface/popular"
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": "https://www.bilibili.com/"
        }
        resp = requests.get(url, headers=headers, timeout=10)
        data = resp.json()
        
        items = []
        if data.get('data', {}).get('list'):
            for item in data['data']['list'][:10]:
                title = item.get('title', '')
                bvid = item.get('bvid', '')
                if title:
                    items.append({
                        "title": title,
                        "url": f"https://www.bilibili.com/video/{bvid}"
                    })
        
        return items if items else [{"title": "获取失败", "url": ""}]
    except Exception as e:
        print(f"Bilibili fetch error: {e}")
        return [{"title": "获取失败", "url": ""}]


def fetch_douyin():
    """获取抖音热点"""
    try:
        url = "https://www.douyin.com/aweme/v1/web/hot/search/list/"
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": "https://www.douyin.com/"
        }
        resp = requests.get(url, headers=headers, timeout=10)
        data = resp.json()
        
        items = []
        if data.get('data', {}).get('word_list'):
            for item in data['data']['word_list'][:10]:
                title = item.get('word', '')
                if title:
                    items.append({
                        "title": title,
                        "url": f"https://www.douyin.com/search/{title}"
                    })
        
        return items if items else [{"title": "获取失败", "url": ""}]
    except Exception as e:
        print(f"Douyin fetch error: {e}")
        return [{"title": "获取失败", "url": ""}]


def fetch_xiaohongshu():
    """获取小红书热点"""
    try:
        # 小红书没有公开API，使用搜索页面
        url = "https://www.xiaohongshu.com/explore"
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        }
        resp = requests.get(url, headers=headers, timeout=10)
        html = resp.text
        
        items = []
        # 尝试提取热门话题
        pattern = r'"name":"([^"]{3,30})"[^}]*"link":"([^"]*)"'
        matches = re.findall(pattern, html)
        
        for name, link in matches[:10]:
            if name and len(name) > 3:
                items.append({
                    "title": name,
                    "url": link if link.startswith('http') else f"https://www.xiaohongshu.com/search_result?keyword={name}"
                })
        
        return items if items else [{"title": "获取失败", "url": ""}]
    except Exception as e:
        print(f"Xiaohongshu fetch error: {e}")
        return [{"title": "获取失败", "url": ""}]


def calculate_public_hotspots(sources):
    """计算公共热点 - 出现在≥2个平台的相同话题"""
    # 收集所有标题并标准化
    title_to_platforms = {}
    
    platform_names = {
        'tieba': '贴吧',
        'weibo': '微博', 
        'bilibili': 'B站',
        'douyin': '抖音',
        'xiaohongshu': '小红书'
    }
    
    for platform, items in sources.items():
        if platform == 'public':
            continue
        for item in items:
            title = item.get('title', '')
            if title and title != '获取失败':
                # 标准化标题（去除标点、空格，转小写）
                normalized = re.sub(r'[^\w\u4e00-\u9fff]', '', title).lower()
                if normalized:
                    if normalized not in title_to_platforms:
                        title_to_platforms[normalized] = {
                            'title': title,
                            'platforms': []
                        }
                    if platform_names.get(platform) not in title_to_platforms[normalized]['platforms']:
                        title_to_platforms[normalized]['platforms'].append(platform_names.get(platform))
    
    # 找出出现在≥2个平台的
    public_hotspots = []
    for normalized, info in title_to_platforms.items():
        if len(info['platforms']) >= 2:
            public_hotspots.append({
                'topic': info['title'],
                'platforms': info['platforms']
            })
    
    # 按平台数量排序
    public_hotspots.sort(key=lambda x: len(x['platforms']), reverse=True)
    return public_hotspots[:10]


@app.route("/api/news/hot", methods=["GET"])
def get_hot_news():
    """实时获取各平台热点"""
    # 获取各平台数据
    sources = {
        "tieba": fetch_tieba(),
        "weibo": fetch_weibo(),
        "bilibili": fetch_bilibili(),
        "douyin": fetch_douyin(),
        "xiaohongshu": fetch_xiaohongshu()
    }
    
    # 计算公共热点
    public_hotspots = calculate_public_hotspots(sources)
    
    return jsonify({
        "tieba": sources["tieba"],
        "weibo": sources["weibo"],
        "bilibili": sources["bilibili"],
        "douyin": sources["douyin"],
        "xiaohongshu": sources["xiaohongshu"],
        "public": public_hotspots,
        "updated": subprocess.check_output(['date', '+%Y-%m-%d %H:%M']).decode().strip()
    })


@app.route("/api/news/iran", methods=["GET"])
def get_iran_news():
    """获取伊朗新闻 - 从静态文件或实时抓取"""
    try:
        # 尝试从BBC RSS获取最新伊朗新闻
        url = "https://feeds.bbci.co.uk/news/world/middle_east/rss.xml"
        headers = {"User-Agent": "Mozilla/5.0"}
        resp = requests.get(url, headers=headers, timeout=10)
        
        # 解析XML提取伊朗相关新闻
        import xml.etree.ElementTree as ET
        root = ET.fromstring(resp.content)
        
        items = []
        for item in root.findall('.//item')[:10]:
            title = item.find('title')
            desc = item.find('description')
            link = item.find('link')
            pub_date = item.find('pubDate')
            
            title_text = title.text if title is not None else ''
            # 只保留伊朗相关新闻
            if 'iran' in title_text.lower() or 'israel' in title_text.lower() or 'gaza' in title_text.lower():
                items.append({
                    "title": title_text,
                    "summary": desc.text[:200] + "..." if desc is not None and len(desc.text) > 200 else (desc.text if desc is not None else ''),
                    "url": link.text if link is not None else '',
                    "time": pub_date.text if pub_date is not None else '',
                    "source": "BBC"
                })
        
        if items:
            return jsonify({"articles": items})
    except Exception as e:
        print(f"Iran news fetch error: {e}")
    
    # 回退到静态文件
    news = load_json(NEWS_FILE, {})
    return jsonify({"articles": news.get("iran", [])})


@app.route("/api/news/refresh", methods=["POST"])
def refresh_news():
    try:
        subprocess.run(
            ["python3", "/home/node/.openclaw/workspace-work-agent/scripts/news_aggregator.py"],
            capture_output=True, text=True, timeout=60
        )
        news_file = Path("/tmp/news_data.json")
        if news_file.exists():
            with open(news_file, "r", encoding="utf-8") as f:
                news_data = json.load(f)
            save_json(NEWS_FILE, news_data)
            return jsonify({"success": True, "message": "新闻更新成功"})
        return jsonify({"success": True, "message": "脚本已运行"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/news/summary", methods=["GET"])
def get_news_summary():
    summary_file = DATA_DIR / "daily_summary.json"
    summary = load_json(summary_file, {
        "date": "",
        "updated": "",
        "iran": {"title": "伊朗/中东局势", "summary": "暂无摘要"},
        "hot": {"title": "今日热点", "summary": "暂无摘要"},
        "public": {"title": "公共热点", "summary": "暂无摘要"}
    })
    return jsonify(summary)


@app.route("/api/news/summary/regenerate", methods=["POST"])
def regenerate_summary():
    try:
        result = subprocess.run(
            ["python3", "/home/node/.openclaw/workspace-work-agent/scripts/ai_news_summary.py"],
            capture_output=True, text=True, timeout=60,
            cwd="/home/node/.openclaw/workspace-work-agent"
        )
        if result.returncode == 0:
            return jsonify({"success": True, "message": "摘要生成成功"})
        return jsonify({"success": False, "error": result.stderr}), 500
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/news/summary/item", methods=["POST"])
def get_news_item_summary():
    """单个热点新闻的AI总结 - 尝试抓取原文内容进行总结"""
    data = request.json
    title = data.get('title', '')
    url = data.get('url', '')
    source = data.get('source', '')
    
    if not title:
        return jsonify({"success": False, "error": "No title provided"}), 400
    
    # 尝试抓取网页内容进行总结
    content = None
    if url:
        try:
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            }
            resp = requests.get(url, headers=headers, timeout=10)
            resp.encoding = resp.apparent_encoding or 'utf-8'
            html = resp.text
            
            # 提取正文内容（简单策略）
            content = extract_text_from_html(html)
            
            if content and len(content) > 50:
                # 使用原文内容生成总结
                summary = generate_content_summary(title, content, source)
                return jsonify({
                    "success": True,
                    "title": title,
                    "summary": summary,
                    "source": source,
                    "from_url": True
                })
        except Exception as e:
            print(f"Failed to fetch URL content: {e}")
    
    # 抓取失败，回退到标题总结
    summary = generate_title_summary(title, source)
    return jsonify({
        "success": True,
        "title": title,
        "summary": summary,
        "source": source,
        "from_url": False
    })


def extract_text_from_html(html):
    """从HTML中提取正文内容"""
    # 移除脚本和样式
    html = re.sub(r'<script[^>]*>.*?</script>', '', html, flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r'<style[^>]*>.*?</style>', '', html, flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r'<noscript[^>]*>.*?</noscript>', '', html, flags=re.DOTALL | re.IGNORECASE)
    
    # 尝试提取 article 或 main 内容
    article_match = re.search(r'<article[^>]*>(.*?)</article>', html, re.DOTALL | re.IGNORECASE)
    if article_match:
        html = article_match.group(1)
    else:
        main_match = re.search(r'<main[^>]*>(.*?)</main>', html, re.DOTALL | re.IGNORECASE)
        if main_match:
            html = main_match.group(1)
    
    # 移除HTML标签
    text = re.sub(r'<[^>]+>', ' ', html)
    
    # 清理空白
    text = re.sub(r'\s+', ' ', text)
    text = text.strip()
    
    # 解码HTML实体
    text = text.replace('&nbsp;', ' ')
    text = text.replace('&amp;', '&')
    text = text.replace('&lt;', '<')
    text = text.replace('&gt;', '>')
    text = text.replace('&quot;', '"')
    text = text.replace('&#39;', "'")
    
    # 限制长度
    if len(text) > 2000:
        text = text[:2000] + '...'
    
    return text


def generate_content_summary(title, content, source):
    """基于网页内容生成AI总结"""
    parts = []
    parts.append(f"📌 热点标题：{title}")
    
    # 分析内容关键词
    keywords = []
    content_lower = content.lower()
    
    if any(word in content_lower for word in ['宣布', '发布', '推出', '上线', '开启', '发布', '正式']):
        keywords.append("这是关于产品/功能发布的消息")
    if any(word in content_lower for word in ['曝光', '爆料', '泄露', '传闻', '网传']):
        keywords.append("这是爆料/传闻类消息")
    if any(word in content_lower for word in ['回应', '回复', '道歉', '声明', '澄清']):
        keywords.append("这是官方或当事人的回应声明")
    if any(word in content_lower for word in ['夺冠', '获胜', '晋级', '淘汰', '冠军', '决赛']):
        keywords.append("这是赛事/竞技相关消息")
    if any(word in content_lower for word in ['涨价', '降价', '优惠', '促销', '免费', '折扣']):
        keywords.append("这是价格变动/促销信息")
    if any(word in content_lower for word in ['结婚', '离婚', '恋爱', '分手', '官宣', '公开']):
        keywords.append("这是明星/名人情感相关消息")
    if any(word in content_lower for word in ['去世', '逝世', '离世', '病故', '逝世']):
        keywords.append("这是一条讣告消息")
    if any(word in content_lower for word in ['地震', '火灾', '事故', '灾难', '爆炸', '坍塌']):
        keywords.append("这是突发事件/灾害消息")
    if any(word in content_lower for word in ['战争', '冲突', '袭击', '导弹', '军队', '部队']):
        keywords.append("这是军事/冲突相关消息")
    if any(word in content_lower for word in ['政府', '总统', '总理', '议员', '法律', '法案']):
        keywords.append("这是政治相关消息")
    if any(word in content_lower for word in ['公司', '股票', '市值', '融资', '上市', '财报']):
        keywords.append("这是商业/财经相关消息")
    
    if keywords:
        parts.append(f"🔍 内容类型：{'；'.join(keywords)}")
    
    # 提取内容摘要（取前300字）
    content_snippet = content[:300] if len(content) > 300 else content
    parts.append(f"📝 内容摘要：{content_snippet}")
    
    # 添加来源信息
    parts.append(f"📰 来源平台：{source}")
    
    # 添加建议
    parts.append("💡 点击查看详情了解更多信息")
    
    return "\n\n".join(parts)


def generate_title_summary(title, source):
    """基于热点标题生成AI总结"""
    # 分析标题关键词
    keywords = []
    
    # 常见热点类型分析
    if any(word in title for word in ['宣布', '发布', '推出', '上线', '开启']):
        keywords.append("这是一条关于新产品/功能发布的消息")
    if any(word in title for word in ['曝光', '爆料', '泄露', '传闻']):
        keywords.append("这是一条爆料/传闻类消息")
    if any(word in title for word in ['回应', '回复', '道歉', '声明']):
        keywords.append("这是官方或当事人的回应声明")
    if any(word in title for word in ['夺冠', '获胜', '晋级', '淘汰']):
        keywords.append("这是赛事/竞技相关消息")
    if any(word in title for word in ['涨价', '降价', '优惠', '促销']):
        keywords.append("这是价格变动/促销信息")
    if any(word in title for word in ['结婚', '离婚', '恋爱', '分手', '官宣']):
        keywords.append("这是明星/名人情感相关消息")
    if any(word in title for word in ['去世', '逝世', '离世', '病故']):
        keywords.append("这是一条讣告消息")
    if any(word in title for word in ['地震', '火灾', '事故', '灾难']):
        keywords.append("这是突发事件/灾害消息")
    
    # 构建总结
    parts = []
    parts.append(f"📌 热点标题：{title}")
    
    if keywords:
        parts.append(f"🔍 内容类型：{'；'.join(keywords)}")
    
    # 添加来源信息
    parts.append(f"📰 来源平台：{source}")
    
    # 添加建议
    parts.append("💡 点击查看详情了解更多信息")
    
    return "\n\n".join(parts)


# ============== 启动 ==============

if __name__ == "__main__":
    print("OpenClaw 控制台启动中...")
    print("访问: http://0.0.0.0:5001")
    init_db()
    app.run(host="0.0.0.0", port=5001, debug=True)
