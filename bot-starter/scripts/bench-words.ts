import { loadDict } from "../src/engine/dict.js";
import { countsOf } from "../src/engine/letters.js";
import { bestPartition, playable } from "../src/engine/words.js";
let t = performance.now();
const d = loadDict();
console.log("dict", d.words.length, "load ms", (performance.now() - t).toFixed(0), "maxLen", d.maxLen, "7-8 letter", d.range(7, 8));
for (const r of ["AEINRST", "QZXJAEIOUT", "AEEIINORSTTLNDG", "ETAOINSHRDLUCMFWYP", "AABEEIILNORSTU"]) {
  const c = countsOf(r);
  t = performance.now();
  const p = bestPartition(d, c);
  const ms = performance.now() - t;
  t = performance.now();
  const pl = playable(d, c, 7, 5).map((i) => d.words[i]);
  console.log(r, JSON.stringify(p), ms.toFixed(1) + "ms", pl, (performance.now() - t).toFixed(1) + "ms");
}
