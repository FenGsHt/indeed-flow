module.exports = {
  apps: [{
    name: 'minesweeper-server',
    script: './server/server.js',
    cwd: '/home/node/.openclaw/workspace-work-agent/indeed-flow/games/minesweeper',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '200M',
    log_file: './logs/server.log',
    error_file: './logs/server-error.log',
    out_file: './logs/server-out.log',
    env: {
      NODE_ENV: 'production',
      PORT: 3001
    }
  }]
};