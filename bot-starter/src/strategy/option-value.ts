// Stochastic recourse valuation. All candidate plans see the same sampled
// future auctions. We average the best feasible plan in each world, including
// the option to retain the rack, rather than selecting one word in advance.
// The worlds are a model of availability, never actual future server draws.
import type { Dict } from '../engine/dict.js';
import { VALUE, VOWELS } from '../engine/letters.js';
import { Rng } from '../engine/rng.js';
import { leaveValue } from './tables.js';
import { USEFUL, LIVE_USE, type ValueParams, type Valuation } from './value.js';

export class OptionValuer {
  private sampleKey = '';
  private available = new Int32Array(26 * 8);
  constructor(private dict: Dict) {}

  private prepare(unseen: Uint8Array, draws: number, winP: number): void {
    const key = `${draws}/${winP}/${String.fromCharCode(...unseen)}`;
    if (key === this.sampleKey) return;
    this.sampleKey = key;
    this.available.fill(0);
    const bag: number[] = [];
    for (let k = 0; k < 26; k++) {
      this.available[k * 8] = -1;
      for (let j = 0; j < unseen[k]!; j++) bag.push(k);
    }
    // Fixed seed gives paired worlds for every candidate action in a turn.
    const rng = new Rng(0x15f02026);
    const n = Math.min(bag.length, Math.max(0, draws));
    for (let world = 0; world < 32; world++) {
      const pool = [...bag];
      const have = new Uint8Array(26);
      for (let j = 0; j < n; j++) {
        const ix = rng.int(j, pool.length - 1);
        [pool[j], pool[ix]] = [pool[ix]!, pool[j]!];
        if (rng.next() < winP) have[pool[j]!]!++;
      }
      for (let k = 0; k < 26; k++) {
        for (let copies = 1; copies <= Math.min(7, have[k]!); copies++) this.available[k * 8 + copies]! |= 1 << world;
      }
    }
  }

  evaluate(rack: Uint8Array, letter: number, unseen: Uint8Array, draws: number,
    prices: ArrayLike<number>, mu: number, p: ValueParams, ks: number, kMul = 1): Valuation {
    this.prepare(unseen, draws, p.winP);
    const cumulative = new Float64Array(26 * 16);
    const ck = (k: number, copies: number) => cumulative[k * 16 + Math.min(15, copies)]!;
    let tiles = 0, mask = 0, leave = 0;
    for (let k = 0; k < 26; k++) {
      const use = p.liveUse ? LIVE_USE[k]! : p.vowelUse > 0 && VOWELS.has(k) ? p.vowelUse : Math.min(1.6, USEFUL[k]!);
      let one = kMul * (ks * p.kappa0 * use + p.kappa1 * VALUE[k]!);
      const decay = VOWELS.has(k) ? p.dupDecay : p.dupDecay * 0.85;
      let total = 0;
      for (let j = 1; j < 16; j++) {
        total += one; one *= decay;
        const learned = Math.max(0, leaveValue(draws + 2, k, j, p.leaveLive)) * p.leaveScale * kMul;
        cumulative[k * 16 + j] = p.leaveW > 0 ? (1 - p.leaveW) * total + p.leaveW * learned : total;
      }
      tiles += rack[k]!; leave += ck(k, rack[k]!);
      if (rack[k]) mask |= 1 << k;
    }
    const extra = ck(letter, rack[letter]! + 1) - ck(letter, rack[letter]!);
    const sz = (n: number) => p.leaveCapN > 0 && n > p.leaveCapN ? p.leaveCapN / n : 1;
    const base = new Float64Array(32).fill(leave * sz(tiles));
    const plus = new Float64Array(32).fill((leave + extra) * sz(tiles + 1));
    const d = this.dict, available = this.available;
    const missingLimit = Math.min(p.maxMissing, draws);
    const [start, end] = d.range(p.minLen, Math.min(p.maxLen, tiles + 1 + missingLimit));
    const update = (values: Float64Array, worlds: number, value: number) => {
      while (worlds) {
        const low = worlds & -worlds;
        const w = 31 - Math.clz32(low);
        if (value > values[w]!) values[w] = value;
        worlds ^= low;
      }
    };
    for (let i = start; i < end; i++) {
      let absent = d.mask[i]! & ~(mask | (1 << letter));
      absent -= (absent >>> 1) & 0x55555555;
      absent = (absent & 0x33333333) + ((absent >>> 2) & 0x33333333);
      if ((((absent + (absent >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24 > missingLimit) continue;
      let missing = 0, missingLetter = 0, worlds = -1, other = -1;
      let cost = 0, used = 0, usedTiles = 0, letterLeft = rack[letter]!;
      let q = d.dOff[i]!, endQ = d.dOff[i + 1]!;
      for (; q < endQ; q++) {
        const k = d.dl[q]!, need = d.dc[q]!, have = rack[k]!;
        const deficit = Math.max(0, need - have);
        missing += deficit;
        if (missing > missingLimit + 1 || deficit > 7) break;
        const chance = available[k * 8 + deficit]!;
        worlds &= chance;
        if (k !== letter) other &= chance;
        else { missingLetter = deficit; letterLeft = Math.max(0, have - need); }
        cost += deficit * mu * p.rho * prices[k]!;
        usedTiles += Math.min(have, need);
        used += ck(k, have) - ck(k, Math.max(0, have - need));
      }
      if (q < endQ) continue;
      const left = tiles - usedTiles;
      const reward = d.reward[i]!;
      if (missing <= missingLimit) {
        update(base, worlds, reward - cost + (leave - used) * sz(left));
        if (!missingLetter) {
          const afterExtra = ck(letter, letterLeft + 1) - ck(letter, letterLeft);
          update(plus, worlds, reward - cost + (leave - used + afterExtra) * sz(left + 1));
        }
      }
      if (missingLetter && missing - 1 <= missingLimit) {
        const withWorlds = other & available[letter * 8 + missingLetter - 1]!;
        update(plus, withWorlds, reward - cost + mu * p.rho * prices[letter]! + (leave - used) * sz(left));
      }
    }
    let b = 0, a = 0;
    for (let j = 0; j < 32; j++) { b += base[j]!; a += plus[j]!; }
    return { base: b / 32, withLetter: Math.max(b / 32, a / 32), bestWord: -1 };
  }
}
