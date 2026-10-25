// Live settings vs the same with Monte Carlo rollout bids, on hand-made positions.
import { loadDict } from "../src/engine/dict.js";
import { countsOf } from "../src/engine/letters.js";
import { Tracker } from "../src/engine/tracker.js";
import { Lala } from "../src/strategy/lala.js";
import { TUNED, LIVE_CONTROL } from "../src/strategy/params.js";
const d = loadDict();
const A = { ...TUNED, ...LIVE_CONTROL };
const R = { ...A, rollout: 1, ...JSON.parse(process.argv[2] ?? "{}") };
const cases: [string, string, number, number][] = [
  ["ETAINS", "R", 40, 60], ["EIRTOD", "S", 30, 50], ["AEIRT", "N", 50, 80], ["AEIRT", "Q", 50, 80],
  ["CATS", "E", 40, 50], ["AEINRST", "X", 30, 40], ["BCDFGH", "Z", 45, 70], ["ADEILNOR", "S", 20, 30],
  ["EEIIOU", "E", 45, 60], ["", "E", 66, 100], ["AEL", "T", 60, 90],
];
const lalaA = new Lala(d, A), lalaR = new Lala(d, R);
for (const [rack, letter, left, bal] of cases) {
  const mk = () => {
    const t = new Tracker(0, [0, 1, 2, 3, 4, 5], countsOf(rack), "Vickrey", 5);
    t.onAuction(letter.charCodeAt(0) - 65, left - 1);
    return { auctionType: "Vickrey" as const, me: 0, n: 6, round: 69 - left, letter: letter.charCodeAt(0) - 65, auctionsLeft: left, rack: countsOf(rack), balance: bal, score: 0, tracker: t, wonLast: false };
  };
  const a = lalaA.act(mk());
  const r = lalaR.act(mk());
  const ro = lalaR.lastRollout;
  console.log(`${(rack || "(empty)").padEnd(9)} +${letter} left ${String(left).padStart(2)} coins ${String(bal).padStart(3)} | formula bid ${String(a.bid).padStart(3)} | rollout bid ${String(r.bid).padStart(3)} ${ro ? `(gain at price ${ro.gain.toFixed(1)}, ${ro.futures} futures, ${ro.plans} plans, ${ro.ms.toFixed(0)}ms)` : "(fallback)"} total ${r.ms.toFixed(0)}ms`);
}
