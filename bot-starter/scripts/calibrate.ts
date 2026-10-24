// Compare a simulated all-market field with live statistics.
import { loadDict } from "../src/engine/dict.js";
import { runMatch } from "../src/sim/sim.js";
import { MarketBot, DEFAULT_MARKET } from "../src/sim/agents.js";
import { VALUE } from "../src/engine/letters.js";
const d = loadDict();
const mp = { ...DEFAULT_MARKET, ...JSON.parse(process.argv[2] ?? "{}") };
const N = Number(process.argv[3] ?? 200);
const paid1: number[] = [], top1: number[] = [], paid3: number[] = [], paidHi: number[] = [];
const placeScores: number[][] = [[], [], [], [], [], []];
let tiles = 0, spent = 0, bal = 0, unplayed = 0, wl: number[] = [], nw = 0;
const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
for (let s = 1; s <= N; s++) {
  const agents = Array.from({ length: 6 }, (_, i) => new MarketBot(d, s * 10 + i, mp));
  const r = runMatch(d, agents, { seed: s, record: true });
  for (const a of r.auctions!) {
    if (a.winner === null) continue;
    const top = Math.max(...a.bids);
    if (VALUE[a.letter] === 1) { paid1.push(a.paid); top1.push(top); }
    if (VALUE[a.letter] === 3) paid3.push(a.paid);
    if (VALUE[a.letter]! >= 8) paidHi.push(a.paid);
  }
  [...r.scores].sort((a, b) => b - a).forEach((x, i) => placeScores[i]!.push(x));
  tiles += r.tilesWon.reduce((a, b) => a + b, 0) / 6; spent += r.spent.reduce((a, b) => a + b, 0) / 6;
  bal += r.balances.reduce((a, b) => a + b, 0) / 6; unplayed += r.unplayed.reduce((a, b) => a + b, 0) / 6;
  for (const ws of r.words) for (const w of ws) { wl.push(w.length); nw++; }
}
console.log("sim  : 1pt paid med", med(paid1), "top med", med(top1), "| 3pt paid", med(paid3), "| 8-10pt paid", med(paidHi));
console.log("live : 1pt paid med 10-11, top med 12-13 | 3pt paid 16-17 | 8-10pt paid 28-38");
console.log("sim  : place scores", placeScores.map((x) => (x.reduce((a, b) => a + b, 0) / x.length).toFixed(0)).join("/"), "tiles", (tiles / N).toFixed(1), "spent", (spent / N).toFixed(0), "bal", (bal / N).toFixed(0), "words/bot", (nw / N / 6).toFixed(1), "len", (wl.reduce((a, b) => a + b, 0) / wl.length).toFixed(1), "unplayed", (unplayed / N).toFixed(2));
console.log("live : place scores 105/91/80/71/61/41  tiles 11.3 spent ~150 bal ~25 words/bot 2.8 len 5.8 unplayed 0.89");
