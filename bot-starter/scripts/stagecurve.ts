// Price of 1-point letters by stage in an all-market simulated field.
import { loadDict } from "../src/engine/dict.js";
import { runMatch } from "../src/sim/sim.js";
import { MarketBot, DEFAULT_MARKET } from "../src/sim/agents.js";
import { VALUE } from "../src/engine/letters.js";
const d = loadDict();
const mp = { ...DEFAULT_MARKET, ...JSON.parse(process.argv[2] ?? "{}") };
const buckets: number[][] = Array.from({ length: 14 }, () => []);
const balAt: number[][] = Array.from({ length: 14 }, () => []);
for (let s = 1; s <= 150; s++) {
  const agents = Array.from({ length: 6 }, (_, i) => new MarketBot(d, s * 10 + i, mp));
  const r = runMatch(d, agents, { seed: s, record: true });
  for (const a of r.auctions!) if (a.winner !== null && VALUE[a.letter] === 1) buckets[Math.min(13, Math.floor((a.round - 1) / 5))]!.push(a.paid);
}
const m = (xs: number[]) => (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1);
console.log("sim  1pt paid by 5-round bucket:", buckets.map(m).join(" "));
console.log("live 1pt paid by 5-round bucket: 11.5 10.6 10.3 10.2 10.3 10.4 10.6 10.7 10.8 11.0 11.4 11.5 12.0 7.1");
void balAt;
