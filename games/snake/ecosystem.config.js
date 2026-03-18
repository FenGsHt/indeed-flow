module.exports = {
  apps: [{
    name: 'snake-server',
    script: 'server/server.js',
    instances: 1,
    autorestart: true,
    watch: false,
    env: {
      PORT: 3003,
      NODE_ENV: 'production',
    },
  }],
};
