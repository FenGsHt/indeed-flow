#!/usr/bin/env python3
"""
2026-03-19: 共享数据库连接池
替代各模块中的 pymysql.connect() 单连接模式
"""

import os
import pymysql
from dbutils.pooled_db import PooledDB

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

_pool = PooledDB(
    creator=pymysql,
    maxconnections=20,
    mincached=2,
    maxcached=10,
    blocking=True,
    ping=1,
    **DB_CONFIG,
)


def get_db():
    """从连接池获取一个连接"""
    return _pool.connection()
