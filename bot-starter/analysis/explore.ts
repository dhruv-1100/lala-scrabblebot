import { load, groupBy, mean, quantile } from "./load.js";

const matches = load("matchState").filter((m) => m.status === "Ended");
const parts = load("matchParticipant");
const bots = new Map(load("bot").map((b) => [b.id, b]));
const results = load("auctionResult");
const tops = new Map(load("auctionTopBidArchive").map((t) => [t.auctionId, t.topBid]));
const words = load("wordPlay");

const partsByMatch = groupBy(parts, (p) => p.matchId);
const resByMatch = groupBy(results, (r) => r.matchId);
const wordsByMatch = groupBy(words, (w) => w.matchId);
const isSim = (id: number) => bots.get(id)?.isSimulated ?? false;
const name = (id: number) => bots.get(id)?.name ?? `#${id}`;

// Composition of matches over time.
const ended = matches.sort((a, b) => a.id - b.id);
console.log("ended", ended.length, "first", new Date(ended[0].createdAt / 1000).toISOString(), "last", new Date(ended.at(-1).createdAt / 1000).toISOString());
const buckets = [0, 500, 1000, 1500, 2000, 2400];
for (let i = 0; i < buckets.length - 1; i++) {
  const ms = ended.filter((m) => m.id > buckets[i] && m.id <= buckets[i + 1]);
  const reals = ms.map((m) => (partsByMatch.get(m.id) ?? []).filter((p) => !isSim(p.botId)).length);
  const sizes = ms.map((m) => (partsByMatch.get(m.id) ?? []).length);
  const win = ms.map((m) => Math.max(...(partsByMatch.get(m.id) ?? []).map((p) => p.score)));
  const simWins = ms.filter((m) => { const ps = partsByMatch.get(m.id) ?? []; const top = ps.reduce((a, b) => (b.score > a.score ? b : a), ps[0]); return top && isSim(top.botId); }).length;
  console.log(`matches ${buckets[i]}-${buckets[i + 1]}: n=${ms.length} size=${mean(sizes).toFixed(2)} real=${mean(reals).toFixed(2)} winScore med=${quantile(win, 0.5)} p90=${quantile(win, 0.9)} simWins=${simWins}`);
}

// Recent window
const RECENT = Number(process.env.RECENT ?? 600);
const recent = ended.slice(-RECENT);
const recentIds = new Set(recent.map((m) => m.id));
type S = { n: number; wins: number; place: number[]; score: number[]; tiles: number[]; spent: number[]; words: number[]; wlen: number[]; finalBal: number[]; };
const st = new Map<number, S>();
for (const m of recent) {
  const ps = [...(partsByMatch.get(m.id) ?? [])].sort((a, b) => b.score - a.score);
  const rs = resByMatch.get(m.id) ?? [];
  const ws = wordsByMatch.get(m.id) ?? [];
  for (const p of ps) {
    const s = st.get(p.botId) ?? { n: 0, wins: 0, place: [], score: [], tiles: [], spent: [], words: [], wlen: [], finalBal: [] };
    st.set(p.botId, s);
    s.n++;
    const place = ps.filter((q) => q.score > p.score).length + 1;
    s.place.push(place);
    if (place === 1) s.wins++;
    s.score.push(p.score);
    s.finalBal.push(p.balance);
    const mine = rs.filter((r) => r.winnerBotId === p.botId);
    s.tiles.push(mine.length);
    s.spent.push(mine.reduce((a, r) => a + r.paid, 0));
    const mw = ws.filter((w) => w.botId === p.botId);
    s.words.push(mw.length);
    for (const w of mw) s.wlen.push(w.word.length);
  }
}
const rows = [...st.entries()].filter(([, s]) => s.n >= 15).sort((a, b) => mean(a[1].place) - mean(b[1].place));
console.log(`\nRecent ${RECENT} matches, bots with >=15 games, sorted by avg place`);
console.log("bot".padEnd(18), "n", "win%", "place", "score", "tiles", "spent", "$/tile", "words", "wlen", "finBal");
for (const [id, s] of rows) {
  console.log(name(id).slice(0, 17).padEnd(18), s.n, (100 * s.wins / s.n).toFixed(0).padStart(3), mean(s.place).toFixed(2), mean(s.score).toFixed(0).padStart(4), mean(s.tiles).toFixed(1), mean(s.spent).toFixed(0).padStart(4), (mean(s.spent) / mean(s.tiles)).toFixed(1), mean(s.words).toFixed(1), mean(s.wlen).toFixed(1), mean(s.finalBal).toFixed(0));
}

// Price by letter in recent matches
console.log("\nLetter: n, paid mean/med, topBid mean/med, value");
const byLetter = groupBy(results.filter((r) => recentIds.has(r.matchId)), (r) => r.letter);
const VAL: Record<string, number> = { A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8, K: 5, L: 1, M: 3, N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1, U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10 };
for (const L of [...byLetter.keys()].sort()) {
  const rs = byLetter.get(L)!;
  const paid = rs.map((r) => r.paid);
  const tb = rs.map((r) => tops.get(r.auctionId)).filter((x) => x !== undefined) as number[];
  console.log(L, rs.length, mean(paid).toFixed(1), quantile(paid, 0.5), mean(tb).toFixed(1), quantile(tb, 0.5), VAL[L], "unsold", rs.filter((r) => r.winnerBotId == null).length);
}
