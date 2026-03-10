#!/usr/bin/env python3
"""
OpenClaw 控制台 Web 服务
轻量级 Flask 应用
CORS enabled
"""

import json
import subprocess
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


# ============== API: 新闻专区 ==============

@app.route("/api/news/hot", methods=["GET"])
def get_hot_news():
    news = load_json(NEWS_FILE, {})
    return jsonify({
        "tieba": news.get("tieba", ["加载中..."]),
        "weibo": news.get("weibo", ["加载中..."]),
        "bilibili": news.get("bilibili", ["加载中..."]),
        "douyin": news.get("douyin", ["加载中..."]),
        "xiaohongshu": news.get("xiaohongshu", ["加载中..."]),
        "public": news.get("public", [])
    })


@app.route("/api/news/iran", methods=["GET"])
def get_iran_news():
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


# ============== 启动 ==============

if __name__ == "__main__":
    print("OpenClaw 控制台启动中...")
    print("访问: http://0.0.0.0:5001")
    init_db()
    app.run(host="0.0.0.0", port=5001, debug=True)
