import { loadDict } from "../src/engine/dict.js";
import { BAG_COUNTS, ALPHA } from "../src/engine/letters.js";
const d = loadDict();
const [s, e] = d.range(7, 8);
const f = new Float64Array(26);
let tot = 0;
for (let i = s; i < e; i++) {
  for (let p = d.dOff[i]!; p < d.dOff[i + 1]!; p++) { f[d.dl[p]!] += d.dc[p]!; tot += d.dc[p]!; }
}
const out: number[] = [];
for (let k = 0; k < 26; k++) out.push(+((f[k]! / tot) / (BAG_COUNTS[k]! / 98)).toFixed(2));
console.log(ALPHA.split("").map((c, k) => `${c}:${out[k]}`).join(" "));
console.log(JSON.stringify(out));
