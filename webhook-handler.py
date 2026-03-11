#!/usr/bin/env python3
"""
GitHub Actions Webhook 处理器
部署完成后发送通知到 QQ 群
"""

import json
import sys

# 从环境变量或参数获取 webhook 数据
if len(sys.argv) > 1:
    webhook_data = json.loads(sys.argv[1])
else:
    webhook_data = json.load(sys.stdin)

# 解析 GitHub webhook
event = webhook_data.get('event', '')
repository = webhook_data.get('repository', {}).get('full_name', '')
workflow = webhook_data.get('workflow', {}).get('name', '')
conclusion = webhook_data.get('workflow', {}).get('conclusion', '')
commit_message = webhook_data.get('head_commit', {}).get('message', '')
commit_author = webhook_data.get('head_commit', {}).get('author', {}).get('name', '')

# 只处理部署成功的事件
if event == 'workflow_run' and conclusion == 'success':
    message = f"""🚀 部署完成通知

仓库：{repository}
工作流：{workflow}
状态：✅ 部署成功

提交：{commit_message}
作者：{commit_author}

请刷新页面查看最新版本。"""
    
    print(message)
    sys.exit(0)
elif event == 'workflow_run' and conclusion == 'failure':
    message = f"""❌ 部署失败

仓库：{repository}
工作流：{workflow}
状态：部署失败

提交：{commit_message}
作者：{commit_author}

请检查 GitHub Actions 日志。"""
    
    print(message)
    sys.exit(1)
else:
    print(f"忽略事件: {event} - {conclusion}")
    sys.exit(0)
