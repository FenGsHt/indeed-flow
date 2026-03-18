#!/usr/bin/env python3
"""
每日 Steam 折扣检测脚本
从数据库获取 wishlist/playing 状态且有 steam_appid 的游戏，
检查是否打折，通过 Bark 推送通知。

用法：
  cd /path/to/backend && python3 steam_price_check.py
"""

import json
import os
import time
import urllib.request
import urllib.parse

import pymysql

# 加载 .env（与 games_api.py 保持一致）
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

DB_CONFIG = {
    'host':     os.getenv('DB_HOST', 'localhost'),
    'port':     int(os.getenv('DB_PORT', '3306')),
    'user':     os.getenv('DB_USER', 'root'),
    'password': os.getenv('DB_PASSWORD', ''),
    'database': os.getenv('DB_NAME', 'indeed_flow'),
    'charset':  'utf8mb4',
}

BARK_KEY = os.getenv('BARK_KEY', '')


# ── 数据库 ──────────────────────────────────────────────────────────────

def get_db():
    return pymysql.connect(**DB_CONFIG)


def get_games_with_appid():
    """返回所有状态为 todo/playing 且有 steam_appid 的游戏列表"""
    conn = get_db()
    try:
        cursor = conn.cursor(pymysql.cursors.DictCursor)
        cursor.execute(
            "SELECT id, name, steam_appid, status FROM games "
            "WHERE id != 'bookmarks' "
            "  AND steam_appid IS NOT NULL AND steam_appid != '' "
            "  AND status IN ('todo', 'playing') "
            "ORDER BY name"
        )
        return cursor.fetchall()
    finally:
        conn.close()


# ── Steam API ────────────────────────────────────────────────────────────

def fetch_steam_price(app_id):
    """
    调用 Steam appdetails API 获取价格信息（只取 price_overview filter，速度快）。
    返回 price_overview dict，或 None（免费/不在中区/下架）。
    """
    url = (
        f"https://store.steampowered.com/api/appdetails"
        f"?appids={app_id}&cc=CN&filters=price_overview"
    )
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
        app_data = data.get(str(app_id), {})
        if not app_data.get('success'):
            return None
        return app_data.get('data', {}).get('price_overview')  # 免费游戏此字段不存在
    except Exception as e:
        print(f"  [WARN] fetch price error for appid={app_id}: {e}")
        return None


# ── Bark 推送 ─────────────────────────────────────────────────────────────

def send_bark(title, body, jump_url=None):
    """
    Bark 推送。格式参考 deploy.yml：
      https://api.day.app/{key}/{title}/{body}
    """
    if not BARK_KEY:
        print("[WARN] BARK_KEY 未配置，跳过推送")
        return

    t = urllib.parse.quote(title, safe='')
    b = urllib.parse.quote(body,  safe='')
    bark_url = f"https://api.day.app/{BARK_KEY}/{t}/{b}"
    if jump_url:
        bark_url += '?url=' + urllib.parse.quote(jump_url, safe='')

    try:
        req = urllib.request.Request(bark_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read().decode())
            if result.get('code') == 200:
                print(f"  [OK] Bark 推送成功：{title}")
            else:
                print(f"  [WARN] Bark 返回异常：{result}")
    except Exception as e:
        print(f"  [ERROR] Bark 推送失败：{e}")


# ── 主流程 ────────────────────────────────────────────────────────────────

def main():
    print("=" * 40)
    print("Steam 折扣检测开始")
    print("=" * 40)

    games = get_games_with_appid()
    print(f"待检测游戏数：{len(games)}")

    if not games:
        print("没有需要检测的游戏，退出。")
        return

    discounted = []

    for game in games:
        app_id = game['steam_appid']
        name   = game['name']

        price = fetch_steam_price(app_id)
        time.sleep(0.8)  # 避免请求过快被 Steam 限流

        if price is None:
            print(f"  {name} (appid={app_id}): 无价格信息（免费/不在中区/已下架）")
            continue

        discount         = price.get('discount_percent', 0)
        final_price      = price.get('final',   0) / 100
        original_price   = price.get('initial', 0) / 100

        if discount > 0:
            print(f"  ★ {name}: -{discount}%  ¥{final_price:.2f}（原价 ¥{original_price:.2f}）")
            discounted.append({
                'name':           name,
                'app_id':         app_id,
                'discount':       discount,
                'final_price':    final_price,
                'original_price': original_price,
            })
        else:
            print(f"  - {name}: 无折扣，¥{final_price:.2f}")

    print(f"\n打折游戏数：{len(discounted)}")

    if not discounted:
        send_bark("🎮 Steam 折扣检测", f"检测 {len(games)} 款游戏，本次无打折")
    else:
        # 按折扣力度从大到小排序
        discounted.sort(key=lambda x: x['discount'], reverse=True)

        lines = []
        for g in discounted:
            lines.append(
                f"{g['name']}  -{g['discount']}%  "
                f"¥{g['final_price']:.0f}（原¥{g['original_price']:.0f}）"
            )

        title = f"🎮 Steam {len(discounted)} 款游戏打折"
        body  = '\n'.join(lines)
        send_bark(title, body, jump_url="https://store.steampowered.com/specials#p=0&tab=TopSellers")

    print("=" * 40)
    print("检测完成")
    print("=" * 40)


if __name__ == '__main__':
    main()
