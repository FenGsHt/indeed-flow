#!/usr/bin/env python3
"""
OpenClaw 控制台 Web 服务
轻量级 Flask 应用
CORS enabled
"""

import os
import json
import re
import subprocess
import requests
from datetime import datetime
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
    """获取伊朗新闻 - 从RSS源抓取"""
    items = []
    
    # 尝试多个RSS源
    rss_sources = [
        ("https://feeds.bbci.co.uk/news/world/middle_east/rss.xml", "BBC"),
        ("https://www.aljazeera.com/xml/rss/all.xml", "Al Jazeera"),
    ]
    
    for rss_url, source_name in rss_sources:
        try:
            headers = {"User-Agent": "Mozilla/5.0"}
            resp = requests.get(rss_url, headers=headers, timeout=10)
            
            if resp.status_code == 200:
                # 解析XML
                import xml.etree.ElementTree as ET
                root = ET.fromstring(resp.content)
                
                # 查找所有item
                for item in root.findall('.//item')[:10]:
                    title = item.find('title')
                    desc = item.find('description')
                    link = item.find('link')
                    pub_date = item.find('pubDate')
                    
                    title_text = title.text if title is not None else ''
                    
                    # 只保留伊朗/中东相关新闻
                    if any(kw in title_text.lower() for kw in ['iran', 'israel', 'gaza', 'palestine', 'middle east', 'tehran']):
                        items.append({
                            "title": title_text[:150],
                            "summary": (desc.text[:300] + "...") if desc is not None and len(desc.text) > 300 else (desc.text if desc is not None else ''),
                            "url": link.text if link is not None else rss_url,
                            "time": pub_date.text if pub_date is not None else '',
                            "source": source_name
                        })
                        
                        if len(items) >= 8:
                            break
                
                if items:
                    break
        except Exception as e:
            print(f"RSS fetch {rss_url} error: {e}")
    
    # 如果RSS失败，尝试jina.ai直接抓取
    if not items:
        try:
            url = "https://www.ncr-iran.org/en/news/iran-news-in-brief-news/"
            jina_url = f"https://r.jina.ai/{url}"
            headers = {"User-Agent": "Mozilla/5.0"}
            resp = requests.get(jina_url, headers=headers, timeout=15)
            
            if resp.status_code == 200:
                content = resp.text
                # 简单提取：按行分割，找包含日期和关键词的段落
                paragraphs = [p.strip() for p in content.split('\n\n') if p.strip()]
                
                for para in paragraphs[:10]:
                    if any(kw in para.lower() for kw in ['iran', 'tehran', 'regime']) and len(para) > 50:
                        # 提取标题（第一行或前100字）
                        lines = para.split('\n')
                        title = lines[0][:100] if lines else para[:100]
                        summary = para[:300]
                        
                        items.append({
                            "title": title,
                            "summary": summary,
                            "url": url,
                            "time": "",
                            "source": "NCRI"
                        })
                        
                        if len(items) >= 5:
                            break
        except Exception as e:
            print(f"jina.ai fetch error: {e}")
    
    # 回退到静态文件
    if not items:
        news = load_json(NEWS_FILE, {})
        items = news.get("iran", [])
    
    # AI翻译
    for item in items:
        item['title_zh'] = ai_translate_iran_news(item.get('title', ''))
        item['summary_zh'] = ai_translate_iran_news(item.get('summary', '')[:500])
    
    return jsonify({"articles": items})


def extract_ncri_news(html):
    """从NCRI网站HTML中提取新闻条目"""
    items = []
    
    # 方法1：提取文章卡片（常见WordPress结构）
    # 查找 article 或 .post 或 .news-item 结构
    article_patterns = [
        r'<article[^>]*>.*?<h[2-4][^>]*>(.*?)</h[2-4]>.*?<div[^>]*class="[^"]*(?:excerpt|summary|content)[^"]*"[^>]*>(.*?)</div>.*?</article>',
        r'<div[^>]*class="[^"]*(?:post|entry|news-item|article)[^"]*"[^>]*>.*?<h[2-4][^>]*>(.*?)</h[2-4]>.*?<div[^>]*class="[^"]*(?:excerpt|summary|content|entry-content)[^"]*"[^>]*>(.*?)</div>.*?</div>',
    ]
    
    for pattern in article_patterns:
        matches = re.findall(pattern, html, re.DOTALL | re.IGNORECASE)
        for title_html, summary_html in matches[:10]:
            title = clean_html_tags(title_html)
            summary = clean_html_tags(summary_html)
            if title and len(title) > 10:
                items.append({
                    "title": title[:150],
                    "summary": summary[:500] if summary else title[:300],
                    "url": "https://www.ncr-iran.org/en/news/iran-news-in-brief-news/",
                    "time": "",
                    "source": "NCRI"
                })
        if items:
            break
    
    # 方法2：如果没找到，尝试提取所有段落中的新闻
    if not items:
        # 查找包含日期格式（如 March 11, 2026 或 2026-03-11）的段落
        date_pattern = r'(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}'
        paragraphs = re.findall(r'<p[^>]*>(.*?)</p>', html, re.DOTALL | re.IGNORECASE)
        
        for p in paragraphs[:20]:
            text = clean_html_tags(p)
            # 检查是否包含日期和伊朗相关关键词
            if re.search(date_pattern, text) and any(kw in text.lower() for kw in ['iran', 'tehran', 'regime', 'protest']):
                # 分割标题和正文（通常第一段是标题）
                lines = [l.strip() for l in text.split('\n') if l.strip()]
                if len(lines) >= 2:
                    title = lines[0][:150]
                    summary = ' '.join(lines[1:])[:500]
                else:
                    title = text[:150]
                    summary = text[:500]
                
                items.append({
                    "title": title,
                    "summary": summary,
                    "url": "https://www.ncr-iran.org/en/news/iran-news-in-brief-news/",
                    "time": "",
                    "source": "NCRI"
                })
                if len(items) >= 10:
                    break
    
    # 方法3：提取列表项
    if not items:
        list_items = re.findall(r'<li[^>]*>(.*?)</li>', html, re.DOTALL | re.IGNORECASE)
        for li in list_items[:15]:
            text = clean_html_tags(li)
            if any(kw in text.lower() for kw in ['iran', 'tehran', 'regime', 'protest']) and len(text) > 20:
                # 尝试提取链接
                link_match = re.search(r'href=["\']([^"\']+)["\']', li)
                link = link_match.group(1) if link_match else "https://www.ncr-iran.org/en/news/iran-news-in-brief-news/"
                
                # 分割标题和摘要
                sentences = re.split(r'(?<=[.!?])\s+', text)
                if len(sentences) >= 2:
                    title = sentences[0][:150]
                    summary = ' '.join(sentences[1:])[:500]
                else:
                    title = text[:150]
                    summary = text[:500]
                
                items.append({
                    "title": title,
                    "summary": summary,
                    "url": link if link.startswith('http') else "https://www.ncr-iran.org" + link,
                    "time": "",
                    "source": "NCRI"
                })
                if len(items) >= 10:
                    break
    
    return items[:10]


def clean_html_tags(html):
    """清理HTML标签，保留文本内容"""
    # 移除 script 和 style
    html = re.sub(r'<script[^>]*>.*?</script>', '', html, flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r'<style[^>]*>.*?</style>', '', html, flags=re.DOTALL | re.IGNORECASE)
    # 移除所有HTML标签
    text = re.sub(r'<[^>]+>', ' ', html)
    # 清理多余空白
    text = re.sub(r'\s+', ' ', text).strip()
    # 解码HTML实体
    text = text.replace('&nbsp;', ' ')
    text = text.replace('&amp;', '&')
    text = text.replace('&lt;', '<')
    text = text.replace('&gt;', '>')
    text = text.replace('&quot;', '"')
    text = text.replace('&#39;', "'")
    text = text.replace('&#x27;', "'")
    text = text.replace('&rsquo;', "'")
    text = text.replace('&lsquo;', "'")
    text = text.replace('&rdquo;', '"')
    text = text.replace('&ldquo;', '"')
    text = text.replace('&ndash;', '-')
    text = text.replace('&mdash;', '-')
    return text


def ai_translate_iran_news(text):
    """AI翻译伊朗新闻 - 基于关键词和规则的智能翻译"""
    if not text:
        return ""
    
    # 常见词汇翻译映射
    translations = {
        # 地名
        'iran': '伊朗',
        'tehran': '德黑兰',
        'israel': '以色列',
        'gaza': '加沙',
        'palestine': '巴勒斯坦',
        'middle east': '中东',
        'syria': '叙利亚',
        'lebanon': '黎巴嫩',
        'iraq': '伊拉克',
        'yemen': '也门',
        'saudi arabia': '沙特阿拉伯',
        'jordan': '约旦',
        'egypt': '埃及',
        'turkey': '土耳其',
        
        # 政治词汇
        'regime': '政权',
        'government': '政府',
        'supreme leader': '最高领袖',
        'president': '总统',
        'minister': '部长',
        'parliament': '议会',
        'sanctions': '制裁',
        'nuclear': '核',
        'deal': '协议',
        'negotiation': '谈判',
        'diplomatic': '外交',
        'embassy': '大使馆',
        
        # 冲突词汇
        'war': '战争',
        'conflict': '冲突',
        'attack': '袭击',
        'strike': '打击',
        'bomb': '炸弹',
        'missile': '导弹',
        'drone': '无人机',
        'military': '军事',
        'army': '军队',
        'force': '部队',
        'invasion': '入侵',
        'occupation': '占领',
        'resistance': '抵抗',
        'protest': '抗议',
        'demonstration': '示威',
        'uprising': '起义',
        'revolution': '革命',
        'execution': '处决',
        'prison': '监狱',
        'arrest': '逮捕',
        'detain': '拘留',
        'torture': '酷刑',
        'human rights': '人权',
        'violation': '侵犯',
        
        # 人物词汇
        'khamenei': '哈梅内伊',
        'rouhani': '鲁哈尼',
        'raisi': '莱希',
        'ahmadinejad': '内贾德',
        'mosavi': '穆萨维',
        'karroubi': '卡鲁比',
        'rajavi': '拉贾维',
        
        # 组织词汇
        'ncri': '伊朗全国抵抗委员会',
        'meK': '伊朗人民圣战组织',
        'IRGC': '伊斯兰革命卫队',
        'basij': '巴斯基民兵',
        'un': '联合国',
        'eu': '欧盟',
        'us': '美国',
        'uk': '英国',
        
        # 其他
        'news': '新闻',
        'report': '报道',
        'source': '消息来源',
        'official': '官方',
        'civilian': '平民',
        'casualty': '伤亡',
        'death': '死亡',
        'kill': '杀害',
        'injured': '受伤',
        'wounded': '受伤',
        'hostage': '人质',
        'refugee': '难民',
        'crisis': '危机',
        'sanction': '制裁',
        'economy': '经济',
        'oil': '石油',
        'gas': '天然气',
        'trade': '贸易',
        'border': '边境',
        'territory': '领土',
        'sovereignty': '主权',
        'ceasefire': '停火',
        'peace': '和平',
        'treaty': '条约',
        'agreement': '协议',
        'violation': '违反',
        'violate': '违反',
    }
    
    # 转换为小写进行匹配
    text_lower = text.lower()
    translated = text
    
    # 替换常见词汇
    for en, zh in translations.items():
        # 使用正则表达式进行单词边界匹配
        pattern = r'\b' + re.escape(en) + r'\b'
        translated = re.sub(pattern, zh, translated, flags=re.IGNORECASE)
    
    # 如果翻译后还是英文为主，添加提示
    english_chars = len(re.findall(r'[a-zA-Z]', translated))
    total_chars = len(re.findall(r'[\u4e00-\u9fff]', translated)) + english_chars
    
    if total_chars > 0 and english_chars / total_chars > 0.5:
        # 英文占比高，添加说明
        translated = f"[原文] {text}\n\n[AI翻译] {translated}"
    
    return translated


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
    """获取新闻 AI 总结 - 使用已有热点数据"""
    from datetime import datetime
    
    try:
        # 使用已有的热点数据
        hot_data = get_hot_news().get_json()
        
        # 提取热点标题生成摘要
        hot_titles = []
        for source in hot_data.get('sources', []):
            for item in source.get('items', [])[:3]:  # 每个平台取前3个
                title = item.get('title', '')
                if title and len(title) > 5:
                    hot_titles.append(f"[{source['name']}] {title[:25]}")
        
        # 公共热点
        public_titles = []
        for pub in hot_data.get('public', [])[:5]:
            topic = pub.get('topic', '')
            if topic:
                platforms = ', '.join(pub.get('platforms', []))
                public_titles.append(f"{topic}（{platforms}）")
        
        # 生成摘要文本
        hot_summary = "今日热点 TOP10：\n" + "\n".join(hot_titles[:10]) if hot_titles else "暂无热点数据"
        public_summary = "公共热点（多平台关注）：\n" + "\n".join(public_titles[:5]) if public_titles else "暂无公共热点"
        
        # 获取伊朗新闻
        iran_data = get_iran_news().get_json()
        iran_articles = iran_data.get('articles', [])[:3]
        iran_titles = [a.get('title_zh', a.get('title', ''))[:30] for a in iran_articles if a.get('title')]
        iran_summary = "伊朗/中东最新：\n" + "\n".join(iran_titles) if iran_titles else "暂无伊朗新闻"
        
        return jsonify({
            "date": datetime.now().strftime("%Y-%m-%d"),
            "updated": datetime.now().strftime("%Y-%m-%d %H:%M"),
            "iran": {"title": "🇮🇷 伊朗/中东局势", "summary": iran_summary},
            "hot": {"title": "🔥 今日热点", "summary": hot_summary},
            "public": {"title": "🌐 公共热点", "summary": public_summary}
        })
    except Exception as e:
        print(f"Summary error: {e}")
        return jsonify({
            "date": datetime.now().strftime("%Y-%m-%d"),
            "updated": datetime.now().strftime("%Y-%m-%d %H:%M"),
            "iran": {"title": "🇮🇷 伊朗/中东局势", "summary": "加载失败，请查看具体新闻"},
            "hot": {"title": "🔥 今日热点", "summary": "加载失败，请查看热点列表"},
            "public": {"title": "🌐 公共热点", "summary": "加载失败"}
        })


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


# ============== Steam 联机游戏推荐 ==============

STEAM_API_KEY = os.getenv('STEAM_API_KEY', '')

@app.route("/api/steam/recommendations", methods=["GET"])
def get_steam_recommendations():
    """获取每日 Steam 联机游戏推荐（5款）"""
    from games_api import get_db
    
    conn = get_db()
    try:
        cursor = conn.cursor()
        
        # 获取今天已展示的游戏
        today = datetime.now().strftime('%Y-%m-%d')
        cursor.execute(
            "SELECT * FROM steam_games WHERE last_shown_date = %s ORDER BY weight DESC LIMIT 5",
            (today,)
        )
        today_games = cursor.fetchall()
        
        if today_games and len(today_games) >= 5:
            # 今天已经有推荐，直接返回
            games = []
            for row in today_games:
                games.append({
                    "id": row[0],
                    "name": row[1],
                    "steam_id": row[2],
                    "price": float(row[3]) if row[3] else 0,
                    "original_price": float(row[4]) if row[4] else 0,
                    "discount_percent": row[5] or 0,
                    "image_url": row[6],
                    "is_new": row[8] is None or row[8] == today,  # 首次展示
                    "steam_url": f"https://store.steampowered.com/app/{row[2]}" if row[2] else ""
                })
            return jsonify({"success": True, "games": games, "date": today})
        
        # 需要生成新的推荐
        # 优先选择未展示过的游戏，按权重排序
        cursor.execute(
            "SELECT * FROM steam_games WHERE last_shown_date IS NULL OR last_shown_date < %s "
            "ORDER BY weight DESC, show_count ASC LIMIT 5",
            (today,)
        )
        new_games = cursor.fetchall()
        
        if len(new_games) < 5:
            # 如果不够5个，从已展示过的游戏中补充（权重最低的）
            cursor.execute(
                "SELECT * FROM steam_games WHERE last_shown_date IS NOT NULL "
                "ORDER BY weight ASC, show_count ASC LIMIT %s",
                (5 - len(new_games),)
            )
            additional_games = cursor.fetchall()
            new_games = list(new_games) + list(additional_games)
        
        # 更新这些游戏的展示记录
        games = []
        for row in new_games[:5]:
            game_id = row[0]
            is_first_show = row[8] is None  # last_shown_date
            
            # 更新展示记录
            cursor.execute(
                "UPDATE steam_games SET last_shown_date = %s, show_count = show_count + 1, "
                "weight = GREATEST(10, weight - 10) WHERE id = %s",
                (today, game_id)
            )
            
            games.append({
                "id": game_id,
                "name": row[1],
                "steam_id": row[2],
                "price": float(row[3]) if row[3] else 0,
                "original_price": float(row[4]) if row[4] else 0,
                "discount_percent": row[5] or 0,
                "image_url": row[6],
                "is_new": is_first_show,
                "steam_url": f"https://store.steampowered.com/app/{row[2]}" if row[2] else ""
            })
        
        conn.commit()
        return jsonify({"success": True, "games": games, "date": today})
        
    except Exception as e:
        print(f"Get recommendations error: {e}")
        return jsonify({"success": False, "error": str(e)}), 500
    finally:
        conn.close()


@app.route("/api/steam/fetch", methods=["POST"])
def fetch_steam_games():
    """手动触发抓取 Steam 联机游戏"""
    try:
        # Steam Store API - 获取热门游戏列表
        # 使用 SteamSpy API 获取联机游戏
        url = "https://steamspy.com/api.php?request=tag&tag=Online+Multiplayer"
        resp = requests.get(url, timeout=30)
        
        if resp.status_code != 200:
            return jsonify({"success": False, "error": "Failed to fetch from SteamSpy"}), 500
        
        games_data = resp.json()
        
        from games_api import get_db
        conn = get_db()
        try:
            cursor = conn.cursor()
            added_count = 0
            
            for app_id, game_info in list(games_data.items())[:50]:  # 取前50个
                try:
                    name = game_info.get('name', '')
                    if not name or len(name) < 2:
                        continue
                    
                    # 获取价格信息
                    price = game_info.get('price', 0) / 100 if game_info.get('price') else 0  # 转换为元
                    discount = game_info.get('discount', 0)
                    
                    # 获取图片 URL
                    image_url = f"https://cdn.cloudflare.steamstatic.com/steam/apps/{app_id}/header.jpg"
                    
                    # 检查是否已存在
                    cursor.execute("SELECT id FROM steam_games WHERE steam_id = %s", (app_id,))
                    if cursor.fetchone():
                        continue
                    
                    # 插入新游戏
                    cursor.execute(
                        "INSERT INTO steam_games (name, steam_id, price, original_price, discount_percent, image_url) "
                        "VALUES (%s, %s, %s, %s, %s, %s)",
                        (name, app_id, price * (100 - discount) / 100 if discount else price, 
                         price, discount, image_url)
                    )
                    added_count += 1
                    
                except Exception as e:
                    print(f"Error processing game {app_id}: {e}")
                    continue
            
            conn.commit()
            return jsonify({"success": True, "added": added_count})
            
        finally:
            conn.close()
            
    except Exception as e:
        print(f"Fetch steam games error: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


# ============== 启动 ==============

if __name__ == "__main__":
    print("OpenClaw 控制台启动中...")
    print("访问: http://0.0.0.0:5001")
    init_db()
    app.run(host="0.0.0.0", port=5001, debug=True)
