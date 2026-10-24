// Learn leave values (Maven-style): regress future points on rack contents
// from simulated matches, per stage of the match.
//
//   npx tsx scripts/train-leave.ts <seedStart> <matches> <out.jsonl>   (collect)
//   npx tsx scripts/train-leave.ts fit <in1.jsonl> [in2.jsonl ...]     (fit -> leave-table.json)

import * as fs from "node:fs";
import { loadDict } from "../src/engine/dict.js";
import { runMatch } from "../src/sim/sim.js";
import { MarketBot, DEFAULT_MARKET } from "../src/sim/agents.js";
import { Lala } from "../src/strategy/lala.js";
import { TUNED, RIVAL_STYLES } from "../src/strategy/params.js";
import type { Agent, View, Action } from "../src/sim/types.js";

const BUCKETS = [[41, 99], [16, 40], [3, 15]] as const; // auctionsLeft ranges
const bucketOf = (T: number) => BUCKETS.findIndex(([lo, hi]) => T >= lo && T <= hi);

class Recorder implements Agent {
  readonly name: string;
  snaps: { T: number; rack: number[]; bal: number; score: number }[] = [];
  constructor(private inner: Agent, private every: number) { this.name = inner.name; }
  act(v: View): Action {
    if (v.round % this.every === 0 && bucketOf(v.auctionsLeft) >= 0) {
      this.snaps.push({ T: v.auctionsLeft, rack: Array.from(v.rack), bal: v.balance, score: v.score });
    }
    return this.inner.act(v);
  }
}

async function collect(seed0: number, n: number, out: string) {
  const dict = loadDict();
  const lines: string[] = [];
  for (let s = seed0; s < seed0 + n; s++) {
    const agents: Agent[] = [];
    for (let i = 0; i < 6; i++) {
      const a: Agent = i < 3
        ? new Lala(dict, { ...TUNED, ...RIVAL_STYLES[(i + s) % RIVAL_STYLES.length], bidNoise: 0.2, seed: s * 7 + i }, `r${i}`)
        : new MarketBot(dict, s * 13 + i, DEFAULT_MARKET);
      agents.push(new Recorder(a, 5));
    }
    const r = runMatch(dict, agents, { seed: 31337 + s });
    agents.forEach((a, p) => {
      for (const sn of (a as Recorder).snaps) {
        lines.push(JSON.stringify({ T: sn.T, rack: sn.rack, bal: sn.bal, y: r.scores[p]! - sn.score }));
      }
    });
  }
  fs.writeFileSync(out, lines.join("\n") + "\n");
  console.log(`wrote ${lines.length} samples to ${out}`);
}

// Ridge regression via normal equations.
function ridge(X: number[][], y: number[], lambda: number): number[] {
  const d = X[0]!.length;
  const A = Array.from({ length: d }, () => new Array<number>(d + 1).fill(0));
  for (let i = 0; i < X.length; i++) {
    const x = X[i]!;
    for (let a = 0; a < d; a++) {
      if (!x[a]) continue;
      for (let b = 0; b < d; b++) A[a]![b]! += x[a]! * x[b]!;
      A[a]![d]! += x[a]! * y[i]!;
    }
  }
  for (let a = 1; a < d; a++) A[a]![a]! += lambda; // intercept (col 0) unpenalised
  for (let c = 0; c < d; c++) {
    let p = c;
    for (let r = c + 1; r < d; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[p]![c]!)) p = r;
    [A[c], A[p]] = [A[p]!, A[c]!];
    const piv = A[c]![c]! || 1e-9;
    for (let r = 0; r < d; r++) {
      if (r === c) continue;
      const f = A[r]![c]! / piv;
      if (!f) continue;
      for (let k = c; k <= d; k++) A[r]![k]! -= f * A[c]![k]!;
    }
  }
  return A.map((row, i) => row[d]! / (row[i] || 1e-9));
}

function fit(files: string[]) {
  const rows = files.flatMap((f) => fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));
  console.log(`${rows.length} samples`);
  const table: number[][][] = []; // [bucket][letter][copies 1..3] marginal points
  const meta: Record<string, number>[] = [];
  BUCKETS.forEach(([lo, hi], b) => {
    const rs = rows.filter((r) => r.T >= lo && r.T <= hi);
    // features: intercept, balance, then 3 incremental copy indicators per letter
    const X = rs.map((r) => {
      const x = [1, r.bal / 100];
      for (let k = 0; k < 26; k++) for (let j = 1; j <= 3; j++) x.push(r.rack[k] >= j ? 1 : 0);
      return x;
    });
    const y = rs.map((r) => r.y);
    const w = ridge(X, y, 30);
    const pred = X.map((x) => x.reduce((s, v, i) => s + v * w[i]!, 0));
    const my = y.reduce((a, c) => a + c, 0) / y.length;
    const ssr = y.reduce((s, v, i) => s + (v - pred[i]!) ** 2, 0), sst = y.reduce((s, v) => s + (v - my) ** 2, 0);
    meta.push({ n: rs.length, r2: 1 - ssr / sst, balCoef: w[1]! });
    console.log(`bucket ${b} (T ${lo}-${hi}): n=${rs.length} R2=${(1 - ssr / sst).toFixed(3)} balance coef ${w[1]!.toFixed(2)}`);
    table.push(Array.from({ length: 26 }, (_, k) => [w[2 + k * 3]!, w[3 + k * 3]!, w[4 + k * 3]!]));
  });
  fs.writeFileSync("src/strategy/leave-table.json", JSON.stringify({ buckets: BUCKETS, table, meta }));
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  console.log("1st-copy value, early bucket: " + A.split("").map((c, k) => `${c}${table[0]![k]![0]!.toFixed(1)}`).join(" "));
  console.log("1st-copy value, mid bucket:   " + A.split("").map((c, k) => `${c}${table[1]![k]![0]!.toFixed(1)}`).join(" "));
}

if (process.argv[2] === "fit") fit(process.argv.slice(3));
else await collect(Number(process.argv[2]), Number(process.argv[3]), process.argv[4]!);
