// Record of Lala's games since a start time (default: site version 7, the
// clean-rating run), separating games where the connection stalled.
//   npx tsx analysis/since.ts [ISO start=2026-10-25T03:57:48Z]
import * as fs from "node:fs";
import * as path from "node:path";
const start = new Date(process.argv[2] ?? "2026-10-25T03:57:48Z").getTime();
const UTIL = [1, 0.76, 0.46, 0.06, -0.54, -1.74];
const log = fs.readFileSync("logs/lala.out.log", "utf8").split("\n");
// Stall times from the watchdog, and game end times with results.
const stalls: number[] = [];
const games: { t: number; match: number; place: number; score: number; words: string }[] = [];
for (const l of log) {
  const t = Date.parse(l.slice(0, 24));
  if (!Number.isFinite(t) || t < start) continue;
  if (l.includes("rebuilding the connection") || l.includes("disconnected")) stalls.push(t);
  const m = l.match(/match (\d+) ended: place (\d)\/\d score (\d+) arm \S+ words (.*)$/);
  if (m) games.push({ t, match: Number(m[1]), place: Number(m[2]), score: Number(m[3]), words: m[4]! });
}
const GAME_MS = 75_000;
const rows = games.map((g) => ({ ...g, stalled: stalls.some((s) => s <= g.t && s >= g.t - GAME_MS) }));
const sum = (xs: typeof rows, label: string) => {
  if (!xs.length) return console.log(`${label}: no games`);
  const n = xs.length, pl = xs.map((x) => x.place);
  console.log(`${label}: ${n} games | wins ${pl.filter((p) => p === 1).length} (${((100 * pl.filter((p) => p === 1).length) / n).toFixed(0)}%) | avg place ${(pl.reduce((a, b) => a + b, 0) / n).toFixed(2)} | 5th-6th ${pl.filter((p) => p >= 5).length} | avg score ${(xs.reduce((a, x) => a + x.score, 0) / n).toFixed(1)} | rating value ${(pl.reduce((a, p) => a + UTIL[p - 1]!, 0) / n).toFixed(2)}/game`);
};
console.log(`since ${new Date(start).toISOString()} (connection stalls: ${stalls.length})`);
sum(rows, "all games");
sum(rows.filter((r) => !r.stalled), "clean games");
sum(rows.filter((r) => r.stalled), "games with a stall");
console.log("\ngame log:");
for (const r of rows) console.log(`  ${new Date(r.t).toISOString().slice(11, 19)} m${r.match} place ${r.place} score ${String(r.score).padStart(3)}${r.stalled ? "  [stall]" : ""}  ${r.words}`);
void path;
