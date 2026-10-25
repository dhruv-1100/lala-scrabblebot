# Lala: a ScrabbleBot tournament bot

Team **Yuvak**, bot **Lala**. Built on the official `bot-starter`.

| Path | What it is |
|---|---|
| `src/engine/` | Rules port (letter values, bag, rewards), packed ENABLE dictionary, word planner, public-state tracker |
| `src/strategy/` | Lala's valuation (`value.ts`), decision logic (`lala.ts`), tuned parameters (`params.ts`) |
| `src/sim/` | Match simulator, reference opponents, parallel arena, coordinate-search tuner |
| `src/live/` | Live bot runtime (`bot.ts`), cache-to-view builder, public-table logger |
| `analysis/` | Historical analysis of the live database (`report.ts`) |
| `scripts/` | `dump.ts` (snapshot every public table), probes, benchmarks, traces |
| `ANALYSIS.md` | Findings and the strategy change each one caused |

## Results

Live, 25 Oct 2026 (6-bot Vickrey lobby matches against the full field):

| Version | Games | Wins | Avg place | Avg score | Rating |
|---|---|---|---|---|---|
| v2.7.4 (site version 7) | 133 | 19% | 3.09 | 81.1 | 1933 +/- 97 after 66 games |
| v2.7.5 (site version 8, from 06:42 UTC) | 8 | 0% | 3.63 | 78.8 | 1688 +/- 193 (provisional) |

An average bot in a 6-bot field wins 17% with average place 3.5. The current leaders
(Waupus, james) win 49-56%. See ANALYSIS.md §13 for what was learned from them and why
v2.7.5 tightens the price cap.

## Setup

Node 20+.

```bash
cd bot-starter
npm install
npm run bindings      # copies the repo's generated bindings (no spacetime CLI needed)
npm test              # scoring, dictionary, planner, tracker, strategy, simulator
```

`npm run generate` also works if you have the `spacetime` CLI 2.12 installed.

## Getting the token (needs your login)

1. Open https://scrabblebot.spacetimedb.com/account and link your spacetimedb.com
   identity: install the `spacetime` CLI, run `spacetime login`, then run the
   `spacetime call scrabblebot connect_id '["0x…"]'` line the page shows, and refresh.
2. Open `/team/new`, team name **Yuvak**, bot name **Lala**, create.
3. On `/team`, click **Generate token** and copy it (shown once).
4. Save it where only you can read it, not in git:
   ```bash
   printf '%s' 'PASTE_TOKEN_HERE' > .token-Lala && chmod 600 .token-Lala
   ```

## Running

```bash
npm run bot                          # plays lobby matches forever (BOT_NAME defaults to Lala)
DRY_RUN=1 npm run bot                # connects and logs decisions without calling reducers
TOURNAMENT_ID=7 npm run bot          # also registers for tournament 7 on connect
npm run logger                       # anonymous public-table logger -> data/stream/
npm run dump                         # snapshot full public history -> data/raw/
npx tsx analysis/report.ts 600       # analysis tables over the last 600 matches
```

The bot bids on every auction the moment it opens, plays words, rejoins the lobby
after each match, reconnects with backoff and writes JSONL logs to `data/live/`
(`decisions-*.jsonl`, `matches-*.jsonl`, `errors-*.jsonl`).

### Always-on with pm2

Run this on a machine that stays up (not a laptop that sleeps, not an ephemeral sandbox):

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs       # lala, lala-logger, lala-dump (every 30 min)
pm2 save && pm2 startup              # survive reboots
pm2 logs lala
```

For a tournament, set `TOURNAMENT_ID` in `ecosystem.config.cjs` (`env`) and
`pm2 restart lala --update-env`, then check that Lala is listed on `/tournament`.

## Simulator and arena

```bash
# 2000 matches of Lala vs 5 calibrated market bots, with 95% CIs
npm run arena -- --field market --n 2000
# paired comparison on identical seeds: candidate vs base parameters
npm run arena -- --field market --n 2000 --params '{"mu0":0.4}' --base '{}'
# other fields: sims (module's sim bots), starter, self (Lala clones), mixed, lalamix
npm run arena -- --field self --n 1000
# fields: market, livelike, pop, top (the late-2026 leaders; matches live Lala best)
# phase profile of one simulated seat (coins on hand, tiles, bid levels per stage)
npx tsx src/sim/profile.ts --field top --n 300
# paired sweep: base once, then each variant on the same seeds
npx tsx src/sim/sweep.ts --field top --n 400 --variants '[{"capMul":1.35},{"mu0":0.36}]'
# live phase profile of any bot vs Lala, and Lala's record since a time
npx tsx analysis/study.ts 138 80
npx tsx analysis/since.ts 2026-10-25T06:42:05Z
# coordinate search
npm run tune -- --field market --n 280 --grid '{"mu0":[0.3,0.4]}'
```

`src/sim/sim.ts` follows `spacetimedb/src/game.ts`: the same draw order, shuffled
ties, Vickrey payment (second bid, or 1 when alone), first-price payment, balance
checks, unsold tiles discarded, and the match ending as the last auction closes.
