// Stats of an all-rival simulated field, to compare with live data.
//   npx tsx scripts/fieldstats.ts '<rival params json>' [n]
import { loadDict } from "../src/engine/dict.js";
import { runMatch } from "../src/sim/sim.js";
import { Lala } from "../src/strategy/lala.js";
import { TUNED, LIVELIKE } from "../src/strategy/params.js";
import { VALUE } from "../src/engine/letters.js";
const d = loadDict();
const fp = { ...TUNED, ...LIVELIKE, ...JSON.parse(process.argv[2] ?? "{}") };
const N = Number(process.argv[3] ?? 60);
const placeScores: number[][] = [[], [], [], [], [], []];
const buckets: number[][] = Array.from({ length: 14 }, () => []);
let tiles = 0, spent = 0, bal = 0, nw = 0, wl = 0, w7 = 0;
for (let s = 1; s <= N; s++) {
  const agents = Array.from({ length: 6 }, (_, i) => new Lala(d, { ...fp, seed: s * 10 + i }, `f${i}`));
  const r = runMatch(d, agents, { seed: 777 + s, record: true });
  [...r.scores].sort((a, b) => b - a).forEach((x, i) => placeScores[i]!.push(x));
  tiles += r.tilesWon.reduce((a, b) => a + b, 0) / 6; spent += r.spent.reduce((a, b) => a + b, 0) / 6; bal += r.balances.reduce((a, b) => a + b, 0) / 6;
  for (const ws of r.words) for (const w of ws) { nw++; wl += w.length; if (w.length >= 7) w7++; }
  for (const a of r.auctions!) if (a.winner !== null && VALUE[a.letter] === 1) buckets[Math.min(13, Math.floor((a.round - 1) / 5))]!.push(a.paid);
}
const m = (xs: number[]) => (xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)).toFixed(1);
console.log("sim  place scores", placeScores.map(m).join("/"), "tiles", (tiles / N).toFixed(1), "spent", (spent / N).toFixed(0), "bal", (bal / N).toFixed(0), "words/bot", (nw / N / 6).toFixed(1), "len", (wl / nw).toFixed(1), "7+/bot", (w7 / N / 6).toFixed(2));
console.log("live place scores 105/91/80/71/61/41  tiles 11.3  spent ~150  bal ~25  words/bot 2.8  len 5.8  7+/bot ~1.35");
console.log("sim  1pt price", buckets.map(m).join(" "));
console.log("live 1pt price 11.5 10.6 10.3 10.2 10.3 10.4 10.6 10.7 10.8 11.0 11.4 11.5 12.0 7.1");
