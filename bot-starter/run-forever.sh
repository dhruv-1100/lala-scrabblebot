#!/bin/sh
# Minimal supervisor for machines without pm2: restarts the bot whenever it
# exits (crash, drain, lost token file) after a short pause.
cd "$(dirname "$0")"
mkdir -p logs
while true; do
  BOT_NAME="${BOT_NAME:-Lala}" ./node_modules/.bin/tsx src/live/bot.ts >> logs/lala.out.log 2>&1
  echo "$(date -u +%FT%TZ) bot exited with $?; restarting in 3s" >> logs/lala.out.log
  sleep 3
done
