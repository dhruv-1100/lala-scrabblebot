// Lala's live record from its own logs (data/live/*.jsonl).
//   npx tsx analysis/live.ts [sinceMatchId]
import * as fs from "node:fs";
import * as path from "node:path";
import { mean, quantile } from "./load.js";

const DIR = path.resolve(process.env.LOG_DIR ?? "data/live");
const since = Number(process.argv[2] ?? 0);
const read = (prefix: string) =>
  fs.existsSync(DIR)
    ? fs.readdirSync(DIR).filter((f) => f.startsWith(prefix)).sort()
        .flatMap((f) => fs.readFileSync(path.join(DIR, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)))
    : [];

const ms = read("matches-").filter((m) => m.match >= since);
const ds = read("decisions-").filter((d) => d.match >= since);
const errs = read("errors-");
const ci = (xs: number[]) => {
  const m = mean(xs);
  const sd = Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, xs.length - 1));
  return `${m.toFixed(2)} ± ${(1.96 * sd / Math.sqrt(Math.max(1, xs.length))).toFixed(2)}`;
};
console.log(`matches ${ms.length}`);
if (ms.length) {
  console.log(`win rate ${ci(ms.map((m) => (m.place === 1 ? 1 : 0)))}`);
  console.log(`avg place ${ci(ms.map((m) => m.place))}`);
  console.log(`avg score ${ci(ms.map((m) => m.score))}`);
  const others = ms.map((m) => mean(m.scores.filter((s: { bot: number }) => s.bot !== 88).map((s: { score: number }) => s.score)));
  console.log(`field avg score ${mean(others).toFixed(1)}; best opponent ${mean(ms.map((m) => Math.max(...m.scores.filter((s: { bot: number }) => s.bot !== 88).map((s: { score: number }) => s.score)))).toFixed(1)}`);
  console.log(`tiles ${mean(ms.map((m) => m.tiles)).toFixed(1)}  spent ${mean(ms.map((m) => m.spent)).toFixed(0)}  final balance ${mean(ms.map((m) => m.balance)).toFixed(0)}`);
  console.log("places", JSON.stringify(ms.map((m) => m.place)));
  for (const m of ms.slice(-5)) console.log(`  match ${m.match}: place ${m.place} score ${m.score} words ${m.words.join(" ")}`);
}
if (ds.length) {
  const t = ds.map((d) => d.ms), lag = ds.map((d) => d.lagMs);
  console.log(`decisions ${ds.length}: compute p50 ${quantile(t, 0.5).toFixed(1)}ms p99 ${quantile(t, 0.99).toFixed(1)}ms max ${Math.max(...t).toFixed(1)}ms; receive lag p50 ${quantile(lag, 0.5)}ms p99 ${quantile(lag, 0.99)}ms (includes clock skew)`);
  console.log(`fallback bids ${ds.filter((d) => d.fallback).length}`);
}
console.log(`errors ${errs.length}`, errs.slice(-5).map((e) => e.err).join(" | "));
