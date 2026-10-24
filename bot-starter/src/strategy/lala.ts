// Lala: the tournament strategy. Shared by the live bot and the simulator.
//
// Each auction: (1) play any word that beats holding its tiles, (2) bid the
// letter's marginal value converted to coins at the current shadow price of
// money (mu, points per coin). mu rises when coins are scarce relative to
// what the rest of the match will cost and falls to ~0 as the match runs
// out, because leftover coins are worth nothing.

import type { Dict } from "../engine/dict.js";
import { VALUE, VOWELS, type Counts } from "../engine/letters.js";
import { bestPartition, playable, removeWord } from "../engine/words.js";
import type { Action, Agent, View } from "../sim/types.js";
import { Valuer, type ValueParams } from "./value.js";
import { LIVE_PAID } from "../sim/agents.js";
import { Rng } from "../engine/rng.js";

export interface LalaParams extends ValueParams {
  mu0: number;        // points per coin when the budget is on track
  muAlpha: number;    // how strongly budget pressure moves mu
  muMin: number;
  muMax: number;
  share: number;      // share of remaining auctions we expect to buy
  incomeW: number;    // weight of the rack's value as future coins
  premium: number;    // bid multiplier on marginal value
  liq: number;        // bonus per point for cashing a word in early
  playMargin: number; // points a play must beat holding by
  playK: number;      // leftover value scale when deciding whether to play
  minPlayLen: number; // shortest word played before the last few auctions
  kappaT: number;     // auctions over which leftover value fades out
  kappaMin: number;
  priceN0: number;    // prior weight (in observations) on the price table
  shadeSigma: number; // first-price: spread of the rival-max distribution
  vowelBal: number;   // extra value for a vowel on a vowel-poor rack (or a consonant on a vowel-rich one)
  capMul: number;     // never bid more than capMul x the going price, except in the last 3 auctions
  lateN: number;      // the last lateN auctions use mu * lateMu (rivals keep a reserve for them)
  lateMu: number;
  bidNoise: number;   // lognormal noise on bids (0 for the real bot; used to diversify sim rivals)
  seed: number;
}

export const DEFAULT_LALA: LalaParams = {
  winP: 0.6, maxMissing: 3, rho: 1.0, kappa0: 2.5, kappa1: 0.5, dupDecay: 0.6, minLen: 2, maxLen: 8,
  mu0: 0.25, muAlpha: 1.0, muMin: 0.05, muMax: 1.5, share: 0.2, incomeW: 0.7,
  premium: 1.0, liq: 0.1, playMargin: 0, playK: 1, minPlayLen: 2, kappaT: 15, kappaMin: 0.3,
  priceN0: 8, shadeSigma: 0.35, vowelBal: 0, capMul: 99, lateN: 12, lateMu: 1, bidNoise: 0, seed: 1,
};

export interface Decision extends Action {
  value: number;
  marginal: number;
  mu: number;
  ms: number;
}

export class Lala implements Agent {
  readonly name: string;
  readonly p: LalaParams;
  private valuer: Valuer;
  private rng: Rng;
  last?: Decision;

  constructor(private dict: Dict, params: Partial<LalaParams> = {}, name = "Lala") {
    this.p = { ...DEFAULT_LALA, ...params };
    this.valuer = new Valuer(dict);
    this.rng = new Rng(this.p.seed);
    this.name = name;
  }

  // Expected coins per letter: the live price table scaled by how this
  // match's prices compare with it so far.
  prices(v: View): Float64Array {
    let sum = 0;
    let n = 0;
    for (const o of v.tracker.prices) {
      if (o.winner === null || o.paid <= 0) continue;
      sum += o.paid / LIVE_PAID[o.letter]!;
      n++;
    }
    const scale = (sum + this.p.priceN0) / (n + this.p.priceN0);
    const out = new Float64Array(26);
    for (let k = 0; k < 26; k++) out[k] = Math.max(1, LIVE_PAID[k]! * scale);
    return out;
  }

  private mu(v: View, balance: number, rackValue: number, prices: Float64Array, futureDraws: number): number {
    const unseen = v.tracker.unseen;
    let tot = 0;
    let avg = 0;
    for (let k = 0; k < 26; k++) {
      tot += unseen[k]!;
      avg += unseen[k]! * prices[k]!;
    }
    avg = tot > 0 ? avg / tot : 10;
    const need = (futureDraws + 1) * this.p.share * avg;
    const have = Math.max(1, balance + this.p.incomeW * Math.max(0, rackValue));
    let m = this.p.mu0 * Math.pow(need / have, this.p.muAlpha);
    if (futureDraws + 2 <= this.p.lateN) m *= this.p.lateMu;
    return Math.min(this.p.muMax, Math.max(this.p.muMin, m));
  }

  private kappaScale(futureDraws: number): number {
    return Math.max(this.p.kappaMin, Math.min(1, futureDraws / this.p.kappaT));
  }

  act(v: View): Decision {
    const t0 = performance.now();
    const p = this.p;
    const T = v.auctionsLeft;
    let rack: Counts = new Uint8Array(v.rack);
    let balance = v.balance;
    const words: string[] = [];

    // The final auction: its tile can never be played. Cash out everything.
    if (T <= 1) {
      const part = bestPartition(this.dict, rack, 2, 60);
      return { words: part.words, bid: 0, value: part.reward, marginal: 0, mu: 0, ms: performance.now() - t0 };
    }

    // Second to last: a tile won now can still be played in the final
    // window, and coins are worth nothing after it. Bid everything on any
    // letter that improves the cash-out.
    if (T === 2) {
      const now = bestPartition(this.dict, rack, 2, 30);
      const plus = new Uint8Array(rack);
      plus[v.letter]!++;
      const withL = bestPartition(this.dict, plus, 2, 30);
      const gain = withL.reward - now.reward;
      const bid = gain > 0 ? balance : 0;
      // Words in both plans are safe to play now, leaving less to do in the
      // final one-second window.
      const rest = [...withL.words];
      const safe: string[] = [];
      for (const w of now.words) {
        const j = rest.indexOf(w);
        if (j >= 0) {
          safe.push(w);
          rest.splice(j, 1);
        }
      }
      return { words: safe, bid, value: now.reward, marginal: gain, mu: 0, ms: performance.now() - t0 };
    }

    const futureDraws = Math.max(0, T - 2);
    const prices = this.prices(v);
    const ks = this.kappaScale(futureDraws);
    const evalRack = (r: Counts, mu: number, kMul = 1) =>
      this.valuer.evaluate(r, v.letter, v.tracker.unseen, futureDraws, prices, mu, p, ks, kMul);

    // Word plays: take a word whenever cashing it beats holding its tiles.
    let mu = this.mu(v, balance, 0, prices, futureDraws);
    // Held tiles are valued with playK so the leftover estimate (tuned for
    // bidding) doesn't stop us cashing in words we already have.
    let hold = evalRack(rack, mu, p.playK);
    for (let iter = 0; iter < 4; iter++) {
      const cands = playable(this.dict, rack, futureDraws <= 3 ? 2 : p.minPlayLen, 8);
      if (!cands.length) break;
      const phi = futureDraws / 60;
      // A tie goes to playing: same points, but the coins arrive sooner.
      let bestGain = p.playMargin - 1e-6;
      let bestIdx = -1;
      let bestAfter = hold;
      for (const i of cands) {
        // Holding never loses value by having more tiles, so a play gains
        // at most its own reward: stop once that can't beat the best.
        if (this.dict.reward[i]! * (1 + p.liq * mu * phi) <= bestGain) break;
        const w = this.dict.words[i]!;
        const after = evalRack(removeWord(rack, w), mu, p.playK);
        // Coins from a play are worth more the scarcer coins are (mu) and
        // the more auctions are left to spend them in (phi).
        const gain = this.dict.reward[i]! * (1 + p.liq * mu * phi) + after.base - hold.base;
        if (gain > bestGain) {
          bestGain = gain;
          bestIdx = i;
          bestAfter = after;
        }
      }
      if (bestIdx < 0) break;
      const w = this.dict.words[bestIdx]!;
      words.push(w);
      rack = removeWord(rack, w);
      balance += this.dict.reward[bestIdx]!;
      hold = bestAfter;
    }

    mu = this.mu(v, balance, hold.base, prices, futureDraws);
    const val = evalRack(rack, mu);
    let marginal = Math.max(0, val.withLetter - val.base);
    if (p.vowelBal > 0) marginal *= this.balanceFactor(rack, v.letter);
    let bid = (marginal / mu) * p.premium;
    if (T > 3) bid = Math.min(bid, p.capMul * prices[v.letter]!);
    if (p.bidNoise > 0) bid *= Math.exp(p.bidNoise * this.rng.normal());
    if (v.auctionType === "FirstPrice") bid = this.shade(bid, prices[v.letter]!);
    bid = Math.max(0, Math.min(balance, Math.floor(bid)));
    return { words, bid, value: val.base, marginal, mu, ms: performance.now() - t0 };
  }

  // A vowel is worth more to a rack starved of vowels, a consonant to one
  // drowning in them; 7-letter words need roughly 3 vowels to 4 consonants.
  private balanceFactor(rack: Counts, letter: number): number {
    let tiles = 0;
    let vowels = 0;
    for (let k = 0; k < 26; k++) {
      tiles += rack[k]!;
      if (VOWELS.has(k)) vowels += rack[k]!;
    }
    if (tiles < 3) return 1;
    const frac = vowels / tiles;
    const isVowel = VOWELS.has(letter);
    const want = isVowel ? 0.4 - frac : frac - 0.45;
    return Math.max(0.5, 1 + this.p.vowelBal * want * 2.5);
  }

  // First-price: pick the bid maximising (value - bid) * P(rival max < bid),
  // the rival max modelled as lognormal around the going price.
  private shade(value: number, price: number): number {
    const s = this.p.shadeSigma;
    const mu = Math.log(Math.max(1, price * 1.25));
    let best = 0;
    let bestU = 0;
    for (let b = 1; b <= value; b++) {
      const z = (Math.log(b) - mu) / s;
      const F = 0.5 * (1 + erf(z / Math.SQRT2));
      const u = (value - b) * F;
      if (u > bestU) {
        bestU = u;
        best = b;
      }
    }
    return best;
  }
}

function erf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

void VALUE;
