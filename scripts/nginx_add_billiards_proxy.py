#!/usr/bin/env python3
"""
Add /billiards/ WebSocket proxy location to the nginx site config.
Safe to run multiple times (idempotent).
"""
import sys

CONF   = '/opt/1panel/www/conf.d/indeed.com.conf'
MARKER = 'billiards'

LOCATION = (
    '\n'
    '    location /billiards/ {\n'
    '        proxy_pass http://127.0.0.1:3006/;\n'
    '        proxy_http_version 1.1;\n'
    '        proxy_set_header Upgrade $http_upgrade;\n'
    '        proxy_set_header Connection "upgrade";\n'
    '        proxy_set_header Host $host;\n'
    '        proxy_set_header X-Real-IP $remote_addr;\n'
    '        proxy_cache_bypass $http_upgrade;\n'
    '        proxy_read_timeout 86400;\n'
    '    }\n'
)

with open(CONF, 'r') as f:
    content = f.read()

if MARKER in content:
    print(f'[skip] {MARKER} already present in {CONF}')
    sys.exit(0)

stripped = content.rstrip()
if not stripped.endswith('}'):
    print(f'[error] {CONF} does not end with }}, cannot insert safely')
    sys.exit(1)

new_content = stripped[:-1] + LOCATION + '}\n'

with open(CONF, 'w') as f:
    f.write(new_content)

print(f'[ok] Added /billiards/ proxy location to {CONF}')
