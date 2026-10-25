// Live strategy selection that learns from Lala's own games: Thompson
// sampling over a few strategy arms. Each match plays one arm; its finish is
// scored in rating terms (1st = +1 ... 6th = -1.74, OpenSkill with equal
// ratings) and the arm's estimate updates. Arms that do better get more
// matches; weak arms still get the occasional match while their estimate is
// uncertain. State is saved to disk so learning survives restarts.

import * as fs from "node:fs";

export const PLACE_UTIL = [1, 0.76, 0.46, 0.06, -0.54, -1.74];

export interface ArmPrior {
  name: string;
  n: number;      // games' worth of weight (capped so the field can change our mind)
  mean: number;   // prior rating value per game
}

interface ArmStats {
  n: number;
  sum: number;
  sumSq: number;
}

interface State {
  arms: Record<string, ArmStats>;
  assigned: Record<string, string>; // match id -> arm, so a restart mid-match keeps the arm
  history: { match: string; arm: string; place: number; u: number; t: string }[];
}

// Spread of a single game's rating value (measured: 0.6-0.8).
const GAME_SD = 0.7;

function normal(): number {
  const u = Math.max(1e-12, Math.random());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}

export class Bandit {
  private state: State;

  constructor(private file: string, priors: ArmPrior[]) {
    let loaded: State | null = null;
    try {
      loaded = JSON.parse(fs.readFileSync(file, "utf8")) as State;
    } catch {
      loaded = null;
    }
    this.state = loaded ?? { arms: {}, assigned: {}, history: [] };
    for (const p of priors) {
      if (!this.state.arms[p.name]) {
        this.state.arms[p.name] = { n: p.n, sum: p.n * p.mean, sumSq: p.n * (p.mean * p.mean + GAME_SD * GAME_SD) };
      }
    }
    // Arms no longer configured are ignored when choosing.
    this.names = priors.map((p) => p.name);
  }

  private names: string[];

  // The arm for a match: the saved one, or a Thompson draw.
  armFor(matchId: bigint): string {
    const key = String(matchId);
    const saved = this.state.assigned[key];
    if (saved && this.names.includes(saved)) return saved;
    let best = this.names[0]!;
    let bestDraw = Number.NEGATIVE_INFINITY;
    for (const name of this.names) {
      const s = this.state.arms[name]!;
      const draw = s.sum / s.n + (GAME_SD / Math.sqrt(s.n)) * normal();
      if (draw > bestDraw) {
        bestDraw = draw;
        best = name;
      }
    }
    this.state.assigned[key] = best;
    const keys = Object.keys(this.state.assigned);
    if (keys.length > 200) for (const k of keys.slice(0, keys.length - 200)) delete this.state.assigned[k];
    this.save();
    return best;
  }

  // Record a finished match. Ignores matches it never assigned.
  record(matchId: bigint, place: number): { arm: string; u: number } | null {
    const key = String(matchId);
    const arm = this.state.assigned[key];
    if (!arm || !this.state.arms[arm] || this.state.history.some((h) => h.match === key)) return null;
    const u = PLACE_UTIL[place - 1] ?? PLACE_UTIL[5]!;
    const s = this.state.arms[arm]!;
    s.n += 1;
    s.sum += u;
    s.sumSq += u * u;
    this.state.history.push({ match: key, arm, place, u, t: new Date().toISOString() });
    if (this.state.history.length > 2000) this.state.history.splice(0, this.state.history.length - 2000);
    this.save();
    return { arm, u };
  }

  summary(): string {
    return this.names
      .map((name) => {
        const s = this.state.arms[name]!;
        const live = this.state.history.filter((h) => h.arm === name);
        return `${name}: est ${(s.sum / s.n).toFixed(2)} (${live.length} live games${live.length ? `, avg place ${(live.reduce((a, h) => a + h.place, 0) / live.length).toFixed(2)}` : ""})`;
      })
      .join(" | ");
  }

  private save(): void {
    try {
      fs.writeFileSync(this.file + ".tmp", JSON.stringify(this.state));
      fs.renameSync(this.file + ".tmp", this.file);
    } catch {
      /* disk full: keep learning in memory */
    }
  }
}
