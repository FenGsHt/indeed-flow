# indeed-flow 项目说明

## 项目结构

```
indeed-flow/
  src/              # Vite 前端源码（main.js、style.css）
  public/data/      # 静态数据文件，构建时复制到 dist/data/
  index.html        # 主页（内联 CSS/JS，Vite 构建不生成 assets/）
  games.html        # 游戏列表页
  backend/          # Flask 后端（app.py、games_api.py）
  games/minesweeper/
    client/         # 扫雷前端（index.html、app.js、style.css）
    server/         # 扫雷 Node.js 服务（server.js、game.js）
  .github/workflows/deploy.yml  # CI/CD 自动部署
```

## 服务器信息

- **地址**: 150.158.110.168
- **部署用户**: openclaw
- **Web 服务**: OpenResty，运行在 Docker 容器 `1Panel-openresty-EfE4`
- **nginx 配置**: `/opt/1panel/www/conf.d/indeed.com.conf`，端口 9000
- **prod 目录**: `/opt/1panel/www/sites/indeed-flow-prod/`（nginx root 指向此处）
- **openclaw workspace**: `/opt/1panel/apps/openclaw/openclaw/data/conf/workspace-work-agent/indeed-flow/`（与 prod 独立分开）

## 各服务

| 服务 | 类型 | 路径 |
|------|------|------|
| 前端静态文件 | nginx 静态托管 | `/opt/1panel/www/sites/indeed-flow-prod/` |
| Flask 后端 | systemd `flask-app` | `/opt/1panel/www/sites/indeed-flow-prod/backend/` |
| 扫雷 Socket.io 服务 | pm2 `minesweeper-server`，端口 3002 | `/opt/1panel/www/sites/indeed-flow-prod/games/minesweeper/server/` |

- Flask 重启：`sudo systemctl restart flask-app`
- pm2 需要先加载 nvm：`export NVM_DIR=$HOME/.nvm && . $NVM_DIR/nvm.sh`

## CI/CD

- push 到 `main` 分支自动触发 GitHub Actions
- `SERVER_PATH` secret = `/opt/1panel/www/sites/indeed-flow-prod`
- 前端用 `rsync` 同步 `dist/`，后端和扫雷服务用 `scp`
- 部署完成后通过 Bark 推送通知

## GitHub Secrets

| Secret | 用途 |
|--------|------|
| SERVER_USER | openclaw |
| SERVER_HOST | 150.158.110.168 |
| SERVER_SSH_KEY | ed25519 私钥 |
| SERVER_PATH | /opt/1panel/www/sites/indeed-flow-prod |
| DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME | Flask 数据库连接 |
| BARK_KEY | 部署通知推送 |
