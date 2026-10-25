// Arm A (live control) vs the just-in-time arm B on hand-made positions.
import { loadDict } from "../src/engine/dict.js";
import { countsOf } from "../src/engine/letters.js";
import { Tracker } from "../src/engine/tracker.js";
import { Lala } from "../src/strategy/lala.js";
import { TUNED, LIVE_CONTROL } from "../src/strategy/params.js";
const d = loadDict();
const A = { ...TUNED, ...LIVE_CONTROL };
const B = { ...A, ...JSON.parse(process.argv[2] ?? '{"minPlayLen":7,"playK":0.4,"completeMul":1.5,"completeMin":10}') };
const cases: [string, string, number, number][] = [
  ["RETAINS", "E", 35, 40], ["AEINRSTLO", "E", 30, 20], ["ADDEGILNOORSY", "E", 26, 6],
  ["ETAINS", "R", 40, 60], ["EIRTOD", "S", 30, 50], ["AEIRT", "N", 50, 80], ["CATS", "E", 40, 50],
];
for (const [rack, letter, left, bal] of cases) {
  const out: string[] = [];
  for (const [name, p] of [["A", A], ["B", B]] as const) {
    const t = new Tracker(0, [0, 1, 2, 3, 4, 5], countsOf(rack), "Vickrey", 5);
    t.onAuction(letter.charCodeAt(0) - 65, left - 1);
    const r = new Lala(d, p).act({ auctionType: "Vickrey", me: 0, n: 6, round: 69 - left, letter: letter.charCodeAt(0) - 65, auctionsLeft: left, rack: countsOf(rack), balance: bal, score: 0, tracker: t, wonLast: false });
    out.push(`${name}: play ${r.words.join(",") || "-"} bid ${r.bid}`);
  }
  console.log(`${rack.padEnd(14)} +${letter} left ${left} coins ${bal}  |  ${out.join("  |  ")}`);
}
