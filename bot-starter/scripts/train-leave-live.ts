// Leave values learned from real matches instead of simulation: rebuild each
// bot's rack round by round (won tiles, plus starting tiles once a word
// reveals them) and regress future score on rack contents, as in
// train-leave.ts. Writes src/strategy/leave-table-live.json.
//   npx tsx scripts/train-leave-live.ts [recentMatches=2500] [minPlaceShare=0]
import * as fs from "node:fs";
import { load, groupBy } from "../analysis/load.js";
import { idx } from "../src/engine/letters.js";

const RECENT = Number(process.argv[2] ?? 2500);
const BUCKETS = [[41, 99], [16, 40], [3, 15]] as const;
const ms = load("matchState").filter((m) => m.status === "Ended").sort((a, b) => a.id - b.id).slice(-RECENT);
const ids = new Set(ms.map((m) => m.id));
const results = groupBy(load("auctionResult").filter((r) => ids.has(r.matchId)), (r) => r.matchId);
const words = groupBy(load("wordPlay").filter((w) => ids.has(w.matchId)), (w) => w.matchId);
const parts = groupBy(load("matchParticipant").filter((p) => ids.has(p.matchId)), (p) => p.matchId);

const rows: { b: number; rack: number[]; bal: number; hidden: number; y: number }[] = [];
for (const m of ms) {
  const rs = (results.get(m.id) ?? []).sort((a, b) => a.auctionId - b.auctionId);
  if (rs.length < 60) continue;
  const ws = (words.get(m.id) ?? []).sort((a, b) => a.playedAt - b.playedAt || a.id - b.id);
  for (const p of parts.get(m.id) ?? []) {
    if (p.score === 0) continue; // offline bots
    const myWords = ws.filter((w) => w.botId === p.botId).map((w) => ({ w, round: rs.filter((r) => r.closedAt <= w.playedAt).length }));
    // Which played letters came from the hidden starting rack (in hindsight).
    const won = rs.map((r, i) => ({ letter: r.letter, round: i + 1, winner: r.winnerBotId, paid: r.paid })).filter((r) => r.winner === p.botId);
    const pool = won.map((t) => ({ ...t, used: false }));
    const starters: number[] = new Array(26).fill(0);
    for (const { w, round } of myWords) {
      for (const ch of w.word) {
        const t = pool.find((x) => !x.used && x.letter === ch && x.round <= round);
        if (t) t.used = true;
        else starters[idx(ch)]!++;
      }
    }
    const revealed = starters.reduce((a, b) => a + b, 0);
    // Walk rounds, snapshot every 5.
    const rack = [...starters];
    let bal = 100, score = 0, wi = 0, ti = 0;
    for (let round = 1; round <= rs.length; round++) {
      while (wi < myWords.length && myWords[wi]!.round < round) {
        const { w } = myWords[wi++]!;
        for (const ch of w.word) rack[idx(ch)] = Math.max(0, rack[idx(ch)]! - 1);
        bal += w.totalReward;
        score += w.totalReward;
      }
      while (ti < won.length && won[ti]!.round < round) {
        rack[idx(won[ti]!.letter)]!++;
        bal -= won[ti]!.paid;
        ti++;
      }
      const T = rs.length - round + 1;
      if (round % 5 === 0 && BUCKETS.some(([lo, hi]) => T >= lo && T <= hi)) {
        rows.push({ b: BUCKETS.findIndex(([lo, hi]) => T >= lo && T <= hi), rack: [...rack], bal, hidden: 5 - revealed, y: p.score - score });
      }
    }
  }
}
console.log(`${rows.length} snapshots from ${ms.length} live matches`);

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
  for (let a = 1; a < d; a++) A[a]![a]! += lambda;
  for (let c = 0; c < d; c++) {
    let pv = c;
    for (let r = c + 1; r < d; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[pv]![c]!)) pv = r;
    [A[c], A[pv]] = [A[pv]!, A[c]!];
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

const table: number[][][] = [];
const meta: { n: number; r2: number; balCoef: number }[] = [];
BUCKETS.forEach(([lo, hi], b) => {
  const rs = rows.filter((r) => r.b === b);
  const X = rs.map((r) => {
    const x = [1, r.bal / 100, r.hidden];
    for (let k = 0; k < 26; k++) for (let j = 1; j <= 3; j++) x.push(r.rack[k]! >= j ? 1 : 0);
    return x;
  });
  const y = rs.map((r) => r.y);
  const w = ridge(X, y, 30);
  const pred = X.map((x) => x.reduce((s, v, i) => s + v * w[i]!, 0));
  const my = y.reduce((a, c) => a + c, 0) / y.length;
  const r2 = 1 - y.reduce((s, v, i) => s + (v - pred[i]!) ** 2, 0) / y.reduce((s, v) => s + (v - my) ** 2, 0);
  meta.push({ n: rs.length, r2, balCoef: w[1]! });
  console.log(`bucket ${b} (T ${lo}-${hi}): n=${rs.length} R2=${r2.toFixed(3)} per-coin ${(w[1]! / 100).toFixed(3)} per-hidden-tile ${w[2]!.toFixed(2)}`);
  table.push(Array.from({ length: 26 }, (_, k) => [w[3 + k * 3]!, w[4 + k * 3]!, w[5 + k * 3]!]));
});
fs.writeFileSync("src/strategy/leave-table-live.json", JSON.stringify({ buckets: BUCKETS, table, meta }));
const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const sim = JSON.parse(fs.readFileSync("src/strategy/leave-table.json", "utf8"));
for (const b of [0, 1]) {
  console.log(`bucket ${b} 1st copy  live: ` + A.split("").map((c, k) => `${c}${table[b]![k]![0]!.toFixed(1)}`).join(" "));
  console.log(`bucket ${b} 1st copy   sim: ` + A.split("").map((c, k) => `${c}${sim.table[b][k][0].toFixed(1)}`).join(" "));
}
