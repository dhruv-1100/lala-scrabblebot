import { loadDict } from "../src/engine/dict.js";
import { countsOf, BAG_COUNTS } from "../src/engine/letters.js";
import { Valuer } from "../src/strategy/value.js";
import { DEFAULT_LALA } from "../src/strategy/lala.js";
import { LIVE_PAID } from "../src/sim/agents.js";
const d = loadDict();
const v = new Valuer(d);
const unseen = Uint8Array.from(BAG_COUNTS);
for (const r of ["AEINR", "AEINRST", "QZXJAEIOUT", "EEIIOAURST", "ETAOINSHRD"]) {
  const c = countsOf(r);
  let t = performance.now();
  let res;
  for (let i = 0; i < 50; i++) res = v.evaluate(c, 18, unseen, 40, LIVE_PAID, 0.45, DEFAULT_LALA, 1);
  console.log(r, ((performance.now() - t) / 50).toFixed(2) + "ms", res!.base.toFixed(1), res!.withLetter.toFixed(1), d.words[res!.bestWord]);
}
