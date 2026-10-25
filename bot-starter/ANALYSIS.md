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
| Later reserve (`lateMu` 0.6) | place 2.57 -> 2.51 (n.s.) | yes, with the cap |
| Vowel-balance bonus | place 2.49 -> 2.63 / 2.86 | no |
| Bid cap 1.6x the going price + late reserve (v1.1) | paired n=1000 vs v1.0 on live-like rivals: place -0.148 +/- 0.053, win +2.8 +/- 2.1 pts, score +1.4 +/- 0.6 | yes (`lala-v1.1`) |

Parameter search has plateaued: the last nine variants all moved average place by less than
the CI (+/-0.13 at n=420). Further gains need structural changes (see the v2 research report).

## 7. Live results

Lala (team Yuvak, bot id 88) started live play on 2026-10-24 at 15:44 UTC.

| Version | Matches | Win rate | Avg place | Avg score | Field avg | Best rival |
|---|---|---|---|---|---|---|
| v0.1 (`lala-v0.1`) | 41 | 15% | 3.3 | 80 | 77 | 106 |
| v1.1 (`lala-v1.1`), first 11 | 11 | 18% | 3.36 +/- 0.80 | 78 | 69 | 107 |

Rating after 52 matches: **1916 +/- 106 (ranked 25th of 78)**, 8 wins, no provisional flag.
Decision latency: compute p50 8 ms, p99 32 ms; bids land 20-70 ms after an auction opens;
0 fallback bids, 0 refused words, 0 disconnects.

**Sim vs live.** Against live-like rivals the simulator predicts place ~2.4-2.5; live is ~3.3.
Lala's own score is about the same in both (84 sim vs 80 live); the gap is the field:
live rivals score more than the simulated ones (best rival 106 vs ~98). The live winners
in Lala's matches play their first word at round ~28 (Lala ~38) and spend ~195 coins
(Lala ~164) on ~14 tiles (Lala ~12.5). Earlier play does not help Lala in any simulated
field, so this is the main open question for v2.

## 8. v2.3: bid the model's value

The module is a Vickrey auction (`game.ts`: winner pays the runner-up, or
`AUCTION_RESERVE` (1) if they are the only bidder). A bid above balance is
rejected. Unsold tiles are discarded, not returned to the bag. The simulator
and the live bot already follow that. The public docs disagree on the bag and
on a 60-second lobby (`LOBBY_DURATION_SECONDS` is 90); the bot follows the module.

`lateMu` 0.6 cut the shadow price of coins for the last 12 auctions, which
raises the bid to 1.67× what `marginal / mu` says the letter is worth. In the
v2 live log, once 8 auctions remain the bid equals the balance on about 70% of
auctions, so a mediocre letter and a finishing letter cost the same coins.
v2.3 sets `lateMu` to 1. The horizon term in `mu()` still spends coins that
will be worthless. Paired n=500 against v2.2: on the pop field (Lambi, Dante,
Nijello, postturing styles) place −0.056 ± 0.052 and score +1.6 ± 0.5; on
live-like rivals score +0.9 ± 0.5 and place unchanged.

**Live outcome of v2.3 (reverted in v2.4).** 11 live games: 9% wins, place 3.45 +/- 0.89,
score 68, the weakest v2 version. Combined with the earlier sim evidence for a late
reserve (v1.1), `lateMu` went back to 0.6.

## 9. Live results by version (`analysis/versions.ts`)

| version | games | win% | avg place | avg score | what changed |
|---|---|---|---|---|---|
| v0.1 | 42 | 14 | 3.31 | 81 | first live version |
| v1.1 | 79 | 13 | 3.27 | 81 | late reserve, 1.6x price cap |
| v2.0 | 17 | 41 | 2.29 | 103 | learned leave table, vowel fix, stage prices |
| v2.1 | 8 | 25 | 2.88 | 89 | sim retune (premium 0.9, cap 1.4x) |
| v2.2 | 38 | 26 | 2.97 | 81 | v2.0 + starvation cash-in rule |
| v2.3 | 11 | 9 | 3.45 | 68 | v2.2 + lateMu 1 (Cursor) |
| v2.4 | 1 | 0 | 6 | 54 | v2.0 settings restored |

Opponent strength differed (average current rating of Lala's opponents: v2.0 1682,
v2.2 1757, v2.3 1823), so part of v2.0's lead is an easier field. But Lala's own score
fell 22 points from v2.0 to v2.2 while v2.2's best rivals scored *less* (101 vs 109):
the starvation rule cashes 5-6 letter words at 2-2.5x instead of 7+ at 3x. v2.4 drops it.

## 10. Reverse-engineering the top bots (`analysis/reverse.ts`, last 1200 matches)

Each bot's rack and balance were rebuilt round by round from public results, archived
winning bids and word plays.

| | top bots (Dante, Nijello, postturing, Lambi, Metheny, Doppio) | Lala |
|---|---|---|
| bid/price, letter that completes a word within 1 round vs other letters | 1.19-1.42 vs 1.09-1.24 | 1.18 vs 1.20 |
| share of buys that complete a word within 1 round | 16-27% | 14% |
| median rounds from buying a tile to playing it | 7-11 | 13 |
| points per letter in 7+ letter words | 1.98-2.22 | 1.94 |
| 7+ letter words per match | 1.40-1.80 | 1.43 |
| rounds with < 12 coins (rounds 10-60) | 1.3-8.5 | 7.8 |

**Change (v2.5):** the top bots pay a premium for a letter that finishes a word now; Lala
paid less than for other letters, because its valuation assumes a missing letter will
probably come later. Lala now bids at least 1.4x the going price when the letter
completes a 6+ letter word worth 12+ more points. Paired sim (market, n=1200):
place -0.128 +/- 0.081, score +2.1 +/- 1.1. 1.55x was slightly worse (place -0.102).

Not yet acted on: the top bots' 7+ words use higher-value letters (2.05-2.22 points per
letter vs 1.94) and they turn tiles over faster (7-11 rounds vs 13).

## 11. Later experiments (v2.5 -> v2.5.1)

| Idea | Evidence | Result |
|---|---|---|
| Boost 4+ point letters (top bots buy 2.2-2.8 per match, Lala 1.87) | paired sim, market n=1200: place +0.132 +/- 0.071 at 1.15x | rejected |
| Value coins from plays at the leave table's own points-per-coin | paired sim: place +0.751, score -13.9 | rejected (agrees with v2.2's live score drop) |
| Diminishing returns for racks over 7 leftover tiles; affordability-scaled win chance | changed no decisions in the broke-rack cases; not shipped | parked |
| Tile pacing (raise bids when behind 0.22 tiles/auction) | paired sim: place +0.075 +/- 0.050 | rejected |
| Stall watchdog: rebuild the connection after 5 s without an auction mid-match | match 3967 stalled ~70 s and scored 0 | shipped in v2.5.1 |

v2 overall (97 live games to 20:40): 24% wins (v1 13%) but 11% last places (v1 3%).
Last-place games: 7.5 tiles bought, 66 coins unspent at round 20, first word at round 58,
i.e. timid early, not broke. Two of the 11 were infrastructure (a stalled socket, an outside
restart). Every simulated fix for the timid starts (pacing, coin value, high-value boost)
made things worse, so v2.5.1 keeps the v2.5 strategy and only adds the watchdog.

## 12. Learning from real matches (v2.6, v2.6.1)

Checked first: the new docs site (launchpad-scrabblebot.vercel.app/docs) points at the same
database and repeats the old rules text; the upstream repo has no commits since our clone, so
the simulator still matches the server.

**Real-game leave table (v2.6).** Racks rebuilt for every bot in 2,500 live matches (won tiles,
plus starting tiles revealed by later words): 190k snapshots, future score regressed on rack
contents (R² 0.66-0.75). Real racks are worth ~40% more per tile than simulated ones; vowels
again score at or above 1-point consonants; most high-value letters are worth less relative
to an A than the simulation says (Z 3.5x vs 4.1x). Paired sim vs v2.5.1 by scale: 0.4 slightly
worse, **0.5 win +4.0 +/- 3.2 pts, place -0.117 +/- 0.072**, 0.6 much worse (+0.46).

**Recent prices (v2.6.1).** Refit on the latest 900 matches: high-value letters 2-5 coins
cheaper mid/late (mid Z 40 -> 35, late Q 23 -> 18), 1-point letters unchanged. Sim neutral
(its market bots still price from the old table), shipped because the live market moved.

## 13. v2.7.x: a calibrated field, and the price cap (v2.7.4, v2.7.5)

**What happened between §12 and here.** v2.6/v2.6.1 and the later v2.8 bandit (per-match
strategy arms) both lost live and were reverted; v2.7.3 is exactly the v2.7 code. The live
runtime gained a stall watchdog, drain restarts (`touch .drain`) and version logging.

**v2.7.4: narrow starvation rule.** Live games showed Lala broke for 15-25 rounds while holding
a complete 7-8 letter word. Below 8 coins with 10+ auctions left, cash the best 7+ letter word.
Paired sim (market, n=1200): win +3.8 +/- 1.9 pts, place -0.139, last places 2.9% -> 1.2%.

**Ideas that stayed off** (all neutral in paired sim vs v2.7.4, n=1200-1600; code kept, default
off): mid-game thrift (`midN/midMu`), chasing 1st late (`chaseN/chaseGap/chaseUp`), focus on the
best target word's letters (`focusMul/focusCut/focusT`, modelled on Lambi Lambiii).

**The leaders, late 2026** (`analysis/study.ts`, live phase profiles):

| | wins | coins at round 20 / 45 / 56 | rounds 1-20: tiles, spent, bid/price | rounds 46-68: tiles | late word points |
|---|---|---|---|---|---|
| Waupus | 51% | 60 / 39 / 26 | 3.9, 49, 1.10 | 4.6 | 31 |
| james | 38% | 61 / 42 / 25 | 2.9, 49, 1.19 | 4.9 | 22 |
| Lala v2.7.x | 11% | 47 / 15 / 18 | 4.3, 66, 1.36 | 2.5 | 18 |

**The simulator was too easy.** `src/sim/profile.ts` prints the same profile for a simulated
seat. In every existing field Lala won 42-57% (live: 11-19%) and bought ~3.3 early tiles for
~50 coins (live 4.3 for 66), so tuning there never carried over. The new **`top` field**
(`TOP_STYLES`: two Waupus-style rivals, one james-style, one Lambi-style, one v2.7-like)
reproduces live Lala: 17-22% wins, place 3.05-3.16, score 78-80, 4.1 early tiles for 62 coins,
49 coins at round 20.

**Copying Waupus does not help.** In the top field a Waupus-like Lala (early bids x0.8, late
reserve) placed 3.31-3.51 vs 3.05-3.16: the leaders' thrift is a symptom of something else
they do better, not the cause.

**v2.7.5: price cap 1.6x -> 1.25x the going price.** Screen in the top field (n=300 each, 9
variants): only `capMul 1.35` won significantly; more aggression (`mu0 0.25`), a bigger
completion premium (1.7) and turning the starvation rule off were all worse. Fresh seeds
(n=900, paired): capMul 1.35 win +4.6 +/- 2.3 pts, place -0.16; **capMul 1.25 win +5.0 +/- 2.7
pts (21% -> 26%), place -0.23 +/- 0.08, score +2.8, rating value +0.095 +/- 0.038.** Shipped
06:42 UTC 25 Oct. The completion premium (1.4x for a letter that completes a 6+ letter word
worth 12+ more points) still lifts bids above the cap.

**Live record.** Site version 7 (v2.7.4, 03:58-06:42 UTC 25 Oct): 133 clean games, 19% wins,
average place 3.09, average score 81.1, rating 1933 +/- 97 at 66 games. Site version 8
(v2.7.5) started 06:42 UTC; first 8 games: 0 wins, place 3.63, score 78.8 (too few to judge).
