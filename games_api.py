#!/usr/bin/env python3
"""
待玩游戏后端 API
"""

import json
import uuid
from datetime import datetime
from flask import Flask, jsonify, request
import pymysql
import urllib.request
import urllib.parse

app = Flask(__name__)

# 数据库配置
DB_CONFIG = {
    'host': '150.158.110.168',
    'port': 3306,
    'user': 'feng-bot',
    'password': 'dak2dcCHCczb2wKW',
    'database': 'feng-bot',
    'charset': 'utf8mb4'
}


def get_db():
    return pymysql.connect(**DB_CONFIG)


def init_db():
    """初始化数据库表"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS games (
            id VARCHAR(36) PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            image VARCHAR(512),
            created_by VARCHAR(100),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            ratings JSON,
            comments JSON
        )
    ''')
    conn.commit()
    conn.close()


# ============ 游戏图片搜索 ============

@app.route('/api/search-image', methods=['GET'])
def search_game_image():
    """搜索游戏图片 - 使用 RAWG API"""
    query = request.args.get('q', '')
    if not query:
        return jsonify({'image': None})
    
    try:
        # 使用 RAWG 免费 API
        url = f"https://api.rawg.io/api/games?key=5d1eb2a07cda4e899f6020e3d7465b1c&search={urllib.parse.quote(query)}&page_size=1"
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


@app.route('/api/search-steam', methods=['GET'])
def search_steam_image():
    """搜索 Steam 游戏图片 - 后端处理避免跨域"""
    query = request.args.get('q', '')
    if not query:
        return jsonify({'items': []})
    
    try:
        # Steam 商店搜索 API - 后端请求避免跨域
        url = f"https://store.steampowered.com/api/storesearch/?term={urllib.parse.quote(query)}&l=schinese&cc=CN"
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=5) as response:
            data = json.loads(response.read().decode())
            items = []
            for item in data.get('items', [])[:5]:
                # 构建 Steam 头图 URL
                app_id = item.get('id')
                final_price = item.get('price', {}).get('final', 0) // 100 if item.get('price') else 0
                thumb_url = f"https://cdn.cloudflare.steamstatic.com/steam/apps/{app_id}/header.jpg" if app_id else ''
                
                items.append({
                    'id': app_id,
                    'name': item.get('name', ''),
                    'thumb': item.get('thumb', ''),
                    'header': thumb_url,
                    'price': final_price
                })
            return jsonify({'items': items})
    except Exception as e:
        print(f"Steam search error: {e}")
    
    return jsonify({'items': []})


@app.route('/api/steam-game/<app_id>', methods=['GET'])
def get_steam_game_details(app_id):
    """获取 Steam 游戏详情和截图"""
    try:
        # Steam API 获取游戏详情
        url = f"https://store.steampowered.com/api/appdetails?appids={app_id}&l=schinese"
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=5) as response:
            data = json.loads(response.read().decode())
            
            if str(app_id) in data and data[str(app_id)].get('success'):
                game_data = data[str(app_id)].get('data', {})
                
                # 头图
                header_url = game_data.get('header_image', '')
                if not header_url and app_id:
                    header_url = f"https://cdn.cloudflare.steamstatic.com/steam/apps/{app_id}/header.jpg"
                
                # 截图
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
    
    # 备用：返回 CDN 头图
    return jsonify({
        'headerUrl': f"https://cdn.akamai.steamstatic.com/steam/apps/{app_id}/header.jpg",
        'previewUrls': []
    })


@app.route('/api/games/<game_id>/image', methods=['PUT'])
def update_game_image(game_id):
    """更新游戏封面图片"""
    data = request.json
    new_image = data.get('image', '')
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('UPDATE games SET image = %s WHERE id = %s', (new_image, game_id))
    conn.commit()
    conn.close()
    
    return jsonify({'success': True})


@app.route('/api/steam-images', methods=['GET'])
def get_steam_images():
    """完整流程：从 Steam 获取游戏图片"""
    game_name = request.args.get('q', '')
    if not game_name:
        return jsonify({'headerUrl': '', 'previewUrls': []})
    
    import re
    
    # 1. 搜索游戏获取 AppID
    try:
        search_url = f"https://store.steampowered.com/search/?term={urllib.parse.quote(game_name)}"
        req = urllib.request.Request(search_url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'})
        with urllib.request.urlopen(req, timeout=8) as response:
            html = response.read().decode('utf-8', errors='ignore')
            
            # 提取 data-ds-appid
            match = re.search(r'data-ds-appid="(\d+)"', html)
            if match:
                app_id = match.group(1)
            else:
                alt_match = re.search(r'href="https://store\.steampowered\.com/app/(\d+)', html)
                if alt_match:
                    app_id = alt_match.group(1)
                else:
                    app_id = None
        
        if not app_id:
            # 备用方法
            return get_fallback_steam_image(game_name)
        
        # 2. 获取游戏详情
        details_url = f"https://store.steampowered.com/api/appdetails?appids={app_id}&l=schinese"
        req = urllib.request.Request(details_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode())
            
            if str(app_id) in data and data[str(app_id)].get('success'):
                game_data = data[str(app_id)].get('data', {})
                
                header_url = game_data.get('header_image', '')
                if not header_url:
                    header_url = f"https://cdn.akamai.steamstatic.com/steam/apps/{app_id}/header.jpg"
                
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
    
    # 3. 备用方法
    return get_fallback_steam_image(game_name)


def get_fallback_steam_image(game_name):
    """备用方法：直接构建封面图 URL"""
    import re
    try:
        search_url = f"https://store.steampowered.com/search/?term={urllib.parse.quote(game_name)}"
        req = urllib.request.Request(search_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=8) as response:
            html = response.read().decode('utf-8', errors='ignore')
            match = re.search(r'href="https://store\.steampowered\.com/app/(\d+)"', html)
            if match:
                app_id = match.group(1)
                fallback_url = f"https://cdn.akamai.steamstatic.com/steam/apps/{app_id}/header.jpg"
                return jsonify({'headerUrl': fallback_url, 'previewUrls': [], 'appId': app_id})
    except:
        pass
    
    return jsonify({'headerUrl': '', 'previewUrls': []})


# ============ 游戏新闻获取 ============

@app.route('/api/game-news', methods=['GET'])
def get_game_news():
    """获取游戏新闻 - 使用 RAWD API"""
    query = request.args.get('game', '')
    if not query:
        return jsonify({'news': []})
    
    try:
        # 搜索相关游戏新闻
        url = f"https://api.rawg.io/api/games?key=5d1eb2a07cda4e899f6020e3d7465b1c&search={urllib.parse.quote(query)}&page_size=3"
        with urllib.request.urlopen(url, timeout=5) as response:
            data = json.loads(response.read().decode())
            news = []
            for game in data.get('results', [])[:3]:
                news.append({
                    'title': game.get('name'),
                    'image': game.get('background_image'),
                    'released': game.get('released'),
                    'rating': game.get('rating')
                })
            return jsonify({'news': news})
    except Exception as e:
        print(f"News search error: {e}")
    
    return jsonify({'news': []})


# ============ 游戏 CRUD ============

@app.route('/api/games', methods=['GET'])
def get_games():
    """获取游戏列表"""
    conn = get_db()
    cursor = conn.cursor(pymysql.cursors.DictCursor)
    cursor.execute('SELECT * FROM games ORDER BY created_at DESC')
    games = cursor.fetchall()
    conn.close()
    
    # 处理 JSON 字段
    for game in games:
        game['ratings'] = json.loads(game['ratings']) if game['ratings'] else {}
        game['comments'] = json.loads(game['comments']) if game['comments'] else []
        # 计算平均分
        ratings = game['ratings']
        game['avg_rating'] = sum(ratings.values()) / len(ratings) if ratings else 0
        game['rating_count'] = len(ratings)
    
    # 按评分排序
    games.sort(key=lambda x: x.get('avg_rating', 0), reverse=True)
    return jsonify(games)


@app.route('/api/games', methods=['POST'])
def add_game():
    """添加游戏"""
    data = request.json
    
    game = {
        'id': data.get('id') or str(uuid.uuid4())[:8],
        'name': data.get('name'),
        'image': data.get('image', ''),
        'created_by': data.get('user', '匿名'),
        'ratings': {},
        'comments': []
    }
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        'INSERT INTO games (id, name, image, created_by, ratings, comments) VALUES (%s, %s, %s, %s, %s, %s)',
        (game['id'], game['name'], game['image'], game['created_by'], 
         json.dumps(game['ratings']), json.dumps(game['comments']))
    )
    conn.commit()
    conn.close()
    
    return jsonify({'success': True, 'game': game})


@app.route('/api/games/<game_id>/rate', methods=['POST'])
def rate_game(game_id):
    """评分"""
    data = request.json
    user = data.get('user', '匿名')
    score = data.get('score', 3)
    
    conn = get_db()
    cursor = conn.cursor(pymysql.cursors.DictCursor)
    cursor.execute('SELECT ratings FROM games WHERE id = %s', (game_id,))
    row = cursor.fetchone()
    
    if not row:
        conn.close()
        return jsonify({'success': False, 'error': '游戏不存在'}), 404
    
    ratings = json.loads(row['ratings']) if row['ratings'] else {}
    
    # 评分去重：检查用户是否已评分，防止刷分
    if user in ratings:
        return jsonify({'success': False, 'error': '你已经评过分了', 'your_rating': ratings[user]}), 400
    
    ratings[user] = score
    
    cursor.execute('UPDATE games SET ratings = %s WHERE id = %s', (json.dumps(ratings), game_id))
    conn.commit()
    conn.close()
    
    avg = sum(ratings.values()) / len(ratings)
    return jsonify({'success': True, 'avg_rating': avg, 'rating_count': len(ratings)})


@app.route('/api/games/<game_id>/comment', methods=['POST'])
def comment_game(game_id):
    """留言"""
    data = request.json
    user = data.get('user', '匿名')
    text = data.get('text', '')
    
    conn = get_db()
    cursor = conn.cursor(pymysql.cursors.DictCursor)
    cursor.execute('SELECT comments FROM games WHERE id = %s', (game_id,))
    row = cursor.fetchone()
    
    if not row:
        conn.close()
        return jsonify({'success': False, 'error': '游戏不存在'}), 404
    
    comments = json.loads(row['comments']) if row['comments'] else []
    comments.append({
        'user': user,
        'text': text,
        'timestamp': datetime.now().isoformat()
    })
    
    cursor.execute('UPDATE games SET comments = %s WHERE id = %s', (json.dumps(comments), game_id))
    conn.commit()
    conn.close()
    
    return jsonify({'success': True})


@app.route('/api/games/<game_id>', methods=['DELETE'])
def delete_game(game_id):
    """删除游戏"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM games WHERE id = %s', (game_id,))
    conn.commit()
    conn.close()
    return jsonify({'success': True})


if __name__ == '__main__':
    print("🚀 初始化数据库...")
    init_db()
    print("✅ 数据库就绪")
    print("🌐 启动服务: http://0.0.0.0:9000")
    app.run(host='0.0.0.0', port=9000, debug=True)