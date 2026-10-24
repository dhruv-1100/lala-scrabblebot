// Live A/B summary: games are split between arms by a hash of the match id,
// so both arms face the same field. Reads data/live/matches-*.jsonl.
//   npx tsx analysis/ab.ts [version=v2.7-ab]
import * as fs from "node:fs";
import * as path from "node:path";
const version = process.argv[2] ?? "v2.7-ab";
const UTIL = [1, 0.76, 0.46, 0.06, -0.54, -1.74];
const rows = fs.readdirSync("data/live").filter((f) => f.startsWith("matches-"))
  .flatMap((f) => fs.readFileSync(path.join("data/live", f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)))
  .filter((m) => m.version === version);
const stat = (xs: number[]) => {
  const n = xs.length, m = xs.reduce((a, b) => a + b, 0) / Math.max(1, n);
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, n - 1));
  return { n, m, h: (1.96 * sd) / Math.sqrt(Math.max(1, n)) };
};
const arms: Record<string, any[]> = { A: [], B: [] };
for (const r of rows) (arms[r.arm] ??= []).push(r);
console.log(`${version}: ${rows.length} games`);
console.log("| arm | games | wins | avg place | 5th-6th | avg score | rating value/game |");
console.log("|---|---|---|---|---|---|---|");
for (const a of ["A", "B"]) {
  const xs = arms[a] ?? [];
  if (!xs.length) continue;
  const p = stat(xs.map((x) => x.place)), u = stat(xs.map((x) => UTIL[x.place - 1]!));
  console.log(`| ${a} | ${xs.length} | ${((100 * xs.filter((x) => x.place === 1).length) / xs.length).toFixed(0)}% | ${p.m.toFixed(2)} ± ${p.h.toFixed(2)} | ${((100 * xs.filter((x) => x.place >= 5).length) / xs.length).toFixed(0)}% | ${(xs.reduce((s, x) => s + x.score, 0) / xs.length).toFixed(1)} | ${u.m.toFixed(2)} ± ${u.h.toFixed(2)} |`);
}
