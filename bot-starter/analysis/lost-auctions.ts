// For every auction Lala lost: what the winner bid (public archive) vs what
// Lala bid and what Lala's own model said the letter was worth (marginal/mu).
// "Cap-blocked": the model valued the letter above the winning bid, but caps
// kept Lala's bid below it. Split by finishing place.
//   npx tsx analysis/lost-auctions.ts [versions=v2.7,v2.7-ab:A,v2.7.2]
import * as fs from "node:fs";
import * as path from "node:path";
import { load } from "./load.js";
const want = (process.argv[2] ?? "v2.7,v2.7-ab:A,v2.7.2").split(",");
const live = (p: string) => fs.readdirSync("data/live").filter((f) => f.startsWith(p))
  .flatMap((f) => fs.readFileSync(path.join("data/live", f), "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean));
const matches = live("matches-").filter((m) => want.some((w) => { const [v, a] = w.split(":"); return m.version === v && (!a || m.arm === a); }));
const place = new Map(matches.map((m) => [m.match, m.place]));
const ids = new Set(place.keys());
const res = new Map(load("auctionResult").filter((r) => ids.has(r.matchId)).map((r) => [r.auctionId, r]));
const top = new Map(load("auctionTopBidArchive").filter((t) => ids.has(t.matchId)).map((t) => [t.auctionId, t.topBid]));
const dec = live("decisions-").filter((d) => ids.has(d.match));
type G = { games: Set<number>; lost: number; capBlocked: number; capBlockedEarly: number; close: number; extraCost: number; wonCount: number; early: number; earlyWon: number };
const grp = (): G => ({ games: new Set(), lost: 0, capBlocked: 0, capBlockedEarly: 0, close: 0, extraCost: 0, wonCount: 0, early: 0, earlyWon: 0 });
const by: Record<string, G> = { "won (1st)": grp(), "2nd-4th": grp(), "5th-6th": grp() };
for (const d of dec) {
  const r = res.get(d.auction);
  const t = top.get(d.auction);
  if (!r || r.winnerBotId == null || d.left <= 3) continue;
  const pl = place.get(d.match)!;
  const g = by[pl === 1 ? "won (1st)" : pl <= 4 ? "2nd-4th" : "5th-6th"]!;
  g.games.add(d.match);
  if (d.round <= 25) g.early++;
  if (r.winnerBotId === 88) {
    g.wonCount++;
    if (d.round <= 25) g.earlyWon++;
    continue;
  }
  if (t === undefined) continue;
  g.lost++;
  const value = d.mu > 0 ? d.marginal / d.mu : 0;
  if (t - d.bid <= 2) g.close++;
  if (value >= t + 1 && d.bid < t + 1 && d.balance >= t + 1) {
    g.capBlocked++;
    g.extraCost += t;
    if (d.round <= 25) g.capBlockedEarly++;
  }
}
console.log(`${matches.length} games (${want.join(", ")})\n`);
console.log("| finish | games | tiles won/game | early (r1-25) won/game | lost auctions/game | lost by <=2 coins/game | cap-blocked/game (early) | cost to win those |");
console.log("|---|---|---|---|---|---|---|---|");
for (const [k, g] of Object.entries(by)) {
  const n = g.games.size || 1;
  console.log(`| ${k} | ${g.games.size} | ${(g.wonCount / n).toFixed(1)} | ${(g.earlyWon / n).toFixed(1)} | ${(g.lost / n).toFixed(1)} | ${(g.close / n).toFixed(1)} | ${(g.capBlocked / n).toFixed(1)} (${(g.capBlockedEarly / n).toFixed(1)}) | ${(g.extraCost / Math.max(1, g.capBlocked)).toFixed(1)} coins each |`);
}
