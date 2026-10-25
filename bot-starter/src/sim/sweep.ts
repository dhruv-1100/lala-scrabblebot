// Paired sweep: run the base once, then each variant on the same seeds, and
// print each variant's difference from the base.
//
//   npx tsx src/sim/sweep.ts --field top --n 800 --variants '[{"mu0":0.25},{"capMul":2}]'

import { arena, paired, summary, type FieldName } from "./arena.js";

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1]! : def;
}

const job = { field: arg("field", "top") as FieldName, fieldParams: JSON.parse(arg("fieldParams", "{}")), players: 6, auctionType: "Vickrey" as const };
const n = Number(arg("n", "800"));
const seed = Number(arg("seed", "1"));
const base = await arena({ ...job, params: JSON.parse(arg("base", "{}")) }, n, seed);
console.log(`base: ${summary(base)}`);
for (const v of JSON.parse(arg("variants", "[]")) as object[]) {
  const rows = await arena({ ...job, params: v }, n, seed);
  console.log(`${JSON.stringify(v)}:   ${paired(rows, base)}`);
}
