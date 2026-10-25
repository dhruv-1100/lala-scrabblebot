// Monte Carlo bid valuation: play out the rest of the match many times and
// bid what the letter on auction is worth across those futures.
//
// Each future deals the actual unseen tiles into the remaining auctions in a
// random order and draws a clearing price for each from a lognormal around
// the going price for that letter and stage. Inside a future Lala chases its
// best target words: it buys a letter some target still needs when it can
// afford the price and the price is sane, plays a target the moment it is
// complete (the reward comes back as coins), and dumps what is left at the
// end. Every branch (lose the letter; win it and pay x, for several x) is run
// on the same futures, so the comparison is between strategies, not luck.
// The bid is the largest x for which winning still beats losing on average.

import type { Dict } from "../engine/dict.js";
import { VALUE } from "../engine/letters.js";
import { Rng } from "../engine/rng.js";

export interface RolloutParams {
  rolloutN: number;      // futures per decision
  rolloutPlans: number;  // target words chased in each future
  rolloutSigma: number;  // lognormal spread of clearing prices
  rolloutPriceMul: number; // clearing price median = going price x this
  rolloutCap: number;    // never pay more than this x the going price inside a future
  rolloutDump: number;   // end-of-match value per letter point of leftover tiles
  rolloutMaxMs: number;  // time budget; stop adding futures after this
  rolloutCoinW: number;  // weight on the learned points-per-coin for coins a future leaves unused
  rolloutMin: number;    // the rollout may move the formula bid between rolloutMin x
  rolloutMax: number;    // and rolloutMax x (bounded influence while it is unproven)
}

export const DEFAULT_ROLLOUT: RolloutParams = {
  rolloutN: 64, rolloutPlans: 40, rolloutSigma: 0.35, rolloutPriceMul: 1.1,
  rolloutCap: 1.6, rolloutDump: 1.0, rolloutMaxMs: 150, rolloutCoinW: 1,
  rolloutMin: 0.6, rolloutMax: 1.6,
};

// Bid levels tried, as multiples of the going price for the letter.
const GRID = [0.4, 0.7, 1.0, 1.25, 1.5, 1.8, 2.2];

export interface RolloutInput {
  rack: Uint8Array;      // after this auction's word plays
  letter: number;        // on auction now
  balance: number;
  unseen: Uint8Array;    // tiles we can't see (bag + rivals' hidden tiles)
  bagRemaining: number;  // future auctions = tiles left in the bag
  round: number;         // 1-based round of the open auction
  priceAt: (round: number, k: number) => number; // expected price per letter and round
  coinValue: (auctionsLeft: number) => number;    // learned points per coin (tables.ts)
}

export interface RolloutResult {
  bid: number;
  gainAtPrice: number;   // mean points gained by winning at the going price
  futures: number;
  plans: number;
  ms: number;
}

interface Plan {
  need: Uint8Array;      // letter counts of the word
  letters: number[];     // distinct letters
  reward: number;
  len: number;
}

export class Rollout {
  private rng = new Rng(12345);
  constructor(private dict: Dict) {}

  // Best target words for rack + letter: up to 3 letters short, 6-9 letters,
  // ranked by reward discounted per missing letter.
  private plans(rack: Uint8Array, letter: number, k: number): Plan[] {
    const d = this.dict;
    const r = new Uint8Array(rack);
    r[letter]!++;
    let tiles = 0;
    let rmask = 0;
    for (let i = 0; i < 26; i++) {
      tiles += r[i]!;
      if (r[i]) rmask |= 1 << i;
    }
    const [s, e] = d.range(6, Math.min(9, tiles + 3));
    const notR = ~rmask;
    const top: { i: number; score: number }[] = [];
    let floor = -1;
    for (let i = s; i < e; i++) {
      let x = d.mask[i]! & notR;
      if (x) {
        x = x - ((x >>> 1) & 0x55555555);
        x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
        if ((((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24 > 3) continue;
      }
      let def = 0;
      for (let p = d.dOff[i]!, q = d.dOff[i + 1]!; p < q; p++) {
        const need = d.dc[p]! - r[d.dl[p]!]!;
        if (need > 0) def += need;
      }
      if (def > 3) continue;
      const score = d.reward[i]! * Math.pow(0.55, def);
      if (top.length < k) {
        top.push({ i, score });
        if (top.length === k) {
          top.sort((a, b) => a.score - b.score);
          floor = top[0]!.score;
        }
      } else if (score > floor) {
        top[0] = { i, score };
        top.sort((a, b) => a.score - b.score);
        floor = top[0]!.score;
      }
    }
    return top.map(({ i }) => {
      const need = new Uint8Array(26);
      const letters: number[] = [];
      for (let p = d.dOff[i]!, q = d.dOff[i + 1]!; p < q; p++) {
        need[d.dl[p]!] = d.dc[p]!;
        letters.push(d.dl[p]!);
      }
      return { need, letters, reward: d.reward[i]!, len: d.len[i]! };
    });
  }

  // One future, one branch: final points gained from now on.
  private play(
    plans: Plan[], rack0: Uint8Array, coins0: number,
    seq: Uint8Array, prices: Float64Array, caps: Float64Array,
    def: Int16Array, defTot: Int16Array,
  ): number {
    const P = plans.length;
    const rack = new Uint8Array(rack0);
    let coins = coins0;
    let gained = 0;
    let tLast = 0; // auction index of the last word played
    const refresh = () => {
      for (let p = 0; p < P; p++) {
        const pl = plans[p]!;
        let tot = 0;
        for (const k of pl.letters) {
          const dd = pl.need[k]! - rack[k]!;
          const v = dd > 0 ? dd : 0;
          def[p * 26 + k] = v;
          tot += v;
        }
        defTot[p] = tot;
      }
    };
    let tNow = 0;
    const playReady = (force = false): void => {
      // Play the best complete plan, repeatedly, unless a plan worth 5+
      // more points is one letter away (then hold for the upgrade).
      for (;;) {
        let best = -1;
        for (let p = 0; p < P; p++) {
          if (defTot[p] === 0 && (best < 0 || plans[p]!.reward > plans[best]!.reward)) best = p;
        }
        if (best < 0) return;
        if (!force) {
          let upgrade = false;
          for (let p = 0; p < P; p++) {
            if (defTot[p] === 1 && plans[p]!.reward >= plans[best]!.reward + 5) {
              upgrade = true;
              break;
            }
          }
          if (upgrade) return;
        }
        const pl = plans[best]!;
        for (const k of pl.letters) rack[k]! -= pl.need[k]!;
        gained += pl.reward;
        coins += pl.reward;
        tLast = tNow;
        refresh();
      }
    };
    refresh();
    playReady();
    const n = seq.length;
    // The last auction's tile can never be played: stop buying before it.
    for (let t = 0; t < n - 1; t++) {
      tNow = t + 1;
      const l = seq[t]!;
      const m = prices[t]!;
      if (m > coins || m > caps[t]!) continue;
      let useful = false;
      for (let p = 0; p < P; p++) {
        if (def[p * 26 + l]! > 0) {
          useful = true;
          break;
        }
      }
      if (!useful) continue;
      coins -= m;
      rack[l]!++;
      for (let p = 0; p < P; p++) {
        if (def[p * 26 + l]! > 0) {
          def[p * 26 + l]!--;
          defTot[p]!--;
        }
      }
      playReady();
    }
    tNow = n;
    playReady(true); // cash everything before the final auction closes
    // Leftovers go out in short words at the end. Coins the known targets
    // left unused would have funded words this future can't see (targets are
    // fixed at the root): value them at the learned points per coin for the
    // auctions that were left when the last word was played.
    let dump = 0;
    for (let k = 0; k < 26; k++) dump += rack[k]! * VALUE[k]!;
    return gained + dump * this.dumpW + coins * this.coinW * this.coinValue(n - tLast);
  }

  private dumpW = 1;
  private coinW = 1;
  private coinValue: (auctionsLeft: number) => number = () => 0;

  value(inp: RolloutInput, rp: RolloutParams): RolloutResult | null {
    const t0 = performance.now();
    const F = inp.bagRemaining;
    if (F < 2) return null;
    const plans = this.plans(inp.rack, inp.letter, rp.rolloutPlans);
    if (plans.length < 3) return null;
    this.dumpW = rp.rolloutDump;
    this.coinW = rp.rolloutCoinW;
    this.coinValue = inp.coinValue;
    const pool: number[] = [];
    for (let k = 0; k < 26; k++) for (let j = 0; j < inp.unseen[k]!; j++) pool.push(k);
    if (pool.length < F) return null;
    const priceNow = inp.priceAt(inp.round, inp.letter);
    const def = new Int16Array(plans.length * 26);
    const defTot = new Int16Array(plans.length);
    const rackW = new Uint8Array(inp.rack);
    rackW[inp.letter]!++;
    const seq = new Uint8Array(F);
    const prices = new Float64Array(F);
    const caps = new Float64Array(F);
    const sums = new Float64Array(GRID.length);
    let futures = 0;
    for (let s = 0; s < rp.rolloutN; s++) {
      if (s >= 16 && performance.now() - t0 > rp.rolloutMaxMs) break;
      // Deal the future: F tiles drawn from the unseen pool, in order.
      for (let i = 0; i < F; i++) {
        const j = i + Math.floor(this.rng.next() * (pool.length - i));
        const tmp = pool[i]!;
        pool[i] = pool[j]!;
        pool[j] = tmp;
        const l = pool[i]!;
        seq[i] = l;
        const base = inp.priceAt(inp.round + 1 + i, l);
        prices[i] = Math.max(1, Math.round(base * rp.rolloutPriceMul * Math.exp(rp.rolloutSigma * this.rng.normal())));
        caps[i] = base * rp.rolloutCap;
      }
      const lose = this.play(plans, inp.rack, inp.balance, seq, prices, caps, def, defTot);
      for (let g = 0; g < GRID.length; g++) {
        const pay = Math.round(GRID[g]! * priceNow);
        if (pay > inp.balance) {
          sums[g] = Number.NEGATIVE_INFINITY;
          continue;
        }
        sums[g]! += this.play(plans, rackW, inp.balance - pay, seq, prices, caps, def, defTot) - lose;
      }
      futures++;
    }
    // Largest bid level where winning still beats losing on average,
    // interpolated between grid points.
    let bid = 0;
    for (let g = 0; g < GRID.length; g++) {
      const gain = sums[g]! / futures;
      if (gain >= 0) {
        bid = GRID[g]! * priceNow;
        const next = g + 1 < GRID.length ? sums[g + 1]! / futures : Number.NEGATIVE_INFINITY;
        if (Number.isFinite(next) && next < 0) {
          const span = (GRID[g + 1]! - GRID[g]!) * priceNow;
          bid += span * (gain / (gain - next));
        }
      } else break;
    }
    const atPrice = sums[GRID.indexOf(1.0)]! / futures;
    return { bid, gainAtPrice: atPrice, futures, plans: plans.length, ms: performance.now() - t0 };
  }
}
