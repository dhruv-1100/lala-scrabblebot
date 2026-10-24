// Live results per strategy version, from the bot's own stdout log: each
// "match N ended" line is credited to the version whose params line came last.
//   npx tsx analysis/versions.ts [logs/lala.out.log]
import * as fs from "node:fs";
const PLACE_UTIL = [1, 0.76, 0.46, 0.06, -0.54, -1.74];
const tag = (p: Record<string, number>): string =>
  p.starveBal && p.lateMu === 1 ? "v2.3" : p.starveBal ? "v2.2" : p.premium === 0.9 ? "v2.1" : p.leaveW ? "v2.0" : p.capMul ? "v1.1" : "v0.1";
const lines = fs.readFileSync(process.argv[2] ?? "logs/lala.out.log", "utf8").split("\n");
let cur = "v0.1";
const by = new Map<string, { place: number[]; score: number[]; since: string }>();
let explicit: string | null = null;
for (const l of lines) {
  const vm = l.match(/\[Lala\] version (\S+)$/);
  if (vm) {
    explicit = vm[1]!;
    continue;
  }
  const pm = l.match(/^(\S+) \[Lala\] params (\{.*\})$/);
  if (pm) {
    cur = explicit ?? tag(JSON.parse(pm[2]!));
    explicit = null;
    if (!by.has(cur)) by.set(cur, { place: [], score: [], since: pm[1]! });
    continue;
  }
  const em = l.match(/match \d+ ended: place (\d)\/\d score (\d+)/);
  if (em) {
    if (!by.has(cur)) by.set(cur, { place: [], score: [], since: "?" });
    by.get(cur)!.place.push(Number(em[1]));
    by.get(cur)!.score.push(Number(em[2]));
  }
}
const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / Math.max(1, x.length);
const se = (x: number[]) => { const m = mean(x); return Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, x.length - 1) / Math.max(1, x.length)); };
console.log("| version | live since | games | win% | avg place | avg score | rating value/game | 5th-6th% |");
console.log("|---|---|---|---|---|---|---|---|");
for (const [v, s] of by) {
  const n = s.place.length;
  if (!n) continue;
  const wins = s.place.filter((p) => p === 1).length;
  console.log(`| ${v} | ${s.since.slice(11, 19)} | ${n} | ${((100 * wins) / n).toFixed(0)} | ${mean(s.place).toFixed(2)} ± ${(1.96 * se(s.place)).toFixed(2)} | ${mean(s.score).toFixed(0)} | ${mean(s.place.map((p) => PLACE_UTIL[p - 1]!)).toFixed(2)} | ${((100 * s.place.filter((p) => p >= 5).length) / n).toFixed(0)} |`);
}
