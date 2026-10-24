// The parameter set the live bot plays with. Arena-tuned; see ANALYSIS.md.
import type { LalaParams } from "./lala.js";

export const TUNED: Partial<LalaParams> = {
  mu0: 0.3, muAlpha: 0.6, kappa0: 3.5, winP: 0.9, dupDecay: 0.8, kappa1: 1, maxMissing: 2,
  liq: 0, share: 0.2, incomeW: 0.3, rho: 0.6,
  // v1.1: keep a reserve for the last 12 auctions and never pay more than
  // 1.6x the going price before the last 3 (paired sim vs live-like rivals,
  // n=1000: place -0.148 +/- 0.053).
  lateMu: 0.6, capMul: 1.6,
};

// Simulated stand-in for strong live entrants (calibrated in ANALYSIS.md):
// they cash 7-letter words as soon as they have them and bid with noise.
export const LIVELIKE: Partial<LalaParams> = {
  playK: 0.3, minPlayLen: 7, liq: 0.5, bidNoise: 0.25, lateMu: 0.6, mu0: 0.34,
};
