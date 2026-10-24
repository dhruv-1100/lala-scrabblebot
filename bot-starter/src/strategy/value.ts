// Rack valuation: what a rack is worth in end-of-match points, counting
// words it can still grow into.
//
// For every dictionary word W the rack could complete, the plan value is
//   P(complete) * reward(W) - mu * rho * (coins to buy the missing letters)
//   + kappa * (tiles left over after W)
// where P(complete) multiplies, per missing letter, the chance it turns up
// in the auctions still to come and that we win it. The rack's value is the
// best plan. One scan also yields the value of the rack plus one extra
// letter, which is what an auction for that letter is worth to us.

import type { Dict } from "../engine/dict.js";
import { VALUE, VOWELS } from "../engine/letters.js";

// How much more often each letter appears in 7-8 letter dictionary words
// than in the bag (scripts/usefulness.ts). S and C are worth hoarding; Q,
// J, X and Z rarely fit a long word.
export const USEFUL: readonly number[] = [
  0.85, 1.08, 1.82, 0.99, 0.97, 0.71, 1, 1.15, 0.87, 0.2, 1.24, 1.38, 1.36, 0.99, 0.73, 1.41, 0.18, 1.2, 2.28, 0.97, 0.88, 0.46, 0.53, 0.29, 0.77, 0.4,
];

export interface ValueParams {
  winP: number;        // chance we win a letter we go after
  maxMissing: number;  // ignore plans missing more letters than this
  rho: number;         // weight on the coin cost of missing letters
  kappa0: number;      // leftover tile value in points:
  kappa1: number;      //   kappaScale * kappa0 * usefulness + kappa1 * letter value
  dupDecay: number;    // each extra copy of a letter is worth this much less
  minLen: number;      // shortest target word considered
  maxLen: number;
}

export interface Valuation {
  base: number;        // value of the rack as is
  withLetter: number;  // value with one more `letter`
  bestWord: number;    // dictionary index of the plan behind `base`, or -1
}

// P(Poisson(lam) >= d) for d = 0..5.
function poissonTail(lam: number, out: Float64Array): void {
  let term = Math.exp(-lam);
  let cdf = 0;
  out[0] = 1;
  for (let d = 1; d <= 5; d++) {
    cdf += term;
    out[d] = Math.max(0, 1 - cdf);
    term *= lam / d;
  }
}

export class Valuer {
  private pObt = new Float64Array(26 * 6);
  private tail = new Float64Array(6);
  // cumK[k*8 + j]: leftover value of holding j copies of letter k.
  private cumK = new Float64Array(26 * 8);
  private costW = new Float64Array(26);

  constructor(private dict: Dict) {}

  // unseen: tiles we can't see; futureDraws: auctions after this one whose
  // tiles could still be played; prices: expected coins per letter.
  evaluate(
    rack: Uint8Array, letter: number, unseen: Uint8Array, futureDraws: number,
    prices: ArrayLike<number>, mu: number, p: ValueParams, kappaScale: number, kMul = 1,
  ): Valuation {
    const d = this.dict;
    let unseenTotal = 0;
    for (let k = 0; k < 26; k++) unseenTotal += unseen[k]!;
    for (let k = 0; k < 26; k++) {
      const lam = unseenTotal > 0 ? (futureDraws * unseen[k]! * p.winP) / unseenTotal : 0;
      poissonTail(lam, this.tail);
      for (let j = 0; j < 6; j++) this.pObt[k * 6 + j] = this.tail[j]!;
      const one = kMul * (kappaScale * p.kappa0 * Math.min(1.6, USEFUL[k]!) + p.kappa1 * VALUE[k]!);
      const decay = VOWELS.has(k) ? p.dupDecay : p.dupDecay * 0.85;
      let c = 0;
      let x = one;
      this.cumK[k * 8] = 0;
      for (let j = 1; j < 8; j++) {
        c += x;
        x *= decay;
        this.cumK[k * 8 + j] = c;
      }
      this.costW[k] = mu * p.rho * prices[k]!;
    }
    const cumK = this.cumK;
    const ck = (k: number, j: number) => cumK[k * 8 + (j > 7 ? 7 : j)]!;
    let rackTiles = 0;
    let rackKappa = 0;
    let rackMask = 0;
    for (let k = 0; k < 26; k++) {
      rackTiles += rack[k]!;
      rackKappa += ck(k, rack[k]!);
      if (rack[k]) rackMask |= 1 << k;
    }
    // Value of one more `letter` kept as a leftover.
    const kNext = ck(letter, rack[letter]! + 1) - ck(letter, rack[letter]!);
    const notRack = ~(rackMask | (1 << letter));
    const maxMissing = Math.min(p.maxMissing, futureDraws);
    const [s, e] = d.range(p.minLen, Math.min(p.maxLen, rackTiles + 1 + maxMissing));
    let best0 = rackKappa; // keeping every tile as a leftover
    let bestL = rackKappa + kNext;
    let bestWord = -1;
    const dOff = d.dOff, dl = d.dl, dc = d.dc, reward = d.reward, pObt = this.pObt, mask = d.mask;
    const limit = maxMissing + 1;
    const costW = this.costW;

    for (let i = s; i < e; i++) {
      // Distinct letters we hold none of bound the deficit from below.
      let x = mask[i]! & notRack;
      if (x) {
        x = x - ((x >>> 1) & 0x55555555);
        x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
        if ((((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24 > limit - 1) continue;
      }
      let missing = 0;
      let prob = 1;
      let cost = 0;
      let used = 0; // kappa of rack tiles the word uses
      let defL = 0; // how many `letter` the word still lacks
      const pe = dOff[i + 1]!;
      let q = dOff[i]!;
      for (; q < pe; q++) {
        const k = dl[q]!;
        const need = dc[q]!;
        const have = rack[k]!;
        if (need > have) {
          const def = need - have;
          missing += def;
          if (missing > maxMissing + 1) break;
          prob *= pObt[k * 6 + (def > 5 ? 5 : def)]!;
          cost += def * costW[k]!;
          used += cumK[k * 8 + (have > 7 ? 7 : have)]!;
          if (k === letter) defL = def;
        } else {
          used += cumK[k * 8 + (need > 7 ? 7 : need)]!;
        }
      }
      if (q < pe) continue; // too many missing
      const r = reward[i]!;
      // Plan with the rack as is.
      if (missing <= maxMissing) {
        const v = prob * r - cost + rackKappa - used;
        if (v > best0) {
          best0 = v;
          bestWord = i;
        }
        if (defL === 0) {
          const vL = v + kNext;
          if (vL > bestL) bestL = vL;
        }
      }
      // Plan with one more `letter` on the rack.
      if (defL > 0 && missing - 1 <= maxMissing) {
        const pk = pObt[letter * 6 + (defL > 5 ? 5 : defL)]!;
        const pk1 = pObt[letter * 6 + (defL - 1 > 5 ? 5 : defL - 1)]!;
        const probL = pk > 0 ? (prob / pk) * pk1 : 0;
        const vL = probL * r - (cost - costW[letter]!) + rackKappa - used;
        if (vL > bestL) bestL = vL;
      }
    }
    return { base: best0, withLetter: Math.max(bestL, best0 + kNext), bestWord };
  }
}
