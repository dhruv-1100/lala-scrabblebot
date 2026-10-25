// The PIONEERS position: 2 coins, 16 auctions left, a complete 8-letter word in hand.
import { loadDict } from "../src/engine/dict.js";
import { countsOf } from "../src/engine/letters.js";
import { Tracker } from "../src/engine/tracker.js";
import { Lala } from "../src/strategy/lala.js";
import { TUNED } from "../src/strategy/params.js";
const d = loadDict();
const rule = { starveBal: 8, starveT: 10, starveMinLen: 7 };
for (const [rack, bal, left] of [["EEINOOPRSU", 2, 17], ["EEINOOPRSU", 40, 17], ["ADDEGILNOORSY", 6, 26], ["AEIRT", 3, 30], ["EEINOOPRSU", 2, 8]] as const) {
  const out = [["v2.7", {}], ["+rule", rule]].map(([name, extra]) => {
    const t = new Tracker(0, [0, 1, 2, 3, 4, 5], countsOf(rack), "Vickrey", 5);
    t.onAuction(6, left - 1);
    const r = new Lala(d, { ...TUNED, ...(extra as object) }).act({ auctionType: "Vickrey", me: 0, n: 6, round: 69 - left, letter: 6, auctionsLeft: left, rack: countsOf(rack), balance: bal, score: 0, tracker: t, wonLast: false });
    return `${name}: ${r.words.join(",") || "hold"}`;
  });
  console.log(`${rack.padEnd(14)} coins ${String(bal).padStart(2)} left ${left}: ${out.join("  |  ")}`);
}
