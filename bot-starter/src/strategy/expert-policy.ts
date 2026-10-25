import { predict, type Model } from './tree-model.js';
export { predict } from './tree-model.js';
import { readFileSync } from 'node:fs';
import type { Counts } from '../engine/letters.js';
import type { Dict } from '../engine/dict.js';
import type { View } from '../sim/types.js';
import { playable, removeWord } from '../engine/words.js';
import { bidFeatures, rackSummary, wordFeatures } from './expert-features.js';
import type { Decision, LalaParams } from './lala.js';
interface Policy { bid: Model; word: Model; }
interface ModelFile { meta: { bidFeatures: number; wordFeatures: number }; models: Record<string, Policy>; }
let bundle: ModelFile | null | undefined;
function load(): ModelFile | null {
  if (bundle !== undefined) return bundle;
  try { bundle = JSON.parse(readFileSync(new URL('./expert-models.json', import.meta.url), 'utf8')); }
  catch { bundle = null; }
  return bundle!;
}

export class ExpertPolicy {
  constructor(private dict: Dict) {}
  private policy(p: LalaParams): Policy | null {
    const data = load(); if (!data) return null;
    const name = ['all', 'all', 'shark', 'bro', 'nijello', 'all', 'full'][p.expertPolicy ?? 0] ?? 'all';
    return data.models[name] ?? null;
  }
  bid(v: View, p: LalaParams): number | null {
    const policy = this.policy(p); if (!policy) return null;
    let bid = predict(policy.bid, bidFeatures(this.dict, v)) * (p.expertBidScale ?? 1) + (p.expertBidAdd ?? 0);
    if (v.auctionType === 'FirstPrice') bid *= .85;
    return Math.max(0, Math.min(v.balance, Math.floor(bid)));
  }
  act(v: View, p: LalaParams): Decision | null {
    if (p.expertWordMode === 1) return null;
    const data = load(); if (!data) return null;
    const t0 = performance.now();
    const policy = this.policy(p); if (!policy) return null;
    let rack: Counts = new Uint8Array(v.rack);
    let balance = v.balance, score = v.score;
    const words: string[] = [];
    for (let repeat = 0; repeat < 4; repeat++) {
      const seen = new Set<string>();
      const candidates = playable(this.dict, rack, 2, Infinity).filter(i => {
        const key = [...this.dict.words[i]!].sort().join('');
        if (seen.has(key)) return false; seen.add(key); return true;
      }).slice(0, 6);
      if (!candidates.length) break;
      const view = { ...v, rack, balance, score }, common = bidFeatures(this.dict, view);
      let chosen = -1, confidence = p.expertPlayThreshold ?? .5;
      for (const i of candidates) {
        const afterRack = removeWord(rack, this.dict.words[i]!);
        const after = rackSummary(this.dict, afterRack, v.letter, v.tracker.unseen, v.auctionsLeft);
        const probability = predict(policy.word, wordFeatures(this.dict, view, i, common, after));
        if (probability > confidence) { chosen = i; confidence = probability; }
      }
      if (p.expertWordMode === 2) {
        const min = v.auctionsLeft > 12 ? 7 : v.auctionsLeft > 5 ? 6 : 2;
        chosen = candidates.find(i => this.dict.len[i]! >= min) ?? -1;
      }
      if (chosen < 0) break;
      const w = this.dict.words[chosen]!;words.push(w);rack = removeWord(rack, w);
      balance += this.dict.reward[chosen]!;score += this.dict.reward[chosen]!;
    }
    const x = bidFeatures(this.dict, { ...v, rack, balance, score });
    const bid = this.bid({ ...v, rack, balance, score }, p)!;
    return { words, bid, value: x[44] ?? 0, marginal: 0, mu: 0, ms: performance.now() - t0 };
  }
}
