// The parameter set the live bot plays with. Arena-tuned; see ANALYSIS.md.
import type { LalaParams } from "./lala.js";

export const TUNED: Partial<LalaParams> = {
  mu0: 0.3, muAlpha: 0.6, kappa0: 3.5, winP: 0.9, dupDecay: 0.8, kappa1: 1, maxMissing: 2,
  liq: 0, share: 0.2, incomeW: 0.3, rho: 0.6,
  // v1.1: keep a reserve for the last 12 auctions and never pay more than
  // 1.6x the going price before the last 3 (paired sim vs live-like rivals,
  // n=1000: place -0.148 +/- 0.053).
  lateMu: 0.6, capMul: 1.6,
  // v2.0a: vowels valued like 1-point consonants (v1 bought 30% vowels vs
  // 37-44% for the top bots) and a price prior that follows the live stage
  // curve (high-value letters get cheaper late).
  vowelUse: 1.0, phasePrices: 1,
  // v2.0: leftover tile values learned from 218k simulated positions
  // (scripts/train-leave.ts); vowels come out worth more than 1-point
  // consonants. Paired check vs v1.1 (market, n=1000): win +4.6 pts.
  leaveW: 1, leaveScale: 0.7,
};

// Simulated stand-in for strong live entrants (calibrated in ANALYSIS.md):
// they cash 7-letter words as soon as they have them and bid with noise.
export const LIVELIKE: Partial<LalaParams> = {
  playK: 0.3, minPlayLen: 7, liq: 0.5, bidNoise: 0.25, lateMu: 0.6, mu0: 0.34,
};

// v2 rival pool, one style per profiled live bot (analysis/topbots.ts, last
// 900 matches). All value letters with LIVE_USE, so they buy vowels at the
// live rate (~42%) instead of v1's 30%.
const RIVAL_BASE: Partial<LalaParams> = { ...LIVELIKE, liveUse: 1, kappa0: 3.5, kappa1: 0.6, mu0: 0.31 };
export const RIVAL_STYLES: Partial<LalaParams>[] = [
  // Lambi Lambiii: first word ~round 19, heavy early spend, ends near 0 coins.
  { ...RIVAL_BASE, premium: 1.15, minPlayLen: 6, playK: 0.25, lateMu: 0.7 },
  // Chinese Dante: cashes 7-letter words fast, spends early-mid.
  { ...RIVAL_BASE, premium: 1.05, minPlayLen: 7, playK: 0.3 },
  // Nijello: patient, first word ~round 42, spends late.
  { ...RIVAL_BASE, premium: 0.95, minPlayLen: 7, playK: 0.7, lateMu: 0.45 },
  // postturing: buys the most tiles (14/match).
  { ...RIVAL_BASE, premium: 1.1, share: 0.27, minPlayLen: 7, playK: 0.4 },
  // A typical mid-table entrant.
  { ...RIVAL_BASE, premium: 1.0, bidNoise: 0.35 },
];
