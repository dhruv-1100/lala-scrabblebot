// Features computed only from the player's rack and public information at
// decision time. Training labels live in separate files and never enter here.
import type { Dict } from '../engine/dict.js';
import { VALUE, VOWELS, type Counts } from '../engine/letters.js';
import type { View } from '../sim/types.js';
import { phasePrice } from './tables.js';
import { LIVE_PAID } from '../sim/agents.js';

interface Potentials { head: number[]; best: Float64Array; counts: Float64Array; base: Float64Array; baseCounts: Float64Array; }
const caches = new WeakMap<Dict, Map<string, Potentials>>();
export function rackSummary(dict: Dict, rack: Counts, letter: number, _unseen: Counts, _T: number): number[] {
  let cache = caches.get(dict);
  if (!cache) { cache = new Map(); caches.set(dict, cache); }
  const key = String.fromCharCode(...rack);
  let pot = cache.get(key);
  if (!pot) {
    let n = 0, face = 0, vowels = 0, high = 0, dup = 0, mask = 0;
    for (let k = 0; k < 26; k++) {
      n += rack[k]!; face += rack[k]! * VALUE[k]!;
      if (VOWELS.has(k)) vowels += rack[k]!;
      if (VALUE[k]! >= 4) high += rack[k]!;
      dup += Math.max(0, rack[k]! - 1);
      if (rack[k]) mask |= 1 << k;
    }
    const base = new Float64Array(8), baseCounts = new Float64Array(4);
    const best = new Float64Array(26 * 8), counts = new Float64Array(26 * 4);
    const missingLetters = new Uint8Array(26);
    const [start, end] = dict.range(2, Math.min(12, n + 4));
    for (let i = start; i < end; i++) {
      let x = dict.mask[i]! & ~mask;
      x -= (x >>> 1) & 0x55555555;
      x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
      if ((((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24 > 4) continue;
      let missing = 0, nMissing = 0;
      for (let q = dict.dOff[i]!, endQ = dict.dOff[i + 1]!; q < endQ; q++) {
        const k = dict.dl[q]!, deficit = Math.max(0, dict.dc[q]! - rack[k]!);
        missing += deficit;
        if (deficit) missingLetters[nMissing++] = k;
        if (missing > 4) break;
      }
      if (missing > 4) continue;
      const r = dict.reward[i]!, long = dict.len[i]! >= 7;
      if (missing <= 3) {
        base[missing] = Math.max(base[missing]!, r);
        if (long) base[4 + missing] = Math.max(base[4 + missing]!, r);
        baseCounts[missing]!++;
      }
      if (missing) for (let j = 0; j < nMissing; j++) {
        const k = missingLetters[j]!, m = missing - 1;
        best[k * 8 + m] = Math.max(best[k * 8 + m]!, r);
        if (long) best[k * 8 + 4 + m] = Math.max(best[k * 8 + 4 + m]!, r);
        counts[k * 4 + m]!++;
      }
    }
    pot = { head: [n, face, vowels, n ? vowels / n : 0.4, high, dup], base, baseCounts, best, counts };
    if (cache.size >= 10000) cache.delete(cache.keys().next().value!);
    cache.set(key, pot);
  }
  const after = Array.from({ length: 8 }, (_, i) => Math.max(pot!.base[i]!, pot!.best[letter * 8 + i]!));
  return [...pot.head, ...pot.base, ...after, ...pot.baseCounts.map(Math.log1p), ...pot.counts.slice(letter * 4, letter * 4 + 4).map((v, i) => Math.log1p(v + pot!.baseCounts[i]!))];
}

export function bidFeatures(dict: Dict, v: View, summary?: number[]): number[] {
  const k = v.letter;
  const prior = (round: number, letter: number) => phasePrice(round, letter) ?? LIVE_PAID[letter]!;
  let ratio = 8, observations = 8;
  let letterPaid = 0, letterN = 0;
  for (const p of v.tracker.prices) if (p.paid > 0 && p.winner !== null) {
    ratio += p.paid / prior(p.round, p.letter); observations++;
    if (p.letter === k) { letterPaid += p.paid; letterN++; }
  }
  const price = prior(v.round, k) * ratio / observations;
  return [v.auctionsLeft, v.balance, v.score, k, VALUE[k]!, VOWELS.has(k) ? 1 : 0,
    v.rack[k]!, v.tracker.unseen[k]!, v.tracker.unseenTotal(), price,
    letterN ? letterPaid / letterN : price, v.balance / Math.max(1, v.auctionsLeft),
    ...v.rack, ...(summary ?? rackSummary(dict, v.rack, k, v.tracker.unseen, v.auctionsLeft))];
}

export function wordFeatures(dict: Dict, v: View, index: number, common: number[], after: number[]): number[] {
  const counts = new Uint8Array(v.rack);
  for (let q = dict.dOff[index]!, end = dict.dOff[index + 1]!; q < end; q++) counts[dict.dl[q]!]! -= dict.dc[q]!;
  return [...common, dict.len[index]!, dict.reward[index]!, dict.base[index]!, ...counts, ...after];
}
