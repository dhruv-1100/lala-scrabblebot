// Why does Lala hold this rack? Print hold value vs value after each candidate play.
import { loadDict } from "../src/engine/dict.js";
import { countsOf, countsToString } from "../src/engine/letters.js";
import { Tracker } from "../src/engine/tracker.js";
import { Valuer } from "../src/strategy/value.js";
import { DEFAULT_LALA } from "../src/strategy/lala.js";
import { TUNED } from "../src/strategy/params.js";
import { playable, removeWord } from "../src/engine/words.js";
import { LIVE_PAID } from "../src/sim/agents.js";
const d = loadDict();
const rack = countsOf(process.argv[2] ?? "ADDEGILNOORSY");
const left = Number(process.argv[3] ?? 26);
const p = { ...DEFAULT_LALA, ...TUNED, ...JSON.parse(process.argv[4] ?? "{}") };
const t = new Tracker(0, [0, 1, 2, 3, 4, 5], rack, "Vickrey", 5);
t.onAuction(9, left - 1);
const v = new Valuer(d);
const fd = left - 2, mu = 0.45, ks = Math.max(p.kappaMin, Math.min(1, fd / p.kappaT));
const ev = (r: Uint8Array) => v.evaluate(r, 9, t.unseen, fd, LIVE_PAID, mu, p, ks, p.playK);
const hold = ev(rack);
console.log(`hold ${hold.base.toFixed(1)} via plan ${hold.bestWord >= 0 ? d.words[hold.bestWord] : "(keep all)"}`);
for (const i of playable(d, rack, 2, 6)) {
  const w = d.words[i]!;
  const after = ev(removeWord(rack, w));
  console.log(`  play ${w.padEnd(10)} reward ${d.reward[i]}  after ${after.base.toFixed(1)}  gain ${(d.reward[i]! + after.base - hold.base).toFixed(1)}  rest ${countsToString(removeWord(rack, w))}`);
}
