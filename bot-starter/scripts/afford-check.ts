// The match-4058 position: broke, holding a rack that spells GRANDIOSE.
import { loadDict } from "../src/engine/dict.js";
import { countsOf } from "../src/engine/letters.js";
import { Tracker } from "../src/engine/tracker.js";
import { Lala } from "../src/strategy/lala.js";
import { TUNED } from "../src/strategy/params.js";
const d = loadDict();
for (const [label, extra] of [["v2.5", {}], ["coinW 1", { coinW: 1 }], ["coinW 0.6", { coinW: 0.6 }]] as const) {
  for (const [rack, bal, left] of [["ADDEGILNOORSY", 6, 26], ["ADDEGILNOORSY", 60, 26], ["CCFGLOOPQTU", 1, 38], ["AEINRST", 80, 50]] as const) {
    const t = new Tracker(0, [0, 1, 2, 3, 4, 5], countsOf(rack), "Vickrey", 5);
    t.onAuction(9, left - 1);
    const r = new Lala(d, { ...TUNED, ...extra }).act({ auctionType: "Vickrey", me: 0, n: 6, round: 69 - left, letter: 9, auctionsLeft: left, rack: countsOf(rack), balance: bal, score: 0, tracker: t, wonLast: false });
    console.log(`${label.padEnd(12)} ${rack.padEnd(14)} coins ${String(bal).padStart(3)} left ${left}: play ${r.words.join(",") || "-"}`);
  }
}
