// Decision time for v-next params across rack sizes (worst case: big racks).
import { loadDict } from "../src/engine/dict.js";
import { countsOf } from "../src/engine/letters.js";
import { Tracker } from "../src/engine/tracker.js";
import { Lala } from "../src/strategy/lala.js";
import { TUNED } from "../src/strategy/params.js";
const d = loadDict();
const extra = JSON.parse(process.argv[2] ?? "{}");
const lala = new Lala(d, { ...TUNED, ...extra });
const times: number[] = [];
for (const rack of ["AEIRS", "ADDEEILOOST", "ADDEEILNNOOSTU", "AAEIIOPQTVYRS", "BCDEEGILMNORSTU"]) {
  for (const left of [50, 20, 6]) {
    const t = new Tracker(0, [0, 1, 2, 3, 4, 5], countsOf(rack), "Vickrey", 5);
    t.onAuction(4, left - 1);
    const r = lala.act({ auctionType: "Vickrey", me: 0, n: 6, round: 69 - left, letter: 4, auctionsLeft: left, rack: countsOf(rack), balance: 60, score: 0, tracker: t, wonLast: false });
    times.push(r.ms);
  }
}
times.sort((a, b) => a - b);
console.log(`decisions ${times.length}: median ${times[Math.floor(times.length / 2)]!.toFixed(1)}ms, max ${times.at(-1)!.toFixed(1)}ms`);
