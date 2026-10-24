// Quick look at Lala's decision for a few hand-made positions.
import { loadDict } from "../src/engine/dict.js";
import { countsOf } from "../src/engine/letters.js";
import { Tracker } from "../src/engine/tracker.js";
import { Lala } from "../src/strategy/lala.js";
import { TUNED } from "../src/strategy/params.js";

const dict = loadDict();
const cases: [string, number][] = [["RETAINS", 4], ["QUIXOTE", 30], ["RETAINS", 30], ["", 50]];
for (const [rack, left] of cases) {
  const t = new Tracker(0, [0, 1, 2, 3, 4, 5], countsOf(rack), "Vickrey", 5);
  t.onAuction(4, left - 1);
  const d = new Lala(dict, TUNED).act({
    auctionType: "Vickrey", me: 0, n: 6, round: 69 - left, letter: 4, auctionsLeft: left,
    rack: countsOf(rack), balance: 20, score: 0, tracker: t, wonLast: false,
  });
  console.log(rack || "(empty)", left, JSON.stringify(d));
}
