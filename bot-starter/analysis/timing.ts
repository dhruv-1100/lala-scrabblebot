// When do winners score, and how do they finish? Word timing by match phase.
import { load, groupBy, mean } from "./load.js";
const matches = load("matchState").filter((m) => m.status === "Ended").sort((a, b) => a.id - b.id).slice(-600);
const ids = new Set(matches.map((m) => m.id));
const results = load("auctionResult").filter((r) => ids.has(r.matchId));
const words = load("wordPlay").filter((w) => ids.has(w.matchId));
const parts = load("matchParticipant").filter((p) => ids.has(p.matchId));
const resBy = groupBy(results, (r) => r.matchId);
const wordsBy = groupBy(words, (w) => `${w.matchId}:${w.botId}`);
const phase = (k: number) => (k < 34 ? "early(0-33)" : k < 60 ? "mid(34-59)" : k < 67 ? "late(60-66)" : "final(67)");
const acc: Record<string, Record<string, number[]>> = {};
for (const m of matches) {
  const ps = parts.filter((p) => p.matchId === m.id).sort((a, b) => b.score - a.score);
  const rs = (resBy.get(m.id) ?? []).sort((a, b) => a.auctionId - b.auctionId);
  ps.forEach((p, i) => {
    const grp = i === 0 ? "winner" : i === 5 ? "last" : "middle";
    const by: Record<string, number> = { "early(0-33)": 0, "mid(34-59)": 0, "late(60-66)": 0, "final(67)": 0 };
    for (const w of wordsBy.get(`${m.id}:${p.botId}`) ?? []) {
      const k = rs.filter((r) => r.closedAt <= w.playedAt).length;
      by[phase(k)] += w.totalReward;
    }
    acc[grp] ??= {};
    for (const [k, v] of Object.entries(by)) (acc[grp][k] ??= []).push(v);
  });
}
console.log("Average points scored per phase (rounds closed when the word was played)");
for (const g of ["winner", "middle", "last"]) console.log(g.padEnd(7), Object.entries(acc[g]!).map(([k, v]) => `${k}=${mean(v).toFixed(1)}`).join("  "));
