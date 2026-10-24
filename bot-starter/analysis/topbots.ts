// Behaviour profile of the strongest live bots versus the field.
//   npx tsx analysis/topbots.ts [recentMatches=900]
import { load, groupBy, mean, quantile } from "./load.js";
import { VALUE, VOWELS, idx } from "../src/engine/letters.js";
const RECENT = Number(process.argv[2] ?? 900);
const matches = load("matchState").filter((m) => m.status === "Ended").sort((a, b) => a.id - b.id).slice(-RECENT);
const ids = new Set(matches.map((m) => m.id));
const name = new Map(load("bot").map((b) => [b.id, b.name]));
const results = load("auctionResult").filter((r) => ids.has(r.matchId)).sort((a, b) => a.auctionId - b.auctionId);
const tops = new Map(load("auctionTopBidArchive").map((t) => [t.auctionId, t.topBid]));
const words = load("wordPlay").filter((w) => ids.has(w.matchId)).sort((a, b) => a.playedAt - b.playedAt);
const parts = load("matchParticipant").filter((p) => ids.has(p.matchId));
const resBy = groupBy(results, (r) => r.matchId);
const wordsBy = groupBy(words, (w) => `${w.matchId}:${w.botId}`);
const partsBy = groupBy(parts, (p) => p.matchId);
const PAID = [11, 16, 17, 14, 11, 19, 12, 21, 10, 29, 23, 11, 17, 10, 10, 16, 28, 11, 12, 10, 10, 18, 18, 31, 21, 38];
const phase = (r: number) => (r <= 20 ? 0 : r <= 45 ? 1 : r <= 62 ? 2 : 3);
type P = { n: number; place: number[]; score: number[]; tiles: number[]; vowShare: number[]; hiShare: number[]; spentByPhase: number[][]; ratio: number[][]; firstWord: number[]; nWords: number[]; len: number[]; w7: number[]; bal: number[]; wordRounds: number[]; balMid: number[] };
const prof = new Map<number, P>();
for (const m of matches) {
  const ps = partsBy.get(m.id) ?? [];
  const rs = resBy.get(m.id) ?? [];
  const roundOf = new Map(rs.map((r, i) => [r.auctionId, i + 1]));
  for (const p of ps) {
    let s = prof.get(p.botId);
    if (!s) prof.set(p.botId, (s = { n: 0, place: [], score: [], tiles: [], vowShare: [], hiShare: [], spentByPhase: [[], [], [], []], ratio: [[], [], [], []], firstWord: [], nWords: [], len: [], w7: [], bal: [], wordRounds: [], balMid: [] }));
    s.n++;
    s.place.push(1 + ps.filter((q) => q.score > p.score).length);
    s.score.push(p.score);
    const won = rs.filter((r) => r.winnerBotId === p.botId);
    s.tiles.push(won.length);
    if (won.length) {
      s.vowShare.push(won.filter((r) => VOWELS.has(idx(r.letter))).length / won.length);
      s.hiShare.push(won.filter((r) => VALUE[idx(r.letter)]! >= 4).length / won.length);
    }
    const sp = [0, 0, 0, 0];
    for (const r of won) {
      const ph = phase(roundOf.get(r.auctionId)!);
      sp[ph] += r.paid;
      const t = tops.get(r.auctionId);
      if (t) s.ratio[ph]!.push(t / PAID[idx(r.letter)]!);
    }
    sp.forEach((x, i) => s!.spentByPhase[i]!.push(x));
    const ws = wordsBy.get(`${m.id}:${p.botId}`) ?? [];
    s.nWords.push(ws.length);
    for (const w of ws) {
      s.len.push(w.word.length);
      s.wordRounds.push(rs.filter((r) => r.closedAt <= w.playedAt).length);
    }
    s.w7.push(ws.filter((w) => w.word.length >= 7).length);
    s.firstWord.push(ws.length ? rs.filter((r) => r.closedAt <= ws[0].playedAt).length : 68);
    s.bal.push(p.balance);
  }
}
const rows = [...prof.entries()].filter(([id, s]) => (s.n >= 60 || id === 88) && name.get(id)).sort((a, b) => mean(a[1].place) - mean(b[1].place));
const f = (x: number, d = 1) => x.toFixed(d);
console.log(`Recent ${RECENT} matches. Bots with >=60 games, best average place first.\n`);
console.log("| bot | n | place | win% | score | tiles | vowel share | 4+pt share | bid/price early,mid,late,end | spend early/mid/late/end | 1st word | words | len | 7+ | final bal |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
const line = (label: string, s: P) => console.log(`| ${label} | ${s.n} | ${f(mean(s.place), 2)} | ${f(100 * mean(s.place.map((x) => (x === 1 ? 1 : 0))), 0)} | ${f(mean(s.score), 0)} | ${f(mean(s.tiles))} | ${f(100 * mean(s.vowShare), 0)}% | ${f(100 * mean(s.hiShare), 0)}% | ${s.ratio.map((r) => f(quantile(r, 0.5), 2)).join(",")} | ${s.spentByPhase.map((x) => f(mean(x), 0)).join("/")} | ${f(mean(s.firstWord), 0)} | ${f(mean(s.nWords))} | ${f(mean(s.len))} | ${f(mean(s.w7), 2)} | ${f(mean(s.bal), 0)} |`);
for (const [id, s] of rows.slice(0, 10)) line(name.get(id)!, s);
console.log("| ... | | | | | | | | | | | | | | |");
for (const [id, s] of rows.filter(([id]) => id === 88)) line("**Lala**", s);
const all: P = { n: 0, place: [], score: [], tiles: [], vowShare: [], hiShare: [], spentByPhase: [[], [], [], []], ratio: [[], [], [], []], firstWord: [], nWords: [], len: [], w7: [], bal: [], wordRounds: [], balMid: [] };
for (const [, s] of rows) { for (const k of Object.keys(all) as (keyof P)[]) { if (k === "n") all.n += s.n; else if (k === "spentByPhase" || k === "ratio") (s[k] as number[][]).forEach((x, i) => (all[k] as number[][])[i]!.push(...x)); else (all[k] as number[]).push(...(s[k] as number[])); } }
line("field (all >=60)", all);
