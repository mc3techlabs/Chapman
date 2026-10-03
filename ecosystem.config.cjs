// PM2 process config for the sandbox dev preview.
// Runs `wrangler pages dev dist` on port 3000 after a build.
//
// Usage:
//   npm run build && pm2 start ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'chapman-portal',
      script: 'npx',
      args: 'wrangler pages dev dist --ip 0.0.0.0 --port 3000',
      env: {
        NODE_ENV: 'development',
        PORT: 3000
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork'
    }
  ]
}
