// The parameter set the live bot plays with. Arena-tuned; see ANALYSIS.md.
import type { LalaParams } from "./lala.js";

export const TUNED: Partial<LalaParams> = {
  mu0: 0.3, muAlpha: 0.6, kappa0: 3.5, winP: 0.9, dupDecay: 0.8, kappa1: 1, maxMissing: 2,
  liq: 0, share: 0.2, incomeW: 0.3, rho: 0.6,
};
