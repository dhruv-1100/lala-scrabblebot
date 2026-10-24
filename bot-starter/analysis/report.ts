// Historical analysis of live matches from data/raw (npm run dump first).
// Prints the tables ANALYSIS.md is built from.
//
//   npx tsx analysis/report.ts [recentMatches=600]

import { load, groupBy, mean, quantile } from "./load.js";
import { VALUE, rewardFor, baseScore, idx } from "../src/engine/letters.js";

const RECENT = Number(process.argv[2] ?? 600);
const matches = load("matchState").filter((m) => m.status === "Ended").sort((a, b) => a.id - b.id).slice(-RECENT);
const ids = new Set(matches.map((m) => m.id));
const bots = new Map(load("bot").map((b) => [b.id, b]));
const name = (id: number) => bots.get(id)?.name ?? `#${id}`;
const results = load("auctionResult").filter((r) => ids.has(r.matchId)).sort((a, b) => a.auctionId - b.auctionId);
const tops = new Map(load("auctionTopBidArchive").map((t) => [t.auctionId, t.topBid]));
const words = load("wordPlay").filter((w) => ids.has(w.matchId)).sort((a, b) => a.playedAt - b.playedAt || a.id - b.id);
const parts = load("matchParticipant").filter((p) => ids.has(p.matchId));
const resBy = groupBy(results, (r) => r.matchId);
const wordsBy = groupBy(words, (w) => `${w.matchId}:${w.botId}`);
const partsBy = groupBy(parts, (p) => p.matchId);

const span = `${new Date(matches[0].createdAt / 1000).toISOString().slice(0, 16)} .. ${new Date(matches.at(-1).createdAt / 1000).toISOString().slice(0, 16)}`;
console.log(`# ${matches.length} matches (${span}), ${results.length} auctions, ${words.length} words\n`);

// ---- Tile attribution: which won tiles ended up in which word ----
interface Tile { matchId: number; bot: number; letter: string; round: number; paid: number; top: number; used: boolean; wlen: number; marg: number; }
const tiles: Tile[] = [];
const roundOf = new Map<number, number>();
const nRounds = new Map<number, number>();
for (const [mid, rs] of resBy) {
  rs.forEach((r, i) => roundOf.set(r.auctionId, i + 1));
  nRounds.set(mid, rs.length);
}
for (const m of matches) {
  const rs = resBy.get(m.id) ?? [];
  for (const p of partsBy.get(m.id) ?? []) {
    const mine = rs.filter((r) => r.winnerBotId === p.botId).map((r) => ({
      matchId: m.id, bot: p.botId, letter: r.letter, round: roundOf.get(r.auctionId)!, paid: r.paid,
      top: tops.get(r.auctionId) ?? r.paid, used: false, wlen: 0, marg: 0, at: r.closedAt,
    }));
    for (const w of wordsBy.get(`${m.id}:${p.botId}`) ?? []) {
      const b = baseScore(w.word);
      for (const ch of w.word) {
        const t = mine.find((x) => !x.used && x.letter === ch && x.at <= w.playedAt);
        if (!t) continue; // from the hidden starting rack
        t.used = true;
        t.wlen = w.word.length;
        // Marginal value ~ this word versus an equally good word one tile shorter.
        t.marg = w.totalReward - rewardFor(b - VALUE[idx(ch)]!, w.word.length - 1);
      }
    }
    tiles.push(...mine);
  }
}
const pct = (x: number) => `${(100 * x).toFixed(0)}%`;
console.log("## Bought tiles: use and value by letter (marginal points per tile vs coins paid)\n");
console.log("| letter | bought | used | in 7+ | paid | marg pts | pts/coin |");
console.log("|---|---|---|---|---|---|---|");
const byL = groupBy(tiles, (t) => t.letter);
for (const L of [...byL.keys()].sort()) {
  const ts = byL.get(L)!;
  const paid = mean(ts.map((t) => t.paid));
  const marg = mean(ts.map((t) => t.marg));
  console.log(`| ${L} | ${ts.length} | ${pct(mean(ts.map((t) => (t.used ? 1 : 0))))} | ${pct(mean(ts.map((t) => (t.wlen >= 7 ? 1 : 0))))} | ${paid.toFixed(1)} | ${marg.toFixed(1)} | ${(marg / paid).toFixed(2)} |`);
}
const all = { used: mean(tiles.map((t) => (t.used ? 1 : 0))), pts: mean(tiles.map((t) => t.marg)), paid: mean(tiles.map((t) => t.paid)) };
console.log(`\nAll tiles: ${pct(all.used)} used, ${all.pts.toFixed(1)} marginal points for ${all.paid.toFixed(1)} coins (${(all.pts / all.paid).toFixed(2)} pts/coin)\n`);

// By stage
console.log("## Value by stage (rounds of 68)\n");
console.log("| rounds | tiles | used | paid | marg pts | pts/coin |");
console.log("|---|---|---|---|---|---|");
for (const [lo, hi] of [[1, 10], [11, 25], [26, 40], [41, 55], [56, 63], [64, 66], [67, 67], [68, 68]] as const) {
  const ts = tiles.filter((t) => t.round >= lo && t.round <= hi);
  if (!ts.length) continue;
  const paid = mean(ts.map((t) => t.paid));
  const marg = mean(ts.map((t) => t.marg));
  console.log(`| ${lo}-${hi} | ${ts.length} | ${pct(mean(ts.map((t) => (t.used ? 1 : 0))))} | ${paid.toFixed(1)} | ${marg.toFixed(1)} | ${(marg / paid).toFixed(2)} |`);
}

// ---- Game-changing purchases ----
console.log("\n## Biggest surpluses (marginal points - 0.4 x coins paid)\n");
const top = [...tiles].sort((a, b) => b.marg - 0.4 * b.paid - (a.marg - 0.4 * a.paid)).slice(0, 8);
for (const t of top) console.log(`- match ${t.matchId} r${t.round}: ${name(t.bot)} bought ${t.letter} for ${t.paid} (top bid ${t.top}), used in a ${t.wlen}-letter word, +${t.marg} pts`);
const worst = tiles.filter((t) => !t.used).sort((a, b) => b.paid - a.paid).slice(0, 5);
console.log("\nCostliest unused tiles:");
for (const t of worst) console.log(`- match ${t.matchId} r${t.round}: ${name(t.bot)} paid ${t.paid} for ${t.letter}, never played`);

// ---- Winners vs the rest ----
console.log("\n## What winners do differently\n");
type Agg = { score: number; tiles: number; spent: number; words: number; len7: number; hi: number; firstWordRound: number; finalBal: number; wasted: number };
const agg = (rank: (place: number) => boolean): Agg => {
  const rows: Agg[] = [];
  for (const m of matches) {
    const ps = [...(partsBy.get(m.id) ?? [])].sort((a, b) => b.score - a.score);
    ps.forEach((p, i) => {
      if (!rank(1 + ps.filter((q) => q.score > p.score).length)) return;
      const ts = tiles.filter((t) => t.matchId === m.id && t.bot === p.botId);
      const ws = wordsBy.get(`${m.id}:${p.botId}`) ?? [];
      const rs = resBy.get(m.id)!;
      const fw = ws.length ? rs.filter((r) => r.closedAt <= ws[0].playedAt).length : 68;
      rows.push({
        score: p.score, tiles: ts.length, spent: ts.reduce((a, t) => a + t.paid, 0), words: ws.length,
        len7: ws.filter((w) => w.word.length >= 7).length, hi: ts.filter((t) => VALUE[idx(t.letter)]! >= 4).length,
        firstWordRound: fw, finalBal: p.balance, wasted: ts.filter((t) => !t.used).length,
      });
      void i;
    });
  }
  const o: Record<string, number> = {};
  for (const k of Object.keys(rows[0]!) as (keyof Agg)[]) o[k] = mean(rows.map((r) => r[k]));
  return o as Agg;
};
const w = agg((pl) => pl === 1), mid = agg((pl) => pl >= 2 && pl <= 5), last = agg((pl) => pl === 6);
console.log("| | score | tiles | spent | words | 7+ words | 4+pt tiles | 1st word round | final bal | unused tiles |");
console.log("|---|---|---|---|---|---|---|---|---|---|");
for (const [k, a] of [["winner", w], ["2nd-5th", mid], ["last", last]] as const) {
  console.log(`| ${k} | ${a.score.toFixed(0)} | ${a.tiles.toFixed(1)} | ${a.spent.toFixed(0)} | ${a.words.toFixed(1)} | ${a.len7.toFixed(2)} | ${a.hi.toFixed(1)} | ${a.firstWordRound.toFixed(0)} | ${a.finalBal.toFixed(0)} | ${a.wasted.toFixed(1)} |`);
}

// ---- Opponent bidding styles ----
console.log("\n## Bidding style per bot (winning bid / live median price for that letter)\n");
const PAID = [11, 16, 17, 14, 11, 19, 12, 21, 10, 29, 23, 11, 17, 10, 10, 16, 28, 11, 12, 10, 10, 18, 18, 31, 21, 38];
const byBot = groupBy(tiles, (t) => t.bot);
const rows = [...byBot.entries()].filter(([, ts]) => ts.length >= 100).map(([b, ts]) => {
  const ratio = ts.map((t) => t.top / PAID[idx(t.letter)]!);
  const late = ts.filter((t) => t.round >= 60).map((t) => t.top / PAID[idx(t.letter)]!);
  return { b, n: ts.length, med: quantile(ratio, 0.5), p90: quantile(ratio, 0.9), late: late.length ? quantile(late, 0.5) : NaN, hi: mean(ts.map((t) => (VALUE[idx(t.letter)]! >= 4 ? 1 : 0))) };
}).sort((a, b) => b.med - a.med);
console.log("| bot | tiles won | bid/price med | p90 | late (r60+) | share 4+pt |");
console.log("|---|---|---|---|---|---|");
for (const r of rows) console.log(`| ${name(r.b)} | ${r.n} | ${r.med.toFixed(2)} | ${r.p90.toFixed(2)} | ${r.late.toFixed(2)} | ${pct(r.hi)} |`);

// ---- Last auction ----
const lastRs = results.filter((r) => roundOf.get(r.auctionId) === nRounds.get(r.matchId));
console.log(`\nFinal auction: ${pct(mean(lastRs.map((r) => (r.winnerBotId == null ? 1 : 0))))} unsold; when sold, paid ${mean(lastRs.filter((r) => r.winnerBotId != null).map((r) => r.paid)).toFixed(1)} on average for a tile nobody can play.`);
