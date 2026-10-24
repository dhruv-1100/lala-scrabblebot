// Median price paid per letter in four stages of the match, from the live
// history (data/raw). Lala's price prior then follows the real curve
// (prices rise late) instead of one flat table.
import { load, groupBy, quantile } from "../analysis/load.js";
import * as fs from "node:fs";
const RECENT = Number(process.argv[2] ?? 900);
const ms = load("matchState").filter((m) => m.status === "Ended").sort((a, b) => a.id - b.id).slice(-RECENT);
const ids = new Set(ms.map((m) => m.id));
const rs = load("auctionResult").filter((r) => ids.has(r.matchId) && r.winnerBotId != null).sort((a, b) => a.auctionId - b.auctionId);
const by = groupBy(rs, (r) => r.matchId);
const cuts = [20, 45, 62, 68]; // round upper bounds
const stage = (r: number) => cuts.findIndex((c) => r <= c);
const acc: number[][][] = Array.from({ length: 4 }, () => Array.from({ length: 26 }, () => []));
for (const list of by.values()) list.forEach((r, i) => acc[stage(i + 1)]![r.letter.charCodeAt(0) - 65]!.push(r.paid));
const all: number[][] = Array.from({ length: 26 }, () => []);
for (const s of acc) s.forEach((x, k) => all[k]!.push(...x));
const out = acc.map((s) => s.map((x, k) => {
  const base = quantile(all[k]!, 0.5);
  // Shrink thin cells toward the all-stage median.
  const w = x.length / (x.length + 40);
  return +(w * (x.length ? quantile(x, 0.5) : base) + (1 - w) * base).toFixed(1);
}));
fs.writeFileSync("src/strategy/phase-prices.json", JSON.stringify({ cuts, prices: out }));
console.log("stage medians for E,Z:", out.map((s) => `${s[4]}/${s[25]}`).join("  "), " (E/Z per stage)");
