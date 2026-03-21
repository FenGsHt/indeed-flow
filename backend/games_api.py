#!/usr/bin/env python3
"""
待玩游戏后端 API - Blueprint 版本
"""

import json
import uuid
import re
import time
import threading
import urllib.request
import urllib.parse
import os
import base64
from datetime import datetime
from flask import Blueprint, jsonify, request
import pymysql

# 加载 .env 文件（如果存在）
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# 2026-03-19: 使用共享连接池替代每次 pymysql.connect()
from db_pool import get_db

games_bp = Blueprint('games', __name__)

# 2026-03-19: 原先硬编码在 URL 里，改为从环境变量读取
RAWG_API_KEY = os.getenv('RAWG_API_KEY', '')

# ============ Steam 评分后端缓存 ============
# { cache_key: {'data': {...}, 'ts': timestamp} }
_steam_rating_cache = {}
STEAM_RATING_CACHE_TTL = 24 * 3600  # 24 小时

# ============ Steam 价格后端缓存 ============
_steam_price_cache = {}
STEAM_PRICE_CACHE_TTL = 6 * 3600  # 6 小时（价格变动比评分频繁）


def init_db():
    """初始化数据库表"""
    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS games (
                id VARCHAR(36) PRIMARY KEY,
                name VARCHAR(255) NOT NULL DEFAULT '',
                image TEXT,
                created_by VARCHAR(100),
                password VARCHAR(100),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                ratings JSON,
                comments JSON,
                status VARCHAR(20) DEFAULT 'wishlist',
                source VARCHAR(255),
                bookmarked JSON
            )
        ''')
        columns_to_add = [
            ("password", "VARCHAR(100)"),
            ("status", "VARCHAR(20) DEFAULT 'wishlist'"),
            ("source", "VARCHAR(255)"),
            ("bookmarked", "JSON"),
            ("priority", "INT DEFAULT 100"),
            ("recommender", "VARCHAR(100)"),
            ("notes", "TEXT"),
            ("steam_appid", "VARCHAR(20)"),
        ]
        cursor.execute("SELECT DATABASE()")
        db_name = cursor.fetchone()[0]
        for col, col_def in columns_to_add:
            cursor.execute(
                "SELECT COUNT(*) FROM information_schema.COLUMNS "
                "WHERE TABLE_SCHEMA=%s AND TABLE_NAME='games' AND COLUMN_NAME=%s",
                (db_name, col)
            )
            if cursor.fetchone()[0] == 0:
                cursor.execute(f"ALTER TABLE games ADD COLUMN {col} {col_def}")
        
        # 迁移：把 image 字段从 VARCHAR(512) 改为 TEXT（支持 base64 图片）
        cursor.execute(
            "SELECT COUNT(*) FROM information_schema.COLUMNS "
            "WHERE TABLE_SCHEMA=%s AND TABLE_NAME='games' AND COLUMN_NAME='image' AND COLUMN_TYPE='varchar(512)'",
            (db_name,)
        )
        if cursor.fetchone()[0] > 0:
            cursor.execute("ALTER TABLE games MODIFY COLUMN image TEXT")
            print("Migrated image column to TEXT for base64 support")
        
        # 创建 Steam 联机游戏推荐表
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS steam_games (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                steam_id VARCHAR(50) UNIQUE,
                price DECIMAL(10, 2) DEFAULT 0,
                original_price DECIMAL(10, 2) DEFAULT 0,
                discount_percent INT DEFAULT 0,
                image_url VARCHAR(512),
                is_online_multiplayer BOOLEAN DEFAULT TRUE,
                last_shown_date DATE,
                show_count INT DEFAULT 0,
                weight INT DEFAULT 100,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        conn.commit()
    finally:
        conn.close()


# ============ 收藏功能 ============

@games_bp.route('/api/bookmarks', methods=['GET'])
def get_bookmarks():
    conn = get_db()
    try:
        cursor = conn.cursor(pymysql.cursors.DictCursor)
        cursor.execute('SELECT bookmarked FROM games WHERE id = "bookmarks"')
        row = cursor.fetchone()
    finally:
        conn.close()

    if row and row.get('bookmarked'):
        return jsonify(json.loads(row['bookmarked']))
    return jsonify([])


# ============ 图片上传处理 ============

def convert_url_to_base64(image_url):
    """将图片URL转换为base64"""
    if not image_url:
        return ''
    
    # 如果已经是base64数据（data:URL格式），直接返回
    if image_url.startswith('data:'):
        return image_url
    
    # 如果是URL，下载并转换为base64
    if image_url.startswith('http'):
        try:
            req = urllib.request.Request(image_url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=10) as response:
                img_data = response.read()
                content_type = response.headers.get('Content-Type', 'image/jpeg')
                ext = content_type.split('/')[-1]
                if ext == 'jpg':
                    ext = 'jpeg'
                if ext not in ['jpeg', 'png', 'gif', 'webp']:
                    ext = 'jpeg'
                b64 = base64.b64encode(img_data).decode('utf-8')
                return f'data:image/{ext};base64,{b64}'
        except Exception as e:
            print(f"Image download error: {e}")
            return ''
    
    return image_url


@games_bp.route('/api/upload-image', methods=['POST'])
def upload_image():
    """处理图片上传，转换为base64"""
    if 'image' not in request.files:
        # 检查是否是base64字符串或URL
        # 2026-03-19: 原先 request.json 不安全，非 JSON 请求会抛异常
        # data = request.json
        data = request.get_json(silent=True) or {}
        if data and 'image' in data:
            b64_image = convert_url_to_base64(data['image'])
            return jsonify({'success': True, 'image': b64_image})
        return jsonify({'success': False, 'error': 'No image provided'}), 400
    
    file = request.files['image']
    if file.filename == '':
        return jsonify({'success': False, 'error': 'No file selected'}), 400
    
    # 读取图片并转换为base64
    try:
        img_data = file.read()
        ext = file.filename.split('.')[-1].lower() if '.' in file.filename else 'jpeg'
        if ext not in ['jpg', 'jpeg', 'png', 'gif', 'webp']:
            ext = 'jpeg'
        b64 = base64.b64encode(img_data).decode('utf-8')
        mime_type = f'image/{ext}' if ext != 'jpg' else 'image/jpeg'
        return jsonify({
            'success': True, 
            'image': f'data:{mime_type};base64,{b64}'
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# ============ 收藏功能 ============

@games_bp.route('/api/bookmarks', methods=['POST'])
def add_bookmark():
    data = request.get_json(silent=True) or {}
    news_item = {
        'id': data.get('id'),
        'title': data.get('title'),
        'summary': data.get('summary'),
        'url': data.get('url'),
        'source': data.get('source'),
        'bookmarked_at': datetime.now().isoformat()
    }

    conn = get_db()
    try:
        cursor = conn.cursor(pymysql.cursors.DictCursor)
        cursor.execute('SELECT bookmarked FROM games WHERE id = "bookmarks"')
        row = cursor.fetchone()

        bookmarks = []
        if row and row.get('bookmarked'):
            bookmarks = json.loads(row['bookmarked'])

        if any(b.get('id') == news_item['id'] for b in bookmarks):
            return jsonify({'success': False, 'error': 'Already bookmarked'})

        bookmarks.append(news_item)
        # name='' 满足 NOT NULL 约束
        cursor.execute(
            'INSERT INTO games (id, name, bookmarked) VALUES ("bookmarks", "", %s) '
            'ON DUPLICATE KEY UPDATE bookmarked = %s',
            (json.dumps(bookmarks), json.dumps(bookmarks))
        )
        conn.commit()
    finally:
        conn.close()

    return jsonify({'success': True, 'bookmarks': bookmarks})


@games_bp.route('/api/bookmarks/<news_id>', methods=['DELETE'])
def remove_bookmark(news_id):
    conn = get_db()
    try:
        cursor = conn.cursor(pymysql.cursors.DictCursor)
        cursor.execute('SELECT bookmarked FROM games WHERE id = "bookmarks"')
        row = cursor.fetchone()

        if not row or not row.get('bookmarked'):
            return jsonify({'success': True, 'bookmarks': []})

        bookmarks = json.loads(row['bookmarked'])
        bookmarks = [b for b in bookmarks if b.get('id') != news_id]

        cursor.execute(
            'INSERT INTO games (id, name, bookmarked) VALUES ("bookmarks", "", %s) '
            'ON DUPLICATE KEY UPDATE bookmarked = %s',
            (json.dumps(bookmarks), json.dumps(bookmarks))
        )
        conn.commit()
    finally:
        conn.close()

    return jsonify({'success': True, 'bookmarks': bookmarks})


# ============ 游戏图片搜索 ============

@games_bp.route('/api/search-image', methods=['GET'])
def search_game_image():
    query = request.args.get('q', '')
    if not query:
        return jsonify({'image': None})

    try:
        # 2026-03-19: 原先 key 硬编码在此，改为引用模块变量 RAWG_API_KEY
        url = (
            f"https://api.rawg.io/api/games"
            f"?key={RAWG_API_KEY}"
            f"&search={urllib.parse.quote(query)}&page_size=1"
        )
        with urllib.request.urlopen(url, timeout=5) as response:
            data = json.loads(response.read().decode())
            if data.get('results'):
                game = data['results'][0]
                return jsonify({
                    'image': game.get('background_image'),
                    'name': game.get('name'),
                    'released': game.get('released')
                })
    except Exception as e:
        print(f"Image search error: {e}")

    return jsonify({'image': None})


@games_bp.route('/api/search-steam', methods=['GET'])
def search_steam_image():
    query = request.args.get('q', '')
    if not query:
        return jsonify({'items': []})

    try:
        url = (
            f"https://store.steampowered.com/api/storesearch/"
            f"?term={urllib.parse.quote(query)}&l=schinese&cc=CN"
        )
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=5) as response:
            data = json.loads(response.read().decode())
            items = []
            for item in data.get('items', [])[:5]:
                app_id = item.get('id')
                final_price = item.get('price', {}).get('final', 0) // 100 if item.get('price') else 0
                header_url = (
                    f"https://cdn.cloudflare.steamstatic.com/steam/apps/{app_id}/header.jpg"
                    if app_id else ''
                )
                items.append({
                    'id': app_id,
                    'name': item.get('name', ''),
                    'thumb': item.get('thumb', ''),
                    'header': header_url,
                    'price': final_price
                })
            return jsonify({'items': items})
    except Exception as e:
        print(f"Steam search error: {e}")

    return jsonify({'items': []})


@games_bp.route('/api/search-steam-auto', methods=['GET'])
def search_steam_auto():
    """自动搜索Steam游戏并返回base64图片"""
    query = request.args.get('q', '')
    if not query:
        return jsonify({'success': False, 'error': 'No query provided'})

    try:
        # 先搜索游戏
        url = (
            f"https://store.steampowered.com/api/storesearch/"
            f"?term={urllib.parse.quote(query)}&l=schinese&cc=CN"
        )
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=5) as response:
            data = json.loads(response.read().decode())
            items = data.get('items', [])
            
            if not items:
                return jsonify({'success': False, 'error': 'No results found'})
            
            # 取第一个结果
            item = items[0]
            app_id = item.get('id')
            
            if not app_id:
                return jsonify({'success': False, 'error': 'No app ID found'})
            
            # 尝试获取游戏详情中的图片URL
            image_url = item.get('tiny_image', '') or item.get('large_capsule_image', '')
            
            # 如果没有图片URL，尝试用header.jpg
            if not image_url:
                image_url = f"https://cdn.cloudflare.steamstatic.com/steam/apps/{app_id}/header.jpg"
            
            # 下载图片并转换为base64
            b64_image = convert_url_to_base64(image_url)
            
            # 如果下载失败，尝试从appdetails API获取图片
            if not b64_image:
                try:
                    details_url = f"https://store.steampowered.com/api/appdetails?appids={app_id}&l=schinese"
                    req = urllib.request.Request(details_url, headers={'User-Agent': 'Mozilla/5.0'})
                    with urllib.request.urlopen(req, timeout=5) as details_response:
                        details_data = json.loads(details_response.read().decode())
                        if str(app_id) in details_data and details_data[str(app_id)].get('success'):
                            game_data = details_data[str(app_id)].get('data', {})
                            # 尝试多种图片字段
                            for img_field in ['header_image', 'capsule_image', 'small_capsule_image']:
                                img_url = game_data.get(img_field, '')
                                if img_url:
                                    b64_image = convert_url_to_base64(img_url)
                                    if b64_image:
                                        break
                except Exception as e:
                    print(f"Get app details error: {e}")
            
            return jsonify({
                'success': True,
                'image': b64_image,
                'name': item.get('name', ''),
                'app_id': app_id
            })
    except Exception as e:
        print(f"Steam auto search error: {e}")
        return jsonify({'success': False, 'error': str(e)})


@games_bp.route('/api/steam-game/<app_id>', methods=['GET'])
def get_steam_game_details(app_id):
    try:
        url = f"https://store.steampowered.com/api/appdetails?appids={app_id}&l=schinese"
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=5) as response:
            data = json.loads(response.read().decode())
            if str(app_id) in data and data[str(app_id)].get('success'):
                game_data = data[str(app_id)].get('data', {})
                header_url = game_data.get('header_image', '') or (
                    f"https://cdn.cloudflare.steamstatic.com/steam/apps/{app_id}/header.jpg"
                )
                screenshots = game_data.get('screenshots', [])
                preview_urls = [
                    s.get('path_thumbnail') or s.get('path_full')
                    for s in screenshots[:3]
                    if s.get('path_thumbnail') or s.get('path_full')
                ]
                return jsonify({
                    'headerUrl': header_url,
                    'previewUrls': preview_urls,
                    'name': game_data.get('name', ''),
                    'description': game_data.get('short_description', '')
                })
    except Exception as e:
        print(f"Steam game details error: {e}")

    return jsonify({
        'headerUrl': f"https://cdn.akamai.steamstatic.com/steam/apps/{app_id}/header.jpg",
        'previewUrls': []
    })


@games_bp.route('/api/games/<game_id>/image', methods=['PUT'])
def update_game_image(game_id):
    data = request.get_json(silent=True) or {}
    new_image = data.get('image', '')
    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute('UPDATE games SET image = %s WHERE id = %s', (new_image, game_id))
        conn.commit()
    finally:
        conn.close()
    return jsonify({'success': True})


@games_bp.route('/api/steam-images', methods=['GET'])
def get_steam_images():
    game_name = request.args.get('q', '')
    if not game_name:
        return jsonify({'headerUrl': '', 'previewUrls': []})

    try:
        search_url = (
            f"https://store.steampowered.com/search/"
            f"?term={urllib.parse.quote(game_name)}"
        )
        req = urllib.request.Request(
            search_url,
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
        )
        with urllib.request.urlopen(req, timeout=8) as response:
            html = response.read().decode('utf-8', errors='ignore')
            match = re.search(r'data-ds-appid="(\d+)"', html)
            if match:
                app_id = match.group(1)
            else:
                alt = re.search(r'href="https://store\.steampowered\.com/app/(\d+)', html)
                app_id = alt.group(1) if alt else None

        if not app_id:
            return _fallback_steam_image(game_name)

        details_url = f"https://store.steampowered.com/api/appdetails?appids={app_id}&l=schinese"
        req = urllib.request.Request(details_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode())
            if str(app_id) in data and data[str(app_id)].get('success'):
                game_data = data[str(app_id)].get('data', {})
                header_url = game_data.get('header_image', '') or (
                    f"https://cdn.akamai.steamstatic.com/steam/apps/{app_id}/header.jpg"
                )
                screenshots = game_data.get('screenshots', [])
                preview_urls = [
                    s.get('path_thumbnail') or s.get('path_full')
                    for s in screenshots[:3]
                    if s.get('path_thumbnail') or s.get('path_full')
                ]
                return jsonify({
                    'headerUrl': header_url,
                    'previewUrls': preview_urls,
                    'appId': app_id,
                    'name': game_data.get('name', '')
                })
    except Exception as e:
        print(f"Steam images error: {e}")

    return _fallback_steam_image(game_name)


def _fallback_steam_image(game_name):
    try:
        search_url = (
            f"https://store.steampowered.com/search/"
            f"?term={urllib.parse.quote(game_name)}"
        )
        req = urllib.request.Request(search_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=8) as response:
            html = response.read().decode('utf-8', errors='ignore')
            match = re.search(r'href="https://store\.steampowered\.com/app/(\d+)"', html)
            if match:
                app_id = match.group(1)
                return jsonify({
                    'headerUrl': f"https://cdn.akamai.steamstatic.com/steam/apps/{app_id}/header.jpg",
                    'previewUrls': [],
                    'appId': app_id
                })
    except Exception:
        pass
    return jsonify({'headerUrl': '', 'previewUrls': []})


# ============ 游戏新闻获取 ============

@games_bp.route('/api/game-news', methods=['GET'])
def get_game_news():
    query = request.args.get('game', '')
    if not query:
        return jsonify({'news': []})

    try:
        # 2026-03-19: 原先 key 硬编码在此，改为引用模块变量 RAWG_API_KEY
        # f"?key=5d1eb2a07cda4e899f6020e3d7465b1c"
        url = (
            f"https://api.rawg.io/api/games"
            f"?key={RAWG_API_KEY}"
            f"&search={urllib.parse.quote(query)}&page_size=3"
        )
        with urllib.request.urlopen(url, timeout=5) as response:
            data = json.loads(response.read().decode())
            news = [
                {
                    'title': game.get('name'),
                    'image': game.get('background_image'),
                    'released': game.get('released'),
                    'rating': game.get('rating')
                }
                for game in data.get('results', [])[:3]
            ]
            return jsonify({'news': news})
    except Exception as e:
        print(f"News search error: {e}")

    return jsonify({'news': []})


# ============ Steam 游戏好评率 ============

def _do_fetch_steam_rating(app_id=None, game_name=None):
    """实际请求 Steam API 获取好评率，返回 dict（不含缓存逻辑）"""
    # 如果没有 app_id，先搜索
    if not app_id and game_name:
        search_url = (
            f"https://store.steampowered.com/api/storesearch/"
            f"?term={urllib.parse.quote(game_name)}&l=schinese&cc=CN"
        )
        req = urllib.request.Request(search_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=8) as response:
            data = json.loads(response.read().decode())
            items = data.get('items', [])
            if items:
                app_id = str(items[0].get('id', ''))

    if not app_id:
        return {'success': False, 'error': '未找到游戏'}

    reviews_url = f"https://store.steampowered.com/appreviews/{app_id}?json=1&language=all"
    req = urllib.request.Request(reviews_url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=8) as response:
        data = json.loads(response.read().decode())

    if not data.get('success'):
        return {'success': False, 'error': '无法获取游戏评价'}

    qs = data.get('query_summary', {})
    total_positive = qs.get('total_positive', 0)
    total_reviews  = qs.get('total_reviews', 0)
    rating_percent = round((total_positive / total_reviews) * 100, 1) if total_reviews > 0 else 0

    return {
        'success': True,
        'app_id': app_id,
        'rating_percent': rating_percent,
        'review_score': qs.get('review_score', 0),
        'review_score_desc': qs.get('review_score_desc', ''),
        'total_positive': total_positive,
        'total_negative': qs.get('total_negative', 0),
        'total_reviews': total_reviews,
        'url': f"https://store.steampowered.com/app/{app_id}"
    }


def _save_steam_appid(game_id, app_id):
    """把通过搜索得到的 appid 写回数据库，避免下次再搜索"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            'UPDATE games SET steam_appid = %s WHERE id = %s AND (steam_appid IS NULL OR steam_appid = "")',
            (str(app_id), game_id)
        )
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"Save steam_appid error: {e}")


def _get_steam_rating_cached(app_id=None, game_name=None, game_id=None):
    """
    带 24h 缓存的评分获取：
    - 缓存命中且未过期 → 直接返回
    - 缓存过期 → 尝试刷新，失败则返回旧数据
    - 无缓存 → 请求，失败返回 error
    """
    cache_key = str(app_id) if app_id else (game_name or '')
    if not cache_key:
        return {'success': False, 'error': '需要提供 appid 或 name'}

    now = time.time()
    cached = _steam_rating_cache.get(cache_key)

    # 缓存命中且未过期
    if cached and (now - cached['ts']) < STEAM_RATING_CACHE_TTL:
        return cached['data']

    stale = cached['data'] if cached else None  # 过期的旧数据备用

    try:
        result = _do_fetch_steam_rating(app_id=app_id, game_name=game_name)
        _steam_rating_cache[cache_key] = {'data': result, 'ts': now}

        # 顺带把搜索到的 appid 存库（只在通过名字搜索时）
        if result.get('success') and not app_id and game_id:
            _save_steam_appid(game_id, result['app_id'])
            # 同时以 appid 为 key 写一份缓存
            _steam_rating_cache[str(result['app_id'])] = {'data': result, 'ts': now}

        return result
    except Exception as e:
        print(f"Steam rating fetch error: {e}")
        if stale:
            print(f"  → using stale cache for {cache_key}")
            return stale
        return {'success': False, 'error': str(e)}


@games_bp.route('/api/steam/rating', methods=['GET'])
def get_steam_rating():
    """获取单个游戏 Steam 好评率（带 24h 缓存）"""
    app_id    = request.args.get('appid', '').strip() or None
    game_name = request.args.get('name', '').strip()  or None
    game_id   = request.args.get('game_id', '').strip() or None

    if not app_id and not game_name:
        return jsonify({'success': False, 'error': '需要提供 appid 或 name'})

    result = _get_steam_rating_cached(app_id=app_id, game_name=game_name, game_id=game_id)
    return jsonify(result)


@games_bp.route('/api/steam/ratings', methods=['POST'])
def get_steam_ratings_batch():
    """
    批量获取多个游戏 Steam 好评率（带 24h 缓存）
    Body: { "items": [{"id": "...", "name": "...", "appid": "..."}, ...] }
    Response: { "<game_id>": { rating data } }
    """
    data  = request.get_json(silent=True) or {}
    items = data.get('items', [])
    results = {}

    for item in items:
        gid    = item.get('id', '')
        name   = item.get('name', '') or None
        appid  = item.get('appid', '') or None
        if not gid:
            continue
        results[gid] = _get_steam_rating_cached(app_id=appid, game_name=name, game_id=gid)

    return jsonify(results)


# ============ Steam 价格 ============

def _fetch_steam_price_data(app_id):
    """调用 Steam appdetails 只取 price_overview，返回价格 dict"""
    url = (
        f"https://store.steampowered.com/api/appdetails"
        f"?appids={app_id}&cc=CN&filters=price_overview"
    )
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=8) as resp:
        data = json.loads(resp.read().decode())

    app_data = data.get(str(app_id), {})
    if not app_data.get('success'):
        return {'success': False, 'error': '无价格信息'}

    price = app_data.get('data', {}).get('price_overview')
    if not price:
        # 免费游戏没有 price_overview 字段
        return {'success': True, 'free': True, 'final_price': 0,
                'original_price': 0, 'discount': 0}

    return {
        'success':          True,
        'free':             False,
        'final_price':      price.get('final',            0) / 100,
        'original_price':   price.get('initial',          0) / 100,
        'discount':         price.get('discount_percent', 0),
        'currency':         price.get('currency',         'CNY'),
        'final_formatted':  price.get('final_formatted',  ''),
        'initial_formatted':price.get('initial_formatted',''),
    }


def _get_steam_price_cached(app_id):
    """带 6h 缓存的价格获取，失败时返回旧数据"""
    if not app_id:
        return {'success': False, 'error': '需要提供 appid'}

    cache_key = str(app_id)
    now = time.time()
    cached = _steam_price_cache.get(cache_key)

    if cached and (now - cached['ts']) < STEAM_PRICE_CACHE_TTL:
        return cached['data']

    stale = cached['data'] if cached else None
    try:
        result = _fetch_steam_price_data(app_id)
        _steam_price_cache[cache_key] = {'data': result, 'ts': now}
        return result
    except Exception as e:
        print(f"Steam price fetch error for {app_id}: {e}")
        if stale:
            return stale
        return {'success': False, 'error': str(e)}


@games_bp.route('/api/steam/prices', methods=['POST'])
def get_steam_prices_batch():
    """
    批量获取游戏 Steam 价格（带 6h 缓存）
    Body: { "items": [{"id": "...", "appid": "..."}, ...] }
    Response: { "<id>": { price data } }
    """
    data  = request.get_json(silent=True) or {}
    items = data.get('items', [])
    results = {}

    for item in items:
        gid   = item.get('id', '')
        appid = item.get('appid', '') or None
        if not gid or not appid:
            continue
        results[gid] = _get_steam_price_cached(appid)

    return jsonify(results)


# ============ 游戏 CRUD ============

@games_bp.route('/api/games', methods=['GET'])
def get_games():
    status_filter = request.args.get('status', '')
    conn = get_db()
    try:
        cursor = conn.cursor(pymysql.cursors.DictCursor)
        if status_filter:
            cursor.execute(
                'SELECT * FROM games WHERE id != "bookmarks" AND status = %s ORDER BY created_at DESC',
                (status_filter,)
            )
        else:
            cursor.execute('SELECT * FROM games WHERE id != "bookmarks" ORDER BY created_at DESC')
        games = cursor.fetchall()
    finally:
        conn.close()

    for game in games:
        game['ratings'] = json.loads(game['ratings']) if game['ratings'] else {}
        game['comments'] = json.loads(game['comments']) if game['comments'] else []
        ratings = game['ratings']
        game['avg_rating'] = sum(ratings.values()) / len(ratings) if ratings else 0
        game['rating_count'] = len(ratings)
        game['status'] = game.get('status') or 'todo'
        game['steam_appid'] = game.get('steam_appid') or ''

    games.sort(key=lambda x: x.get('avg_rating', 0), reverse=True)
    return jsonify(games)


def _auto_fetch_steam_cover(game_id, game_name):
    """后台自动从 Steam 搜索封面并回填到数据库"""
    try:
        search_url = (
            f"https://store.steampowered.com/api/storesearch/"
            f"?term={urllib.parse.quote(game_name)}&l=schinese&cc=CN"
        )
        req = urllib.request.Request(search_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode())
            items = data.get('items', [])
            if not items:
                return
            app_id = items[0].get('id')
            if not app_id:
                return

        # 优先取 header.jpg（横幅封面）
        image_url = f"https://cdn.cloudflare.steamstatic.com/steam/apps/{app_id}/header.jpg"
        b64 = convert_url_to_base64(image_url)

        if not b64:
            return

        conn = get_db()
        try:
            cursor = conn.cursor()
            # 只在 image 仍为空时才写入，避免覆盖用户手动设置的图片
            cursor.execute(
                'UPDATE games SET image = %s, steam_appid = %s WHERE id = %s AND (image IS NULL OR image = "")',
                (b64, str(app_id), game_id)
            )
            conn.commit()
        finally:
            conn.close()
        print(f"[AutoCover] {game_name} → appid={app_id} OK")
    except Exception as e:
        print(f"[AutoCover] {game_name} failed: {e}")


@games_bp.route('/api/games', methods=['POST'])
def add_game():
    data = request.get_json(silent=True) or {}
    game = {
        'id': data.get('id') or str(uuid.uuid4())[:8],
        'name': data.get('name'),
        'image': data.get('image', ''),
        # 不再接收 user 字段，默认用 Anonymous
        'created_by': data.get('created_by', 'Anonymous'),
        'password': data.get('password', ''),
        'status': data.get('status', 'todo'),
        'source': data.get('source') or data.get('url', ''),
        'priority': data.get('priority', 100),
        'ratings': {},
        'comments': [],
        'recommender': data.get('recommender', ''),
        'notes': data.get('notes', '')
    }
    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute(
            'INSERT INTO games '
            '(id, name, image, created_by, password, status, source, priority, ratings, comments, recommender, notes) '
            'VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)',
            (
                game['id'], game['name'], game['image'], game['created_by'],
                game['password'], game['status'], game['source'], game['priority'],
                json.dumps(game['ratings']), json.dumps(game['comments']),
                game['recommender'], game['notes']
            )
        )
        conn.commit()
    finally:
        conn.close()

    # 2026-03-20: 若未提供封面，后台线程自动从 Steam 搜索并回填
    if not game['image']:
        threading.Thread(
            target=_auto_fetch_steam_cover,
            args=(game['id'], game['name']),
            daemon=True
        ).start()

    return jsonify({'success': True, 'game': game})


@games_bp.route('/api/games/<game_id>/rate', methods=['POST'])
def rate_game(game_id):
    data = request.get_json(silent=True) or {}
    user = data.get('user', '匿名')
    score = data.get('score', 3)

    conn = get_db()
    try:
        cursor = conn.cursor(pymysql.cursors.DictCursor)
        cursor.execute('SELECT ratings FROM games WHERE id = %s', (game_id,))
        row = cursor.fetchone()

        if not row:
            return jsonify({'success': False, 'error': '游戏不存在'}), 404

        ratings = json.loads(row['ratings']) if row['ratings'] else {}

        if user in ratings:
            return jsonify({'success': False, 'error': '你已经评过分了', 'your_rating': ratings[user]}), 400

        ratings[user] = score
        cursor.execute('UPDATE games SET ratings = %s WHERE id = %s', (json.dumps(ratings), game_id))
        conn.commit()
    finally:
        conn.close()

    avg = sum(ratings.values()) / len(ratings)
    return jsonify({'success': True, 'avg_rating': avg, 'rating_count': len(ratings)})


@games_bp.route('/api/games/<game_id>/comment', methods=['POST'])
def comment_game(game_id):
    data = request.get_json(silent=True) or {}
    conn = get_db()
    try:
        cursor = conn.cursor(pymysql.cursors.DictCursor)
        cursor.execute('SELECT comments FROM games WHERE id = %s', (game_id,))
        row = cursor.fetchone()

        if not row:
            return jsonify({'success': False, 'error': '游戏不存在'}), 404

        comments = json.loads(row['comments']) if row['comments'] else []
        comments.append({
            'user': data.get('user', '匿名'),
            'text': data.get('text', ''),
            'timestamp': datetime.now().isoformat()
        })
        cursor.execute('UPDATE games SET comments = %s WHERE id = %s', (json.dumps(comments), game_id))
        conn.commit()
    finally:
        conn.close()
    return jsonify({'success': True})


@games_bp.route('/api/games/<game_id>', methods=['PUT'])
def update_game(game_id):
    """更新游戏信息"""
    data = request.get_json(silent=True) or {}
    
    # 构建更新字段
    updates = []
    values = []
    
    if 'status' in data:
        valid_statuses = ['todo', 'playing', 'completed']
        if data['status'] not in valid_statuses:
            return jsonify({'success': False, 'error': '无效的状态值'}), 400
        updates.append('status = %s')
        values.append(data['status'])
    
    if 'name' in data:
        updates.append('name = %s')
        values.append(data['name'])
    
    if 'image' in data:
        updates.append('image = %s')
        values.append(data['image'])
    
    if 'url' in data:
        updates.append('source = %s')
        values.append(data['url'])
    
    if 'priority' in data:
        updates.append('priority = %s')
        values.append(data['priority'])
    
    if 'recommender' in data:
        updates.append('recommender = %s')
        values.append(data['recommender'])
    
    if 'notes' in data:
        updates.append('notes = %s')
        values.append(data['notes'])
    
    if not updates:
        return jsonify({'success': False, 'error': '没有需要更新的字段'}), 400
    
    values.append(game_id)
    
    conn = get_db()
    try:
        cursor = conn.cursor()
        sql = f"UPDATE games SET {', '.join(updates)} WHERE id = %s"
        cursor.execute(sql, values)
        conn.commit()
    finally:
        conn.close()
    
    return jsonify({'success': True})


@games_bp.route('/api/games/<game_id>/status', methods=['PUT'])
def update_game_status(game_id):
    data = request.get_json(silent=True) or {}
    new_status = data.get('status', 'todo')
    valid_statuses = ['todo', 'playing', 'completed']
    if new_status not in valid_statuses:
        return jsonify({'success': False, 'error': '无效的状态值'}), 400

    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute('UPDATE games SET status = %s WHERE id = %s', (new_status, game_id))
        conn.commit()
    finally:
        conn.close()
    return jsonify({'success': True, 'status': new_status})


@games_bp.route('/api/games/<game_id>', methods=['DELETE'])
def delete_game(game_id):
    password = request.args.get('password', '')
    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute('SELECT password FROM games WHERE id = %s', (game_id,))
        row = cursor.fetchone()

        if not row:
            return jsonify({'success': False, 'error': '游戏不存在'}), 404

        stored_password = row[0]
        if stored_password:
            if not password:
                return jsonify({'success': False, 'error': '需要密码'}), 401
            if password != stored_password:
                return jsonify({'success': False, 'error': '密码错误'}), 403

        cursor.execute('DELETE FROM games WHERE id = %s', (game_id,))
        conn.commit()
    finally:
        conn.close()
    return jsonify({'success': True})
