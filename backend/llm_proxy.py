#!/usr/bin/env python3
"""
LLM 代理 Blueprint
将前端 page-agent 的请求转发到 DashScope，API Key 仅存在后端环境变量中
"""

import os
import requests as http_requests
from flask import Blueprint, request, Response, jsonify, stream_with_context

llm_bp = Blueprint('llm', __name__)

LLM_TARGET_BASE = 'https://coding.dashscope.aliyuncs.com/v1'


@llm_bp.route('/api/llm/v1/chat/completions', methods=['POST'])
def proxy_chat_completions():
    api_key = os.getenv('LLM_API_KEY', '')
    if not api_key:
        return jsonify({'error': 'LLM_API_KEY not configured'}), 500

    headers = {
        'Authorization': f'Bearer {api_key}',
        'Content-Type': 'application/json',
    }

    body = request.get_json(silent=True) or {}
    is_stream = body.get('stream', False)
    target_url = f'{LLM_TARGET_BASE}/chat/completions'

    try:
        resp = http_requests.post(
            target_url, json=body, headers=headers,
            stream=is_stream, timeout=120,
        )
    except http_requests.RequestException as e:
        return jsonify({'error': f'LLM request failed: {e}'}), 502

    if is_stream:
        def generate():
            for chunk in resp.iter_content(chunk_size=None):
                if chunk:
                    yield chunk

        return Response(
            stream_with_context(generate()),
            status=resp.status_code,
            content_type=resp.headers.get('Content-Type', 'text/event-stream'),
        )

    return Response(
        resp.content,
        status=resp.status_code,
        content_type=resp.headers.get('Content-Type', 'application/json'),
    )


@llm_bp.route('/api/llm/v1/models', methods=['GET'])
def proxy_models():
    """page-agent 可能查询可用模型列表"""
    api_key = os.getenv('LLM_API_KEY', '')
    if not api_key:
        return jsonify({'error': 'LLM_API_KEY not configured'}), 500

    headers = {'Authorization': f'Bearer {api_key}'}
    target_url = f'{LLM_TARGET_BASE}/models'

    try:
        resp = http_requests.get(target_url, headers=headers, timeout=30)
        return Response(resp.content, status=resp.status_code,
                        content_type=resp.headers.get('Content-Type', 'application/json'))
    except http_requests.RequestException as e:
        return jsonify({'error': f'LLM request failed: {e}'}), 502
