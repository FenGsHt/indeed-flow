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

# OpenClaw webhook（转发到 QQ 群）
OPENCLAW_WEBHOOK = 'http://150.158.110.168:18789/hooks/agent'
OPENCLAW_TOKEN   = 'Bearer bXgkzrenxp0Y2YB2wLJfUGjTjBflaxNY'
OPENCLAW_GROUP   = 'group:859294429'


# ── 数据库 ──────────────────────────────────────────────────────────────

def get_db():
    return pymysql.connect(**DB_CONFIG)


# 2026-03-19: 原先只取 steam_appid 非空的游戏，导致遗漏；现在取所有 todo/playing 游戏，
#              然后从 url/source 字段提取 appid，或通过名字搜索 Steam 补全
def get_games_with_appid():
    """返回所有状态为 todo/playing 的游戏，尽可能补全 steam_appid"""
    conn = get_db()
    try:
        cursor = conn.cursor(pymysql.cursors.DictCursor)
        cursor.execute(
            "SELECT id, name, steam_appid, source, status FROM games "
            "WHERE id != 'bookmarks' "
            "  AND status IN ('todo', 'playing') "
            "ORDER BY name"
        )
        games = cursor.fetchall()
    finally:
        conn.close()

    result = []
    for g in games:
        appid = (g.get('steam_appid') or '').strip()

        # 尝试从 source 字段提取 appid
        if not appid:
            import re
            val = g.get('source') or ''
            m = re.search(r'steampowered\.com/app/(\d+)', val)
            if m:
                appid = m.group(1)

        # 仍然没有 appid → 通过游戏名搜索 Steam
        if not appid:
            appid = search_steam_appid(g['name'])

        if appid:
            g['steam_appid'] = appid
            save_steam_appid(g['id'], appid)
            result.append(g)
        else:
            print(f"  [SKIP] {g['name']}: 无法确定 Steam appid")

    return result


def search_steam_appid(game_name):
    """通过 Steam Store Search API 用游戏名搜索 appid"""
    try:
        url = (
            f"https://store.steampowered.com/api/storesearch/"
            f"?term={urllib.parse.quote(game_name)}&l=schinese&cc=CN"
        )
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        })
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())
            items = data.get('items', [])
            if items:
                return str(items[0].get('id', ''))
    except Exception as e:
        print(f"  [WARN] search appid for '{game_name}' failed: {e}")
    return ''


def save_steam_appid(game_id, app_id):
    """把发现的 appid 写回数据库"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            'UPDATE games SET steam_appid = %s '
            'WHERE id = %s AND (steam_appid IS NULL OR steam_appid = "")',
            (str(app_id), game_id)
        )
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"  [WARN] save appid error: {e}")


# ── Steam API ────────────────────────────────────────────────────────────

def fetch_steam_price(app_id, retries=3):
    """
    调用 Steam appdetails API 获取价格信息（只取 price_overview filter，速度快）。
    返回 price_overview dict，或 None（免费/不在中区/下架）。
    带重试：默认 3 次，超时逐渐加长。
    """
    url = (
        f"https://store.steampowered.com/api/appdetails"
        f"?appids={app_id}&cc=CN&filters=price_overview"
    )
    for attempt in range(retries):
        timeout = 15 + attempt * 10  # 15s, 25s, 35s
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json',
        })
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = json.loads(resp.read().decode())
            app_data = data.get(str(app_id), {})
            if not app_data.get('success'):
                return None
            po = app_data.get('data', {}).get('price_overview')
            if isinstance(po, dict):
                return po
            return None  # price_overview 格式异常（如 list），视为无价格
        except Exception as e:
            if attempt < retries - 1:
                wait = 3 + attempt * 2
                print(f"  [RETRY] appid={app_id} attempt {attempt+1} failed: {e}, waiting {wait}s...")
                time.sleep(wait)
            else:
                print(f"  [WARN] fetch price error for appid={app_id} after {retries} attempts: {e}")
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


# ── OpenClaw webhook 推送 ─────────────────────────────────────────────────

def send_openclaw(message):
    """发送到 OpenClaw webhook，由 work-agent 转发到 QQ 群"""
    payload = json.dumps({
        'message':  message,
        'agentId':  'work-agent',
        'channel':  'qq',
        'to':       OPENCLAW_GROUP,
        'deliver':  True,
    }).encode('utf-8')

    req = urllib.request.Request(
        OPENCLAW_WEBHOOK,
        data=payload,
        headers={
            'Content-Type':  'application/json',
            'Authorization': OPENCLAW_TOKEN,
        },
        method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read().decode())
            print(f"  [OK] OpenClaw 推送成功：{result}")
    except Exception as e:
        print(f"  [ERROR] OpenClaw 推送失败：{e}")


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
    all_results = []  # 2026-03-19: 记录所有游戏的检测结果，用于调试

    for game in games:
        app_id = game['steam_appid']
        name   = game['name']

        price = fetch_steam_price(app_id)
        time.sleep(0.8)  # 避免请求过快被 Steam 限流

        if price is None:
            print(f"  {name} (appid={app_id}): 无价格信息（免费/不在中区/已下架）")
            all_results.append({
                'name': name, 'app_id': app_id,
                'status': '无价格信息', 'discount': 0,
                'final_price': 0, 'original_price': 0,
            })
            continue

        discount         = price.get('discount_percent', 0)
        final_price      = price.get('final',   0) / 100
        original_price   = price.get('initial', 0) / 100

        entry = {
            'name':           name,
            'app_id':         app_id,
            'discount':       discount,
            'final_price':    final_price,
            'original_price': original_price,
            'status':         f'-{discount}%' if discount > 0 else '无折扣',
        }
        all_results.append(entry)

        if discount > 0:
            print(f"  ★ {name}: -{discount}%  ¥{final_price:.2f}（原价 ¥{original_price:.2f}）")
            discounted.append(entry)
        else:
            print(f"  - {name}: 无折扣，¥{final_price:.2f}")

    print(f"\n打折游戏数：{len(discounted)}")

    # 2026-03-19: 构建完整清单（所有游戏），附在推送消息里方便排查
    detail_lines = []
    for r in all_results:
        if r['final_price'] > 0:
            if r['discount'] > 0:
                detail_lines.append(
                    f"🔥 {r['name']}  -{r['discount']}%  ¥{r['final_price']:.0f}（原¥{r['original_price']:.0f}）"
                )
            else:
                detail_lines.append(
                    f"   {r['name']}  ¥{r['final_price']:.0f}  无折扣"
                )
        else:
            detail_lines.append(
                f"   {r['name']}  {r['status']}"
            )
    full_report = '\n'.join(detail_lines)

    if not discounted:
        title = f"🎮 Steam 折扣检测（{len(games)}款）"
        body  = f"本次无打折\n\n── 全部清单 ──\n{full_report}"
        send_bark(title, body)
        # 2026-03-19: 暂时屏蔽 QQ 渠道
        # send_openclaw(f"{title}\n\n{body}")
    else:
        discounted.sort(key=lambda x: x['discount'], reverse=True)
        title = f"🎮 Steam {len(discounted)}/{len(games)} 款打折"
        body  = f"── 全部清单 ──\n{full_report}"
        send_bark(title, body, jump_url="https://store.steampowered.com/specials#p=0&tab=TopSellers")
        # 2026-03-19: 暂时屏蔽 QQ 渠道
        # send_openclaw(f"{title}\n\n{body}\n\nhttps://store.steampowered.com/specials")

    print("=" * 40)
    print("检测完成")
    print("=" * 40)


if __name__ == '__main__':
    main()
