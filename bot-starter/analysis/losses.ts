// Why Lala loses: each match since a given id, Lala vs the winner, plus
// auctions Lala lost narrowly on letters it valued highly.
//   npx tsx analysis/losses.ts <sinceMatchId>
import * as fs from "node:fs";
import * as path from "node:path";
import { load, groupBy, mean } from "./load.js";
const ME = 88;
const since = Number(process.argv[2] ?? 0);
const parts = load("matchParticipant");
const mine = new Set(parts.filter((p) => p.botId === ME && p.matchId >= since).map((p) => p.matchId));
const ended = new Set(load("matchState").filter((m) => m.status === "Ended" && mine.has(m.id)).map((m) => m.id));
const names = new Map(load("bot").map((b) => [b.id, b.name]));
const res = groupBy(load("auctionResult").filter((r) => ended.has(r.matchId)), (r) => r.matchId);
const words = groupBy(load("wordPlay").filter((w) => ended.has(w.matchId)), (w) => w.matchId);
const pm = groupBy(parts.filter((p) => ended.has(p.matchId)), (p) => p.matchId);
const dec = fs.readdirSync("data/live").filter((f) => f.startsWith("decisions-"))
  .flatMap((f) => fs.readFileSync(path.join("data/live", f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)))
  .filter((d) => ended.has(d.match));
const decBy = new Map(dec.map((d) => [d.auction, d]));
type R = { place: number; score: number; tiles: number; spent: number; bal: number; first: number; words: number; unused: number; w7: number };
const row = (mid: number, bot: number): R => {
  const rs = (res.get(mid) ?? []).sort((a, b) => a.auctionId - b.auctionId);
  const ws = (words.get(mid) ?? []).filter((w) => w.botId === bot).sort((a, b) => a.playedAt - b.playedAt);
  const won = rs.filter((r) => r.winnerBotId === bot);
  const ps = pm.get(mid)!;
  const p = ps.find((x) => x.botId === bot)!;
  return {
    place: 1 + ps.filter((q) => q.score > p.score).length, score: p.score, tiles: won.length,
    spent: won.reduce((a, r) => a + r.paid, 0), bal: p.balance,
    first: ws.length ? rs.filter((r) => r.closedAt <= ws[0].playedAt).length : 68, words: ws.length,
    unused: 5 + won.length - ws.reduce((a, w) => a + w.word.length, 0), w7: ws.filter((w) => w.word.length >= 7).length,
  };
};
const lost: R[] = [], won: R[] = [], winners: R[] = [];
let narrow = 0, narrowValue = 0, lostAuctions = 0, overpaidLate = 0;
const lines: string[] = [];
for (const mid of [...ended].sort((a, b) => a - b)) {
  const me = row(mid, ME);
  const ps = pm.get(mid)!.sort((a, b) => b.score - a.score);
  if (me.place === 1) { won.push(me); continue; }
  lost.push(me);
  const w = row(mid, ps[0].botId);
  winners.push(w);
  // Auctions Lala lost where it bid within 25% of the price on a letter it valued at 4+ points.
  const rs = res.get(mid) ?? [];
  const near: string[] = [];
  for (const r of rs) {
    const d = decBy.get(r.auctionId);
    if (!d || r.winnerBotId === ME || r.winnerBotId == null) continue;
    lostAuctions++;
    if (d.marginal >= 4 && d.bid > 0 && r.paid <= d.bid * 1.25 + 1) { narrow++; narrowValue += d.marginal; near.push(`${r.letter}(bid ${d.bid}, paid ${r.paid})`); }
  }
  lines.push(`m${mid} place ${me.place} score ${me.score} vs ${names.get(ps[0].botId)} ${w.score} | tiles ${me.tiles} vs ${w.tiles}, spent ${me.spent} vs ${w.spent}, bal left ${me.bal}, 1st word r${me.first} vs r${w.first}, unused ${me.unused} | near-misses: ${near.slice(0, 5).join(" ")}`);
}
const show = (k: string, rs: R[]) => console.log(k.padEnd(14), (Object.keys(rs[0]!) as (keyof R)[]).map((f) => `${f}=${mean(rs.map((r) => r[f])).toFixed(1)}`).join("  "));
console.log(`matches ${ended.size}: won ${won.length}, lost ${lost.length}`);
if (won.length) show("Lala (won)", won);
show("Lala (lost)", lost);
show("winner", winners);
console.log(`narrow losses on valued letters: ${narrow} of ${lostAuctions} lost auctions (${(narrow / lost.length).toFixed(1)} per lost game)`);
console.log(lines.join("\n"));
