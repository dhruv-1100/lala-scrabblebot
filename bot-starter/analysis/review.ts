// Per-game review of Lala's concrete mistakes in a version family:
// points left on the table at the final cash-out, tiles bought and never
// played, coins left unspent, starved stretches.
//   npx tsx analysis/review.ts [versions=v2.7,v2.7-ab:A,v2.7.2,v2.7.3]
import * as fs from "node:fs";
import * as path from "node:path";
import { load } from "./load.js";
import { loadDict } from "../src/engine/dict.js";
import { countsOf } from "../src/engine/letters.js";
import { bestPartition, removeWord } from "../src/engine/words.js";
const want = (process.argv[2] ?? "v2.7,v2.7-ab:A,v2.7.2,v2.7.3").split(",");
const live = (p: string) => fs.readdirSync("data/live").filter((f) => f.startsWith(p))
  .flatMap((f) => fs.readFileSync(path.join("data/live", f), "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean));
const matches = live("matches-").filter((m) => want.some((w) => { const [v, a] = w.split(":"); return m.version === v && (!a || m.arm === a); }));
const ids = new Set(matches.map((m) => m.match));
const dec = live("decisions-").filter((d) => ids.has(d.match));
const byMatch = new Map<number, any[]>();
for (const d of dec) (byMatch.get(d.match) ?? byMatch.set(d.match, []).get(d.match)!).push(d);
const won = new Map<number, any[]>();
for (const r of load("auctionResult")) if (ids.has(r.matchId) && r.winnerBotId === 88) (won.get(r.matchId) ?? won.set(r.matchId, []).get(r.matchId)!).push(r);
const dict = loadDict();
let missedPts = 0, missedGames = 0, wastedTiles = 0, wastedCoins = 0, endCoins = 0, starved = 0, lastBids = 0, n = 0;
const rows: string[] = [];
for (const m of matches) {
  const ds = (byMatch.get(m.match) ?? []).sort((a, b) => a.round - b.round);
  if (!ds.length) continue;
  n++;
  const last = ds[ds.length - 1];
  // Points left on the table: what the leftover tiles could still have made.
  let rack = countsOf(last.rack);
  for (const w of last.words) rack = removeWord(rack, w);
  const missed = last.left === 1 ? bestPartition(dict, rack, 2, 100).reward : 0;
  if (missed > 0) { missedPts += missed; missedGames++; }
  // Tiles bought and never played.
  const played = countsOf(m.words.join(""));
  let wt = 0, wc = 0;
  for (const r of (won.get(m.match) ?? []).sort((a, b) => b.auctionId - a.auctionId)) {
    const k = r.letter.charCodeAt(0) - 65;
    if (played[k]! > 0) played[k]!--;
    else { wt++; wc += r.paid; }
  }
  wastedTiles += wt; wastedCoins += wc;
  const beforeFinal = ds.find((d) => d.left === 2)?.balance ?? last.balance;
  endCoins += beforeFinal;
  const st = ds.filter((d) => d.balance < 8 && d.left >= 14).length;
  starved += st;
  lastBids += ds.filter((d) => d.left === 1 && d.bid > 0).length;
  rows.push(`m${m.match} place ${m.place} score ${m.score} | tiles ${m.tiles} | missed at cash-out ${missed} (left ${[...rack].map((c, i) => String.fromCharCode(65 + i).repeat(c)).join("") || "-"}) | wasted ${wt} tiles/${wc} coins | coins before final 2 auctions ${beforeFinal} | starved rounds ${st}`);
}
console.log(`${n} games reviewed (${want.join(", ")})`);
console.log(`points left on the table at final cash-out: ${missedPts} total in ${missedGames} games (${(missedPts / Math.max(1, n)).toFixed(2)}/game)`);
console.log(`tiles bought and never played: ${(wastedTiles / n).toFixed(2)}/game, ${(wastedCoins / n).toFixed(1)} coins/game`);
console.log(`coins left when 2 auctions remain: ${(endCoins / n).toFixed(1)}/game; bids on the useless final tile: ${lastBids}`);
console.log(`starved rounds (<8 coins, 14+ auctions left): ${(starved / n).toFixed(1)}/game`);
console.log("\nworst 12 games:");
for (const r of rows.filter((r) => / place [56] /.test(r)).slice(-12)) console.log("  " + r);
