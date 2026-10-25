// Arena: run many simulated matches of one candidate against a field, in
// parallel worker threads, and report win rate, average place and average
// score with 95% confidence intervals.
//
//   npx tsx src/sim/arena.ts --field market --n 2000 --params '{"mu0":0.4}'
//   npx tsx src/sim/arena.ts --field market --n 2000 --base '{}' --params '{"mu0":0.4}'
//     (paired comparison: same seeds, candidate vs base in the same seat)

import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import * as os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadDict } from "../engine/dict.js";
import { runMatch } from "./sim.js";
import { MarketBot, SimBot, StarterBot, DEFAULT_MARKET, type MarketParams } from "./agents.js";
import { Lala, type LalaParams } from "../strategy/lala.js";
import { TUNED, LIVELIKE, RIVAL_STYLES } from "../strategy/params.js";
import type { Agent } from "./types.js";
import type { AuctionType } from "../engine/tracker.js";

export type FieldName = "market" | "sims" | "starter" | "self" | "mixed" | "lalamix" | "livelike" | "blend" | "pop" | "experts";

export interface Job {
  field: FieldName;
  params: Partial<LalaParams>;
  fieldParams?: Partial<LalaParams>;
  market?: Partial<MarketParams>;
  seeds: number[];
  players: number;
  auctionType: AuctionType;
}

export interface Row {
  seed: number;
  place: number;
  score: number;
  win: number;
  best: number;      // best opponent score
  tiles: number;
  vowels: number;
  spent: number;
  balance: number;
  unplayed: number;
  fieldScore: number;
  rejected: number;
}

function field(dict: ReturnType<typeof loadDict>, job: Job, seed: number): Agent[] {
  const n = job.players - 1;
  const mk = (i: number): Agent => {
    const s = seed * 31 + i;
    switch (job.field) {
      case "market":
        return new MarketBot(dict, s, { ...DEFAULT_MARKET, ...job.market });
      case "sims":
        return new SimBot(dict, (["Cheapskate", "ValueBidder", "Aggressive", "ValueBidder", "Aggressive", "Cheapskate"] as const)[i % 6]!, s);
      case "starter":
        return new StarterBot(dict);
      case "experts":
        return new Lala(dict, { ...TUNED, ...job.fieldParams, expertPolicy: [2, 3, 4, 1, 1][i % 5], expertBidScale: i === 4 ? 1.05 : 1 }, `expert-${i}`);
      case "self":
        return new Lala(dict, { ...TUNED, ...job.fieldParams }, `lala-f${i}`);
      case "mixed":
        return i % 2 === 0 ? new MarketBot(dict, s, { ...DEFAULT_MARKET, ...job.market }) : new Lala(dict, { ...TUNED, ...job.fieldParams }, `lala-f${i}`);
      case "livelike":
        // Live-like rivals: cash 7-letter words early, noisy bids.
        return new Lala(dict, { ...TUNED, ...LIVELIKE, ...job.fieldParams, seed: s }, `live-${i}`);
      case "pop": {
        // Rivals modelled on the top live bots; styles rotate across seats and seeds.
        const style = RIVAL_STYLES[(i + seed) % RIVAL_STYLES.length]!;
        return new Lala(dict, { ...TUNED, ...style, ...job.fieldParams, seed: s }, `pop-${i}`);
      }
      case "blend":
        // Two market bots and three live-like rivals.
        return i < 2
          ? new MarketBot(dict, s, { ...DEFAULT_MARKET, ...job.market })
          : new Lala(dict, { ...TUNED, ...LIVELIKE, ...job.fieldParams, seed: s }, `live-${i}`);
      case "lalamix": {
        // Lala variants with perturbed parameters stand in for strong rivals.
        const base = { ...TUNED, ...job.fieldParams };
        const jit = (x: number) => x * (0.75 + 0.5 * ((s * 7919 + i * 104729) % 1000) / 1000);
        return new Lala(dict, { ...base, mu0: jit(base.mu0 ?? 0.45), winP: Math.min(0.9, jit(base.winP ?? 0.6)) }, `lala-m${i}`);
      }
    }
  };
  return Array.from({ length: n }, (_, i) => mk(i));
}

function runJob(job: Job): Row[] {
  const dict = loadDict();
  const rows: Row[] = [];
  for (const seed of job.seeds) {
    const opp = field(dict, job, seed);
    const seat = seed % job.players;
    const agents = [...opp];
    agents.splice(seat, 0, new Lala(dict, { ...TUNED, ...job.params }, "cand"));
    const r = runMatch(dict, agents, { seed, auctionType: job.auctionType });
    const others = r.scores.filter((_, i) => i !== seat);
    rows.push({
      seed, place: r.places[seat]!, score: r.scores[seat]!, win: r.places[seat] === 1 ? 1 : 0,
      best: Math.max(...others), tiles: r.tilesWon[seat]!, vowels: r.vowelsWon[seat]!, spent: r.spent[seat]!,
      balance: r.balances[seat]!, unplayed: r.unplayed[seat]!,
      fieldScore: others.reduce((a, b) => a + b, 0) / others.length, rejected: r.rejected[seat]!,
    });
  }
  return rows;
}

if (!isMainThread) {
  parentPort!.postMessage(runJob(workerData as Job));
}

export async function arena(job: Omit<Job, "seeds">, n: number, seed0 = 1, threads = Math.min(2, Math.max(1, os.cpus().length - 1))): Promise<Row[]> {
  const seeds = Array.from({ length: n }, (_, i) => seed0 + i);
  const chunks: number[][] = Array.from({ length: threads }, () => []);
  seeds.forEach((s, i) => chunks[i % threads]!.push(s));
  const file = fileURLToPath(import.meta.url);
  const parts = await Promise.all(
    chunks.filter((c) => c.length).map((c) => new Promise<Row[]>((resolve, reject) => {
      const boot = new URL("./worker.mjs", import.meta.url);
      const w = new Worker(boot, { workerData: { ...job, seeds: c, __file: pathToFileURL(file).href } });
      w.once("message", resolve);
      w.once("error", reject);
    })),
  );
  return parts.flat().sort((a, b) => a.seed - b.seed);
}

// Rating change per finishing place for six equal-rated bots under
// OpenSkill Plackett-Luce, relative to a win (see the research report).
export const PLACE_UTIL = [1, 0.76, 0.46, 0.06, -0.54, -1.74];

export function ci(xs: number[]): [number, number] {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1);
  return [m, 1.96 * Math.sqrt(v / xs.length)];
}

export function summary(rows: Row[]): string {
  const f = (xs: number[], d = 2) => {
    const [m, h] = ci(xs);
    return `${m.toFixed(d)}±${h.toFixed(d)}`;
  };
  return [
    `n=${rows.length}`,
    `win=${f(rows.map((r) => r.win), 3)}`,
    `place=${f(rows.map((r) => r.place))}`,
    // Rating value of each finish under OpenSkill with equal ratings (1st = 1).
    `util=${f(rows.map((r) => PLACE_UTIL[r.place - 1] ?? -1.74), 3)}`,
    `p6=${(100 * rows.filter((r) => r.place === 6).length / rows.length).toFixed(1)}%`,
    `score=${f(rows.map((r) => r.score), 1)}`,
    `margin=${f(rows.map((r) => r.score - r.best), 1)}`,
    `field=${(rows.reduce((a, r) => a + r.fieldScore, 0) / rows.length).toFixed(1)}`,
    `tiles=${(rows.reduce((a, r) => a + r.tiles, 0) / rows.length).toFixed(1)}`,
    `vowel%=${(100 * rows.reduce((a, r) => a + r.vowels, 0) / Math.max(1, rows.reduce((a, r) => a + r.tiles, 0))).toFixed(0)}`,
    `spent=${(rows.reduce((a, r) => a + r.spent, 0) / rows.length).toFixed(0)}`,
    `bal=${(rows.reduce((a, r) => a + r.balance, 0) / rows.length).toFixed(0)}`,
    `unplayed=${(rows.reduce((a, r) => a + r.unplayed, 0) / rows.length).toFixed(2)}`,
    `rej=${rows.reduce((a, r) => a + r.rejected, 0)}`,
  ].join("  ");
}

// Paired difference (cand - base) on the same seeds.
export function paired(a: Row[], b: Row[]): string {
  const d = (k: keyof Row) => {
    const xs = a.map((r, i) => (r[k] as number) - (b[i]![k] as number));
    const [m, h] = ci(xs);
    const sig = Math.abs(m) > h ? (m > 0 ? " +" : " -") : "";
    return `${k} ${m >= 0 ? "+" : ""}${m.toFixed(3)}±${h.toFixed(3)}${sig}`;
  };
  const u = a.map((r, i) => (PLACE_UTIL[r.place - 1] ?? -1.74) - (PLACE_UTIL[b[i]!.place - 1] ?? -1.74));
  const [um, uh] = ci(u);
  return [d("win"), d("place"), d("score"), `util ${um >= 0 ? "+" : ""}${um.toFixed(3)}±${uh.toFixed(3)}${Math.abs(um) > uh ? (um > 0 ? " +" : " -") : ""}`].join("   ");
}

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

if (isMainThread && process.argv[1] === fileURLToPath(import.meta.url)) {
  const job = {
    field: (arg("field", "market") as FieldName),
    params: JSON.parse(arg("params", "{}")!),
    fieldParams: JSON.parse(arg("fieldParams", "{}")!),
    market: JSON.parse(arg("market", "{}")!),
    players: Number(arg("players", "6")),
    auctionType: (arg("auction", "Vickrey") as AuctionType),
  };
  const n = Number(arg("n", "500"));
  const t = Date.now();
  const threads = Number(arg("threads", "2"));
  if (!Number.isInteger(threads) || threads < 1) throw new Error("--threads must be a positive integer");
  const rows = await arena(job, n, Number(arg("seed", "1")), threads);
  console.log(`cand ${JSON.stringify(job.params)}\n  ${summary(rows)}`);
  const base = arg("base");
  if (base !== undefined) {
    const brows = await arena({ ...job, params: JSON.parse(base) }, n, Number(arg("seed", "1")), threads);
    console.log(`base ${base}\n  ${summary(brows)}\n  diff: ${paired(rows, brows)}`);
  }
  console.log(`(${((Date.now() - t) / 1000).toFixed(0)}s)`);
}
