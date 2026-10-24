// Coordinate search over Lala parameters (on top of TUNED) on a fixed seed set. Each step
// tries every listed value of one parameter and keeps the best by average
// place (ties broken by score). Prints a log line per trial.
//
//   npx tsx src/sim/tune.ts --field market --n 280 --start '{"mu0":0.35}' \
//     --grid '{"kappa0":[3,4,5],"mu0":[0.3,0.4,0.5]}' --rounds 2

import { arena, summary, ci, type FieldName } from "./arena.js";
import type { LalaParams } from "../strategy/lala.js";

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1]! : def;
}

const field = arg("field", "market") as FieldName;
const n = Number(arg("n", "280"));
const seed = Number(arg("seed", "1000"));
const grid = JSON.parse(arg("grid", "{}")) as Record<string, number[]>;
const fieldParams = JSON.parse(arg("fieldParams", "{}"));
const rounds = Number(arg("rounds", "1"));
let cur: Partial<LalaParams> = JSON.parse(arg("start", "{}"));

const score = async (p: Partial<LalaParams>) => {
  const rows = await arena({ field, params: p, fieldParams, players: 6, auctionType: "Vickrey" }, n, seed);
  return { rows, place: ci(rows.map((r) => r.place))[0], sc: ci(rows.map((r) => r.score))[0] };
};

let best = await score(cur);
console.log(`start ${JSON.stringify(cur)}  ${summary(best.rows)}`);
for (let r = 0; r < rounds; r++) {
  for (const [k, vals] of Object.entries(grid)) {
    for (const v of vals) {
      if ((cur as Record<string, number>)[k] === v) continue;
      const cand = { ...cur, [k]: v };
      const res = await score(cand);
      const better = res.place < best.place - 1e-9 || (Math.abs(res.place - best.place) < 1e-9 && res.sc > best.sc);
      console.log(`${better ? "*" : " "} ${k}=${v}  ${summary(res.rows)}`);
      if (better) {
        best = res;
        cur = cand;
      }
    }
  }
  console.log(`round ${r + 1} best ${JSON.stringify(cur)}  place=${best.place.toFixed(3)} score=${best.sc.toFixed(1)}`);
}
