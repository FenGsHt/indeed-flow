module.exports = {
  apps: [{
    name: 'uno-server',
    script: 'server/server.js',
    instances: 1,
    autorestart: true,
    watch: false,
    env: {
      PORT: 3004,
      NODE_ENV: 'production',
    },
  }],
};
