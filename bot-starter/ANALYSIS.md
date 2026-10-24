# Lala: analysis log

Each finding lists the evidence and the change it caused. Numbers marked "sim" come
from the arena (`src/sim/arena.ts`, 95% CIs); "live" numbers come from the public
database (`npm run dump`, `analysis/*.ts`) and Lala's own logs (`analysis/live.ts`).

## 1. Data

- Snapshot of every public table on 2026-10-24: 2,330 ended matches, 158,800 auctions,
  39,000 word plays, 158,576 archived winning bids, 75 bots. Refreshed later to 2,769 matches.
- The brief expected an empty site; it wasn't. Since match ~500 every match has had six
  real bots (no sim padding), so the history *is* the competition.
- Analyses below use the last 600 matches unless stated (`analysis/report.ts 600`).

## 2. Rules as implemented (checked against `spacetimedb/src/*.ts`)

The module is TypeScript now; there is no `lib.rs`. Where code and docs disagree, the
simulator follows the code:

| Brief / docs | Code (`game.ts`, `lobby.ts`) |
|---|---|
| Ties go to the earlier submission | Bids are shuffled, then stable-sorted: ties are random |
| Unbid tiles return to the bag | Unsold tiles are discarded (`closeAuction` never re-adds them) |
| Lobby open 60 s | `LOBBY_DURATION_SECONDS = 90` |
| Padding with idle sims | All six sims (Cheapskate/ValueBidder/Aggressive) are eligible |
| `auction_result.top_bid` public | Removed; winning bids appear in `auction_top_bid_archive` after the match ends |

Other rules that matter for strategy:
- A bid above your current balance is rejected outright (`Insufficient balance`); a bid
  can be replaced any time before close.
- Vickrey payment is the second bid, or 1 if you are the only bidder.
- The match ends the instant the last auction closes, so **a tile won in the final
  auction can never be played**, and words must be in before that close. `bag_total`
  is public, so the bot always knows how many auctions are left.
- `match_participant` (everyone's balance and score) is public.

**Possible module issue (reported, not used):** `visible_auction_top_bids` hides live
winning bids only from identities that hold a bot credential. Any other identity, such
as an anonymous second connection, can read the winning bids of running matches. A bot
operator could watch rivals' valuations mid-match that way. Lala does not.

## 3. The market

| Finding | Evidence (live, last 600 matches) | Change |
|---|---|---|
| Tiles trade at ~10x face value | 1-pt letters: paid 10-11, winning bid 13-15. Z 35, X 31, Q 26, J 27 | Price table `LIVE_PAID` (median paid per letter) is Lala's prior for what letters cost; it rescales to the prices seen in each match |
| High-value letters are underpriced | Marginal points per coin: Q 0.85, J/K/V/W 0.69-0.70, Z 0.68 vs 0.52-0.55 for 1-pt letters | Leftover tile value has a per-point term (`kappa1`); tuning took win rate from 47% to 56% (sim, market field) |
| Early tiles are the best buys; late ones the worst | pts/coin: rounds 1-25 0.67-0.69, 41-55 0.54, 56-63 0.40, 64-66 0.30 | Shadow price of coins `mu` falls as the match runs out instead of being constant; bid caps tested (section 6) |
| Prices rise at the end | 1-pt price by 5-round bucket: 11.5, 10.6, 10.3 ... 11.4, 11.5, 12.0 | The simulated market had to reproduce this before its results could be trusted (section 5) |
| The final tile is worthless, yet 49% are bought | Paid 1.3 on average for a tile nobody can play | Lala bids 0 in the final auction and goes all-in at the second-to-last only if the letter improves its cash-out |
| 94% of bought tiles get played | 0.89 tiles unplayed per bot at the end | Lala cashes out with an exact branch-and-bound partition (`bestPartition`) |

## 4. What winners do

| | score | tiles | coins spent | words | 7+ words | first word (round) | final balance |
|---|---|---|---|---|---|---|---|
| winner | 105 | 14.3 | 184 | 3.2 | 1.73 | 27 | 21 |
| 2nd-5th | 75 | 11.4 | 151 | 2.8 | 1.36 | 31 | 24 |
| last | 41 | 7.6 | 101 | 2.3 | 0.67 | 34 | 40 |

Winners buy more tiles, which takes more coins, which come from playing words earlier.
Points by phase: winners score 39 in rounds 0-33 and 49 in rounds 34-59; only ~5 in the
final window. Nobody in the live field hoards to the end.

Game-changing purchases are high-value letters bought cheaply late and completed into a
7-letter word: e.g. Z or Q for 3-4 coins in rounds 54-63, worth +34-35 points. The costliest
mistakes are high-value tiles bought early and never played (a Z for 49 coins in round 7).

Bidding styles (winning bid / median price for that letter): most strong bots sit at
1.1-1.3x; the most aggressive (1.4-2.0x) are mid- or low-ranked. Sim bots haven't played
since match ~500.

## 5. Simulator and opponent models

`src/sim/sim.ts` follows `game.ts`: same draw procedure, shuffled ties, payment rules,
balance checks, discarded unsold tiles, start racks of 5, end on the last close.
Agents act at auction open (words, then bid), as the live bot does; the module's sim bots
play their longest 3+ letter word right after winning, as `simulateWordPlay` does.

Opponent fields, and what each taught:

1. **Module sims / starter.** Lala scores ~250 against them; useless for tuning.
2. **Market bots** (`MarketBot`): bid the live median price x lognormal noise x rack fit,
   hold for 7-letter words, dump at the end. Calibrated to live price levels, tiles
   (11.2/bot), spend and balance. First version let prices collapse late (5 coins in
   rounds 61-65 vs 12 live) because the bots didn't pace their budgets; Lala won 70% by
   buying everything cheaply at the end. Adding budget pacing fixed the curve and cut
   Lala's sim win rate to ~50%. **Lesson: check the price curve by stage, not just levels.**
3. **Live-like rivals** (`LIVELIKE`): the Lala engine set to cash 7-letter words as soon
   as they form, with bid noise and a late reserve. Calibrated to live: 2.8 words/bot,
   1.35 7+ words/bot, 11.1 tiles/bot, place scores 96/83/73/66/59/50 (live 105/91/80/71/61/41),
   and the live price curve including the late rise. This is the main tuning field; it is
   still somewhat weaker than the live field at the top.

## 6. Strategy and tuning history

Lala values a rack by its best plan: for each dictionary word it could complete, the
probability of getting the missing letters (Poisson over remaining auctions, x win rate)
times the reward, minus the coin cost of those letters at the shadow price `mu`, plus a
leftover value for tiles the word doesn't use. One pass over the 2-8 letter words gives
the value with and without the letter on auction; the difference, divided by `mu`, is the
Vickrey bid. Words are played when cashing beats holding.

| Step | Result | Kept? |
|---|---|---|
| v0: plan value only, leftover tiles worth ~1 pt | place 4.9/6 vs market; bid 1-2 on empty racks | no |
| Leftover value = usefulness of the letter in 7-8 letter words + per-point term | win 48% / place 2.09 (sim, market) | yes |
| Coordinate search (n=280/step) | win 67% / place 1.67 (market, pre-pacing) | yes, then retuned |
| Retune vs paced market (n=420/step) | mu0 0.30, muAlpha 0.6, share 0.2, winP 0.9; win 52% / place 1.98 (n=1400) | yes |
| Ties between hold and play go to play | QUIXOTE no longer held | yes |
| Soft-max over plans instead of max | place 3.31 -> 5.61 as tau grows (letters' marginal value shrinks) | no |
| Play earlier (lower playK, 7-letter minimum, coin-scarcity bonus) | worse in every field: e.g. place 2.57 -> 2.85 (sim, live-like) | no |
| Later reserve (`lateMu` 0.6) | place 2.57 -> 2.51 (n.s.) | see section 7 |

## 7. Live results

(filled in from `analysis/live.ts`; see the summary at the end)
