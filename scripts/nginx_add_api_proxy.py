#!/usr/bin/env python3
"""
Add /api/ reverse proxy location to the nginx site config.
Proxies all /api/* requests to Flask backend at 127.0.0.1:5001.
Safe to run multiple times (idempotent).
"""
import sys

CONF   = '/opt/1panel/www/conf.d/indeed.com.conf'
MARKER = 'location /api/'

LOCATION = (
    '\n'
    '    location /api/ {\n'
    '        proxy_pass http://127.0.0.1:5001/api/;\n'
    '        proxy_http_version 1.1;\n'
    '        proxy_set_header Host $host;\n'
    '        proxy_set_header X-Real-IP $remote_addr;\n'
    '        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n'
    '        proxy_set_header X-Forwarded-Proto $scheme;\n'
    '        proxy_read_timeout 300;\n'
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

print(f'[ok] Added /api/ proxy location to {CONF}')
