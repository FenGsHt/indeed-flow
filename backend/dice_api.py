#!/usr/bin/env python3
"""
2026-03-19: 吹牛骰积分 & 榜单 API Blueprint
"""

import os
from datetime import datetime, date
from flask import Blueprint, jsonify, request
import pymysql

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

dice_bp = Blueprint('dice', __name__)

DB_CONFIG = {
    'host':     os.getenv('DB_HOST', 'localhost'),
    'port':     int(os.getenv('DB_PORT', '3306')),
    'user':     os.getenv('DB_USER', 'root'),
    'password': os.getenv('DB_PASSWORD', ''),
    'database': os.getenv('DB_NAME', 'indeed_flow'),
    'charset':  'utf8mb4',
}


def get_db():
    return pymysql.connect(**DB_CONFIG)


def init_dice_db():
    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS dice_players (
                id          INT AUTO_INCREMENT PRIMARY KEY,
                name        VARCHAR(20)  NOT NULL UNIQUE,
                points      INT          NOT NULL DEFAULT 1000,
                wins        INT          NOT NULL DEFAULT 0,
                losses      INT          NOT NULL DEFAULT 0,
                daily_wins  INT          NOT NULL DEFAULT 0,
                daily_losses INT         NOT NULL DEFAULT 0,
                daily_points INT         NOT NULL DEFAULT 0,
                last_reset  DATE,
                created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        ''')
        conn.commit()
    finally:
        conn.close()


def _ensure_daily_reset(cursor, player):
    """如果跨天了，重置 daily 统计；积分低于 1000 的刷回 1000"""
    today = date.today()
    if player['last_reset'] and player['last_reset'] >= today:
        return player

    new_points = player['points']
    if new_points < 1000:
        new_points = 1000

    cursor.execute(
        'UPDATE dice_players SET daily_wins=0, daily_losses=0, daily_points=0, '
        'points=%s, last_reset=%s WHERE id=%s',
        (new_points, today, player['id'])
    )
    player['daily_wins'] = 0
    player['daily_losses'] = 0
    player['daily_points'] = 0
    player['points'] = new_points
    player['last_reset'] = today
    return player


def _get_or_create(cursor, name):
    """获取或创建玩家"""
    cursor.execute('SELECT * FROM dice_players WHERE name=%s', (name,))
    row = cursor.fetchone()
    if row:
        cols = [d[0] for d in cursor.description]
        player = dict(zip(cols, row))
        return _ensure_daily_reset(cursor, player)

    today = date.today()
    cursor.execute(
        'INSERT INTO dice_players (name, last_reset) VALUES (%s, %s)',
        (name, today)
    )
    cursor.execute('SELECT * FROM dice_players WHERE name=%s', (name,))
    row = cursor.fetchone()
    cols = [d[0] for d in cursor.description]
    return dict(zip(cols, row))


# ── 注册 / 获取玩家 ──────────────────────────────────
@dice_bp.route('/api/dice/player', methods=['POST'])
def get_player():
    data = request.json or {}
    name = (data.get('name') or '').strip()[:20]
    if not name:
        return jsonify({'ok': False, 'error': 'name required'}), 400

    conn = get_db()
    try:
        cursor = conn.cursor()
        p = _get_or_create(cursor, name)
        conn.commit()
        return jsonify({
            'ok': True,
            'player': {
                'name':    p['name'],
                'points':  p['points'],
                'wins':    p['wins'],
                'losses':  p['losses'],
                'daily_wins':   p['daily_wins'],
                'daily_losses': p['daily_losses'],
                'daily_points': p['daily_points'],
            }
        })
    finally:
        conn.close()


# ── 上报游戏结果（Node.js 服务端调用） ───────────────
@dice_bp.route('/api/dice/result', methods=['POST'])
def report_result():
    """
    body: { winner: "name", losers: ["name1", ...] }
    赢家 +100，输家 -100
    """
    data = request.json or {}
    winner_name = (data.get('winner') or '').strip()
    loser_names = data.get('losers') or []

    if not winner_name:
        return jsonify({'ok': False, 'error': 'winner required'}), 400

    conn = get_db()
    try:
        cursor = conn.cursor()

        # 赢家
        w = _get_or_create(cursor, winner_name)
        cursor.execute(
            'UPDATE dice_players SET points=points+100, wins=wins+1, '
            'daily_wins=daily_wins+1, daily_points=daily_points+100 '
            'WHERE id=%s',
            (w['id'],)
        )

        # 输家们
        for ln in loser_names:
            ln = (ln or '').strip()[:20]
            if not ln:
                continue
            lo = _get_or_create(cursor, ln)
            cursor.execute(
                'UPDATE dice_players SET points=GREATEST(0, points-100), losses=losses+1, '
                'daily_losses=daily_losses+1, daily_points=daily_points-100 '
                'WHERE id=%s',
                (lo['id'],)
            )

        conn.commit()
        return jsonify({'ok': True})
    finally:
        conn.close()


# ── 榜单 ─────────────────────────────────────────────
@dice_bp.route('/api/dice/leaderboard')
def leaderboard():
    """
    ?type=all  总榜（默认）
    ?type=daily 今日榜
    排名 = 积分×0.6 + 胜率×1000×0.4
    """
    lb_type = request.args.get('type', 'all')
    conn = get_db()
    try:
        cursor = conn.cursor(pymysql.cursors.DictCursor)

        # 先做每日重置检查（全表）
        today = date.today()
        cursor.execute(
            'UPDATE dice_players SET daily_wins=0, daily_losses=0, daily_points=0, '
            'points=GREATEST(points, 1000), last_reset=%s '
            'WHERE last_reset IS NULL OR last_reset < %s',
            (today, today)
        )
        conn.commit()

        if lb_type == 'daily':
            cursor.execute(
                'SELECT name, points, wins, losses, '
                '  daily_wins, daily_losses, daily_points, '
                '  (daily_wins + daily_losses) AS daily_games, '
                '  IF(daily_wins+daily_losses>0, daily_wins/(daily_wins+daily_losses), 0) AS daily_wr '
                'FROM dice_players '
                'WHERE daily_wins + daily_losses > 0 '
                'ORDER BY (daily_points * 0.6 + IF(daily_wins+daily_losses>0, daily_wins/(daily_wins+daily_losses), 0) * 1000 * 0.4) DESC '
                'LIMIT 50'
            )
        else:
            cursor.execute(
                'SELECT name, points, wins, losses, '
                '  daily_wins, daily_losses, daily_points, '
                '  (wins + losses) AS total_games, '
                '  IF(wins+losses>0, wins/(wins+losses), 0) AS win_rate '
                'FROM dice_players '
                'ORDER BY (points * 0.6 + IF(wins+losses>0, wins/(wins+losses), 0) * 1000 * 0.4) DESC '
                'LIMIT 50'
            )

        rows = cursor.fetchall()
        for i, r in enumerate(rows):
            r['rank'] = i + 1
            if 'win_rate' in r:
                r['win_rate'] = round(float(r['win_rate']) * 100, 1)
            if 'daily_wr' in r:
                r['daily_wr'] = round(float(r['daily_wr']) * 100, 1)

        return jsonify({'ok': True, 'type': lb_type, 'list': rows})
    finally:
        conn.close()
