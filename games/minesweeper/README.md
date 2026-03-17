# 多人实时扫雷游戏

一个支持多人实时对战的网页扫雷游戏，基于 WebSocket 实现实时状态同步。

## 项目结构

```
minesweeper/
├── client/                 # 前端静态文件
│   ├── index.html
│   ├── style.css
│   └── app.js
├── server/                 # 后端服务
│   ├── server.js          # WebSocket 服务
│   └── game.js            # 游戏逻辑
├── scripts/                # 脚本
│   ├── start-server.sh    # 启动后端
│   ├── stop-server.sh     # 停止后端
│   └── start-client.sh    # 启动前端
├── logs/                   # 日志目录
├── ecosystem.config.js    # PM2 配置
└── README.md
```

## 快速启动

### 1. 安装依赖

```bash
cd server
npm install
```

### 2. 启动服务

#### 方式一：使用脚本（推荐）

```bash
# 启动后端服务
./scripts/start-server.sh

# 启动前端服务（新终端）
./scripts/start-client.sh
```

#### 方式二：手动启动

```bash
# 终端1：启动后端 (PM2)
pm2 start ecosystem.config.js

# 终端2：启动前端
cd client
python3 -m http.server 8080
```

### 3. 访问游戏

打开浏览器访问：`http://localhost:8080`

## 服务说明

| 服务 | 端口 | 说明 |
|------|------|------|
| 后端 | 3001 | Node.js + Socket.io WebSocket 服务 |
| 前端 | 8080 | Python http.server 静态文件服务 |

## PM2 管理命令

```bash
# 查看状态
pm2 list
pm2 status

# 查看日志
pm2 logs minesweeper-server

# 重启服务
pm2 restart minesweeper-server

# 停止服务
pm2 stop minesweeper-server

# 开机自启设置
pm2 startup
pm2 save
```

## 部署到服务器

### 1. 安装 Node.js 和 PM2

```bash
# 安装 Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 安装 PM2
sudo npm install -g pm2
```

### 2. 上传代码

```bash
# 使用 scp 上传
scp -r ./minesweeper user@your-server:/path/to/
```

### 3. 安装依赖并启动

```bash
cd /path/to/minesweeper
cd server && npm install

# 启动后端
pm2 start ecosystem.config.js

# 设置开机自启
pm2 startup
pm2 save
```

### 4. 使用 Nginx 反向代理（可选）

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # 前端静态文件
    location / {
        root /path/to/minesweeper/client;
        try_files $uri $uri/ /index.html;
    }

    # WebSocket 代理
    location /socket.io/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

## 游戏规则

1. 输入房间号和昵称加入游戏
2. 第一个点击的玩家触发地雷生成
3. 所有玩家实时同步游戏状态
4. 踩到地雷游戏结束

## 技术栈

- **后端：** Node.js + Express + Socket.io
- **前端：** 原生 JavaScript + Socket.io-client
- **进程管理：** PM2
- **静态服务：** Python http.server