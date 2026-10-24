import { load, groupBy, mean, quantile } from "./load.js";
const matches = load("matchState").filter((m) => m.status === "Ended").sort((a, b) => a.id - b.id);
const recent = matches.slice(-600);
const ids = new Set(recent.map((m) => m.id));
const bots = new Map(load("bot").map((b) => [b.id, b]));
const results = load("auctionResult").filter((r) => ids.has(r.matchId));
const auctions = new Map(load("auction").filter((a) => ids.has(a.matchId)).map((a) => [a.id, a]));
const tops = new Map(load("auctionTopBidArchive").map((t) => [t.auctionId, t.topBid]));
const words = load("wordPlay").filter((w) => ids.has(w.matchId));
const parts = load("matchParticipant").filter((p) => ids.has(p.matchId));
const resByMatch = groupBy(results, (r) => r.matchId);
const VAL: Record<string, number> = { A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8, K: 5, L: 1, M: 3, N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1, U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10 };

// Round index for each auction in its match.
const roundOf = new Map<number, number>();
const nRounds = new Map<number, number>();
for (const [mid, rs] of resByMatch) {
  rs.sort((a, b) => a.auctionId - b.auctionId);
  rs.forEach((r, i) => roundOf.set(r.auctionId, i + 1));
  nRounds.set(mid, rs.length);
}
console.log("rounds per match", quantile([...nRounds.values()], 0.5));
// Price of 1-pt letters by round bucket
const b = (r: number) => Math.min(13, Math.floor((r - 1) / 5));
const one = groupBy(results.filter((r) => VAL[r.letter] === 1), (r) => b(roundOf.get(r.auctionId)!));
console.log("1-pt price by round bucket (5 rounds each): paid mean | top mean | unsold");
for (const k of [...one.keys()].sort((x, y) => x - y)) {
  const rs = one.get(k)!;
  console.log(`r${k * 5 + 1}-${k * 5 + 5}`, mean(rs.map((r) => r.paid)).toFixed(1), mean(rs.map((r) => tops.get(r.auctionId) ?? 0)).toFixed(1), rs.filter((r) => r.winnerBotId == null).length);
}
// Last 5 rounds detail
for (let back = 5; back >= 1; back--) {
  const rs = results.filter((r) => roundOf.get(r.auctionId) === nRounds.get(r.matchId)! - back + 1);
  console.log(`last-${back}`, "paid", mean(rs.map((r) => r.paid)).toFixed(1), "top", mean(rs.map((r) => tops.get(r.auctionId) ?? 0)).toFixed(1), "unsold", rs.filter((r) => r.winnerBotId == null).length, "of", rs.length);
}

// Word timing: map word playedAt to round (count of results closed before)
const wordRound: number[] = [];
const wordsLate: Record<string, number> = {};
for (const w of words) {
  const rs = resByMatch.get(w.matchId)!;
  const k = rs.filter((r) => r.closedAt <= w.playedAt).length;
  wordRound.push(k);
}
const wb = groupBy(words.map((w, i) => ({ w, r: wordRound[i]! })), (x) => Math.min(13, Math.floor(x.r / 5)));
console.log("\nwords by rounds-closed bucket: count, mean len, mean reward");
for (const k of [...wb.keys()].sort((x, y) => x - y)) {
  const xs = wb.get(k)!;
  console.log(`r${k * 5}-${k * 5 + 4}`, xs.length, mean(xs.map((x) => x.w.word.length)).toFixed(1), mean(xs.map((x) => x.w.totalReward)).toFixed(1));
}
const lens = groupBy(words, (w) => Math.min(9, w.word.length));
console.log("len dist", [...lens.entries()].sort((a, b) => a[0] - b[0]).map(([l, xs]) => `${l}:${xs.length}(${mean(xs.map(x => x.totalReward)).toFixed(0)})`).join(" "));

// Unplayed tiles at end: tiles held (5 dealt + won) minus letters played
let unplayed: number[] = [];
const wordsBy = groupBy(words, (w) => `${w.matchId}:${w.botId}`);
for (const p of parts) {
  const won = (resByMatch.get(p.matchId) ?? []).filter((r) => r.winnerBotId === p.botId).length;
  const used = (wordsBy.get(`${p.matchId}:${p.botId}`) ?? []).reduce((a, w) => a + w.word.length, 0);
  unplayed.push(5 + won - used);
}
console.log("unplayed tiles at end: mean", mean(unplayed).toFixed(2), "p50", quantile(unplayed, 0.5), "p90", quantile(unplayed, 0.9));
// Winner score vs second
const pbm = groupBy(parts, (p) => p.matchId);
const gaps = [...pbm.values()].map((ps) => { const s = ps.map((p) => p.score).sort((a, b) => b - a); return s[0] - s[1]; });
console.log("win margin p25/p50/p75", quantile(gaps, 0.25), quantile(gaps, 0.5), quantile(gaps, 0.75));
const all = [...pbm.values()].map((ps) => ps.map((p) => p.score).sort((a, b) => b - a));
for (let i = 0; i < 6; i++) console.log(`place ${i + 1} score mean`, mean(all.map((s) => s[i] ?? 0)).toFixed(1));
