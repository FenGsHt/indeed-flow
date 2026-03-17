#!/bin/bash

# Minesweeper Server Monitor Script
# 检查 PM2 中 minesweeper-server 服务状态，如果服务不在线则自动重启

LOG_FILE="/home/node/.openclaw/workspace-work-agent/logs/monitor.log"
SERVICE_NAME="minesweeper-server"
PM2_CMD="npx pm2"

# 获取当前时间
TIMESTAMP=$(date "+%Y-%m-%d %H:%M:%S")

# 记录日志函数
log() {
    echo "[$TIMESTAMP] $1" | tee -a "$LOG_FILE"
}

log "========== 开始检查服务状态 =========="

# 检查 PM2 进程状态
PM2_STATUS=$($PM2_CMD list 2>/dev/null | grep "$SERVICE_NAME")

if [ -z "$PM2_STATUS" ]; then
    log "⚠️ 服务 $SERVICE_NAME 未在 PM2 中找到"
    log "尝试启动服务..."
    cd /home/node/.openclaw/workspace-work-agent/indeed-flow/games/minesweeper && $PM2_CMD start ecosystem.config.js --env production 2>&1 | tee -a "$LOG_FILE"
    RESULT=$?
    if [ $RESULT -eq 0 ]; then
        log "✅ 服务启动成功"
    else
        log "❌ 服务启动失败"
    fi
else
    # 检查服务是否 online
    if echo "$PM2_STATUS" | grep -q "online"; then
        log "✅ 服务 $SERVICE_NAME 状态正常 (online)"
    else
        log "⚠️ 服务 $SERVICE_NAME 状态异常: $PM2_STATUS"
        log "尝试重启服务..."
        $PM2_CMD restart "$SERVICE_NAME" 2>&1 | tee -a "$LOG_FILE"
        RESULT=$?
        if [ $RESULT -eq 0 ]; then
            log "✅ 服务重启成功"
        else
            log "❌ 服务重启失败"
        fi
    fi
fi

log "========== 检查完成 =========="
echo "" >> "$LOG_FILE"