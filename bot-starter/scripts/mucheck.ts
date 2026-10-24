// Shadow price and bid for a fixed rack across balances and match stages.
import { loadDict } from "../src/engine/dict.js";
import { countsOf } from "../src/engine/letters.js";
import { Tracker } from "../src/engine/tracker.js";
import { Lala } from "../src/strategy/lala.js";
import { TUNED } from "../src/strategy/params.js";
const d = loadDict();
const extra = JSON.parse(process.argv[2] ?? "{}");
for (const left of [60, 30, 12, 5]) for (const bal of [100, 30]) {
  const t = new Tracker(0, [0, 1, 2, 3, 4, 5], countsOf("AEIRS"), "Vickrey", 5);
  t.onAuction(19, left - 1);
  const r = new Lala(d, { ...TUNED, ...extra }).act({ auctionType: "Vickrey", me: 0, n: 6, round: 69 - left, letter: 19, auctionsLeft: left, rack: countsOf("AEIRS"), balance: bal, score: 0, tracker: t, wonLast: false });
  console.log("left", left, "bal", bal, "mu", r.mu.toFixed(3), "bid", r.bid, "ms", r.ms.toFixed(1));
}
