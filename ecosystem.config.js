module.exports = {
  apps: [
    {
      name: 'pm2-oscar-dashboard',
      script: './server.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 3003
      }
    }
  ]
};
