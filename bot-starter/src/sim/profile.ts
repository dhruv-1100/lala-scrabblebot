// Phase profile of one simulated seat, in the same shape as analysis/study.ts
// prints for live bots, so a parameter set can be matched to a live bot's
// spending curve (coins on hand, tiles and bid levels per stage).
//
//   npx tsx src/sim/profile.ts --field pop --n 400 --params '{"mu0":0.4}'

import { loadDict } from "../engine/dict.js";
import { runMatch } from "./sim.js";
import { LIVE_PAID, MarketBot, DEFAULT_MARKET } from "./agents.js";
import { Lala, type LalaParams } from "../strategy/lala.js";
import { TUNED, LIVELIKE, RIVAL_STYLES } from "../strategy/params.js";
import type { Agent, View } from "./types.js";

const PH = [[1, 20], [21, 45], [46, 56], [57, 68]] as const;
const arg = (k: string, d?: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const n = Number(arg("n", "400"));
const fieldName = arg("field", "pop")!;
const params: Partial<LalaParams> = JSON.parse(arg("params", "{}")!);
const fieldParams: Partial<LalaParams> = JSON.parse(arg("fieldParams", "{}")!);
const seed0 = Number(arg("seed", "500000"));
const dict = loadDict();

function rival(i: number, seed: number): Agent {
  const s = seed * 31 + i;
  if (fieldName === "market") return new MarketBot(dict, s, DEFAULT_MARKET);
  if (fieldName === "livelike") return new Lala(dict, { ...TUNED, ...LIVELIKE, ...fieldParams, seed: s }, `live-${i}`);
  if (fieldName === "self") return new Lala(dict, { ...TUNED, ...fieldParams }, `self-${i}`);
  const style = RIVAL_STYLES[(i + seed) % RIVAL_STYLES.length]!;
  return new Lala(dict, { ...TUNED, ...style, ...fieldParams, seed: s }, `pop-${i}`);
}

// Records the balance the candidate sees at the start of each auction.
class Spy implements Agent {
  readonly name = "spy";
  coins: number[] = [];
  constructor(private inner: Agent) {}
  startMatch(me: number, k: number, t: Parameters<NonNullable<Agent["startMatch"]>>[2]) { this.coins = []; this.inner.startMatch?.(me, k, t); }
  act(v: View) { this.coins[v.round] = v.balance; return this.inner.act(v); }
  endMatch(place: number, scores: number[]) { this.inner.endMatch?.(place, scores); }
}

interface Prof { place: number; score: number; c: number[]; tiles: number[]; spent: number[]; ratio: number[][]; words: number; big: number }
const rows: Prof[] = [];
for (let k = 0; k < n; k++) {
  const seed = seed0 + k;
  const seat = seed % 6;
  const spy = new Spy(new Lala(dict, { ...TUNED, ...params }, "cand"));
  const agents: Agent[] = Array.from({ length: 5 }, (_, i) => rival(i, seed));
  agents.splice(seat, 0, spy);
  const r = runMatch(dict, agents, { seed, record: true });
  const au = r.auctions!;
  const at = (round: number) => spy.coins[round] ?? spy.coins[spy.coins.length - 1] ?? 0;
  const tiles: number[] = [], spent: number[] = [], ratio: number[][] = [];
  for (const [lo, hi] of PH) {
    const won = au.filter((a) => a.winner === seat && a.round >= lo && a.round <= hi);
    tiles.push(won.length);
    spent.push(won.reduce((s, a) => s + a.paid, 0));
    ratio.push(won.map((a) => a.bids[seat]! / LIVE_PAID[a.letter]!));
  }
  rows.push({
    place: r.places[seat]!, score: r.scores[seat]!, c: [at(20), at(45), at(56)], tiles, spent, ratio,
    words: r.words[seat]!.length, big: r.words[seat]!.filter((w) => w.length >= 7).length,
  });
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const show = (label: string, rs: Prof[]) => {
  if (!rs.length) return;
  const f = (xs: number[], d = 1) => mean(xs).toFixed(d);
  console.log(`\n${label}: ${rs.length} games, place ${f(rs.map((r) => r.place), 2)}, win ${(100 * mean(rs.map((r) => (r.place === 1 ? 1 : 0)))).toFixed(0)}%, score ${f(rs.map((r) => r.score))}`);
  console.log(`  coins on hand at round 20 / 45 / 56:  ${[0, 1, 2].map((i) => f(rs.map((r) => r.c[i]!), 0)).join(" / ")}`);
  PH.forEach(([lo, hi], i) => {
    const rt = rs.flatMap((r) => r.ratio[i]!).sort((a, b) => a - b);
    console.log(`  rounds ${String(lo).padStart(2)}-${hi}: tiles ${f(rs.map((r) => r.tiles[i]!))}  spent ${f(rs.map((r) => r.spent[i]!), 0)}  bid/price median ${rt.length ? rt[Math.floor(rt.length / 2)]!.toFixed(2) : "-"}`);
  });
  console.log(`  words ${f(rs.map((r) => r.words))}, 7+ words ${f(rs.map((r) => r.big), 2)}`);
};
show(`sim ${fieldName} ${JSON.stringify(params)}`, rows);
