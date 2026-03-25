#!/usr/bin/env python3
"""
跨设备剪贴板同步 API
GET  /api/clipboard        → 获取最新内容（或历史列表）
POST /api/clipboard        → 推送新内容
GET  /api/clipboard/history → 获取最近 10 条历史
"""

import os
import json
from datetime import datetime
from pathlib import Path
from flask import Blueprint, request, jsonify

clipboard_bp = Blueprint('clipboard', __name__)

CLIPBOARD_FILE = Path(__file__).parent / 'data' / 'clipboard.json'
MAX_HISTORY = 10

CLIPBOARD_API_KEY = os.getenv('CLIPBOARD_API_KEY', '')


def _check_auth():
    if not CLIPBOARD_API_KEY:
        return True  # 未配置 key 则不鉴权（仅内网/tunnel 场景）
    return request.headers.get('X-API-Key') == CLIPBOARD_API_KEY


def _load():
    if CLIPBOARD_FILE.exists():
        try:
            return json.loads(CLIPBOARD_FILE.read_text(encoding='utf-8'))
        except Exception:
            pass
    return []


def _save(history):
    CLIPBOARD_FILE.parent.mkdir(exist_ok=True)
    CLIPBOARD_FILE.write_text(
        json.dumps(history, ensure_ascii=False, indent=2),
        encoding='utf-8'
    )


@clipboard_bp.route('/api/clipboard', methods=['GET', 'POST'])
def clipboard():
    if not _check_auth():
        return jsonify({'error': 'unauthorized'}), 401

    history = _load()

    if request.method == 'POST':
        data = request.get_json(silent=True) or {}
        content = str(data.get('content', '')).strip()
        if not content:
            return jsonify({'error': 'empty content'}), 400

        entry = {
            'content': content,
            'time': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'source': data.get('source', 'unknown'),  # 'pc' / 'phone' / etc.
        }
        history.insert(0, entry)
        history = history[:MAX_HISTORY]
        _save(history)
        return jsonify({'status': 'ok', 'entry': entry})

    # GET → 返回最新一条
    if history:
        return jsonify(history[0])
    return jsonify({'content': '', 'time': '', 'source': ''})


@clipboard_bp.route('/api/clipboard/history', methods=['GET'])
def clipboard_history():
    if not _check_auth():
        return jsonify({'error': 'unauthorized'}), 401
    return jsonify(_load())


@clipboard_bp.route('/api/clipboard/clear', methods=['POST'])
def clipboard_clear():
    if not _check_auth():
        return jsonify({'error': 'unauthorized'}), 401
    _save([])
    return jsonify({'status': 'ok'})
