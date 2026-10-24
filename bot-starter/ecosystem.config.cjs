// pm2 process file: `pm2 start ecosystem.config.cjs && pm2 save`.
// The token is read from .token-Lala (chmod 600) or the BOT_TOKEN env var;
// it is never stored here.
module.exports = {
  apps: [
    {
      name: "lala",
      script: "node_modules/.bin/tsx",
      args: "src/live/bot.ts",
      cwd: __dirname,
      env: { BOT_NAME: "Lala" },
      autorestart: true,
      restart_delay: 2000,
      exp_backoff_restart_delay: 1000,
      max_memory_restart: "800M",
      out_file: "logs/lala.out.log",
      error_file: "logs/lala.err.log",
      time: true,
    },
    {
      name: "lala-logger",
      script: "node_modules/.bin/tsx",
      args: "src/live/logger.ts",
      cwd: __dirname,
      autorestart: true,
      restart_delay: 5000,
      out_file: "logs/logger.out.log",
      error_file: "logs/logger.err.log",
      time: true,
    },
    {
      // Refresh the full public history every 30 minutes for analysis.
      name: "lala-dump",
      script: "node_modules/.bin/tsx",
      args: "scripts/dump.ts data/raw",
      cwd: __dirname,
      autorestart: false,
      cron_restart: "*/30 * * * *",
      out_file: "logs/dump.out.log",
      error_file: "logs/dump.err.log",
      time: true,
    },
  ],
};
