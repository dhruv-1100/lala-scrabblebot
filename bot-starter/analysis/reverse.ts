// Reverse-engineer bots' policies from public data: rebuild each bot's rack
// and balance round by round, then measure how it buys and when it plays.
//   npx tsx analysis/reverse.ts [recentMatches=1200]
import { load, groupBy, mean, quantile } from "./load.js";
import { VALUE, idx } from "../src/engine/letters.js";
const RECENT = Number(process.argv[2] ?? 1200);
const ms = load("matchState").filter((m) => m.status === "Ended").sort((a, b) => a.id - b.id).slice(-RECENT);
const ids = new Set(ms.map((m) => m.id));
const names = new Map(load("bot").map((b) => [b.id, b.name]));
const results = groupBy(load("auctionResult").filter((r) => ids.has(r.matchId)), (r) => r.matchId);
const tops = new Map(load("auctionTopBidArchive").filter((t) => ids.has(t.matchId)).map((t) => [t.auctionId, t.topBid]));
const words = groupBy(load("wordPlay").filter((w) => ids.has(w.matchId)), (w) => w.matchId);
const parts = groupBy(load("matchParticipant").filter((p) => ids.has(p.matchId)), (p) => p.matchId);
const PAID = [11, 16, 17, 14, 11, 19, 12, 21, 10, 29, 23, 11, 17, 10, 10, 16, 28, 11, 12, 10, 10, 18, 18, 31, 21, 38];

type Acc = {
  games: number; place: number[]; score: number[];
  hold: number[];            // rounds from purchase to use
  completeRatio: number[];   // bid/price for tiles used within 1 round (word-completing buys)
  otherRatio: number[];      // bid/price for the rest
  completeShare: number[];   // share of bought tiles that completed a word within 1 round
  rackAtPlay: number[];      // tiles held when a 6+ letter word is played
  balAtPlay: number[];       // coins when a 6+ letter word is played
  baseMid: number[];         // base value per letter, words of 7+
  firstBig: number[];        // round of first 7+ word
  bigWords: number[];        // 7+ words per game
  cheapLate: number[];       // share of tiles bought for <= 0.6x price
  lowBal: number[];          // rounds spent with < 12 coins (rounds 10-60)
};
const acc = new Map<number, Acc>();
const get = (b: number): Acc => {
  let a = acc.get(b);
  if (!a) acc.set(b, (a = { games: 0, place: [], score: [], hold: [], completeRatio: [], otherRatio: [], completeShare: [], rackAtPlay: [], balAtPlay: [], baseMid: [], firstBig: [], bigWords: [], cheapLate: [], lowBal: [] }));
  return a;
};
for (const m of ms) {
  const rs = (results.get(m.id) ?? []).sort((a, b) => a.auctionId - b.auctionId);
  const ws = (words.get(m.id) ?? []).sort((a, b) => a.playedAt - b.playedAt || a.id - b.id);
  const ps = parts.get(m.id) ?? [];
  for (const p of ps) {
    const a = get(p.botId);
    a.games++;
    a.place.push(1 + ps.filter((q) => q.score > p.score).length);
    a.score.push(p.score);
    // Timeline of this bot.
    const mine = rs.map((r, i) => ({ ...r, round: i + 1 })).filter((r) => r.winnerBotId === p.botId);
    const myWords = ws.filter((w) => w.botId === p.botId).map((w) => ({ ...w, round: rs.filter((r) => r.closedAt <= w.playedAt).length }));
    const tiles = mine.map((r) => ({ letter: r.letter, round: r.round, paid: r.paid, top: tops.get(r.auctionId) ?? r.paid, usedAt: -1 }));
    let held = 5, bal = 100, ti = 0, wi = 0, completing = 0, firstBig = 68, big = 0, low = 0;
    for (let round = 1; round <= rs.length; round++) {
      while (wi < myWords.length && myWords[wi]!.round < round) {
        const w = myWords[wi++]!;
        for (const ch of w.word) {
          const t = tiles.find((x) => x.usedAt < 0 && x.letter === ch && x.round <= w.round);
          if (t) {
            t.usedAt = w.round;
            if (w.round - t.round <= 1) completing++;
          }
        }
        if (w.word.length >= 6) {
          a.rackAtPlay.push(held);
          a.balAtPlay.push(bal);
        }
        if (w.word.length >= 7) {
          big++;
          if (firstBig === 68) firstBig = w.round;
          let b = 0;
          for (const ch of w.word) b += VALUE[idx(ch)]!;
          a.baseMid.push(b / w.word.length);
        }
        held -= w.word.length;
        bal += w.totalReward;
      }
      while (ti < tiles.length && tiles[ti]!.round === round) {
        held++;
        bal -= tiles[ti]!.paid;
        ti++;
      }
      if (round >= 10 && round <= 60 && bal < 12) low++;
    }
    for (const t of tiles) {
      const ratio = t.top / PAID[idx(t.letter)]!;
      if (t.usedAt >= 0) a.hold.push(t.usedAt - t.round);
      if (t.usedAt >= 0 && t.usedAt - t.round <= 1) a.completeRatio.push(ratio);
      else a.otherRatio.push(ratio);
    }
    a.completeShare.push(tiles.length ? completing / tiles.length : 0);
    a.cheapLate.push(tiles.length ? tiles.filter((t) => t.paid <= 0.6 * PAID[idx(t.letter)]!).length / tiles.length : 0);
    a.firstBig.push(firstBig);
    a.bigWords.push(big);
    a.lowBal.push(low);
  }
}
const f = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : "-");
const rows = [...acc.entries()].filter(([id, a]) => a.games >= 80 || id === 88).sort((x, y) => mean(x[1].place) - mean(y[1].place));
console.log(`Last ${RECENT} matches; bots with 80+ games (and Lala), best average place first.\n`);
console.log("| bot | games | place | win% | score | hold (rounds, median) | completing buys | bid/price completing vs other | rack when playing 6+ | coins when playing 6+ | 7+ words | 1st 7+ word | pts/letter in 7+ | starved rounds | bargains (<=0.6x) |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const [id, a] of rows.slice(0, 12).concat(rows.filter(([id]) => id === 88))) {
  const name = id === 88 ? "**Lala**" : names.get(id) ?? String(id);
  console.log(`| ${name} | ${a.games} | ${f(mean(a.place), 2)} | ${f(100 * mean(a.place.map((x) => (x === 1 ? 1 : 0))), 0)} | ${f(mean(a.score), 0)} | ${f(quantile(a.hold, 0.5), 0)} | ${f(100 * mean(a.completeShare), 0)}% | ${f(quantile(a.completeRatio, 0.5), 2)} vs ${f(quantile(a.otherRatio, 0.5), 2)} | ${f(mean(a.rackAtPlay))} | ${f(mean(a.balAtPlay), 0)} | ${f(mean(a.bigWords), 2)} | ${f(mean(a.firstBig), 0)} | ${f(mean(a.baseMid), 2)} | ${f(mean(a.lowBal))} | ${f(100 * mean(a.cheapLate), 0)}% |`);
}
