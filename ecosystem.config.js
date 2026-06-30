// PM2 process config. Build first (`npm run build`), then `pm2 start ecosystem.config.js`.
module.exports = {
  apps: [
    {
      name: "secretary-bot",
      script: "dist/index.js",
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      watch: false,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
