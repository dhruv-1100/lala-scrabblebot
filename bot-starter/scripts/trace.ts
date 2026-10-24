import { loadDict } from "../src/engine/dict.js";
import { runMatch } from "../src/sim/sim.js";
import { MarketBot } from "../src/sim/agents.js";
import { Lala } from "../src/strategy/lala.js";
import { ALPHA, countsToString } from "../src/engine/letters.js";
import type { View } from "../src/sim/types.js";
const d = loadDict();
const lala = new Lala(d, JSON.parse(process.argv[2] ?? "{}"));
const orig = lala.act.bind(lala);
const lines: string[] = [];
lala.act = (v: View) => {
  const r = orig(v);
  lines.push(`r${v.round} T${v.auctionsLeft} ${ALPHA[v.letter]} rack=${countsToString(v.rack)} bal=${v.balance} words=${r.words.join(",")} val=${r.value.toFixed(1)} marg=${r.marginal.toFixed(1)} mu=${r.mu.toFixed(2)} bid=${r.bid}`);
  return r;
};
const res = runMatch(d, [lala, ...Array.from({ length: 5 }, (_, i) => new MarketBot(d, 100 + i))], { seed: Number(process.argv[3] ?? 3), record: true });
res.auctions!.forEach((a, i) => { lines[i] += `  -> ${a.winner === 0 ? "WON" : a.winner === null ? "unsold" : "lost"} paid ${a.paid} top ${Math.max(...a.bids)}`; });
console.log(lines.join("\n"));
console.log(JSON.stringify({ scores: res.scores, words: res.words[0] }));
