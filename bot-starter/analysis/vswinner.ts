// Lala versus the winner of each match Lala played (from data/raw).
import { load, groupBy, mean } from "./load.js";
const ME = Number(process.env.BOT_ID ?? 88);
const parts = load("matchParticipant");
const mine = new Set(parts.filter((p) => p.botId === ME).map((p) => p.matchId));
const ended = new Set(load("matchState").filter((m) => m.status === "Ended" && mine.has(m.id)).map((m) => m.id));
const bots = new Map(load("bot").map((b) => [b.id, b.name]));
const res = groupBy(load("auctionResult").filter((r) => ended.has(r.matchId)), (r) => r.matchId);
const words = groupBy(load("wordPlay").filter((w) => ended.has(w.matchId)), (w) => w.matchId);
const pm = groupBy(parts.filter((p) => ended.has(p.matchId)), (p) => p.matchId);
type R = { score: number; tiles: number; spent: number; words: number; firstRound: number; w7: number; bal: number };
const row = (mid: number, bot: number): R => {
  const rs = (res.get(mid) ?? []).sort((a, b) => a.auctionId - b.auctionId);
  const ws = (words.get(mid) ?? []).filter((w) => w.botId === bot).sort((a, b) => a.playedAt - b.playedAt);
  const won = rs.filter((r) => r.winnerBotId === bot);
  const p = pm.get(mid)!.find((x) => x.botId === bot)!;
  return {
    score: p.score, tiles: won.length, spent: won.reduce((a, r) => a + r.paid, 0), words: ws.length,
    firstRound: ws.length ? rs.filter((r) => r.closedAt <= ws[0].playedAt).length : 68,
    w7: ws.filter((w) => w.word.length >= 7).length, bal: p.balance,
  };
};
const me: R[] = [], win: R[] = [];
const winners = new Map<string, number>();
for (const mid of ended) {
  const ps = pm.get(mid)!.sort((a, b) => b.score - a.score);
  me.push(row(mid, ME));
  if (ps[0].botId !== ME) {
    win.push(row(mid, ps[0].botId));
    const n = bots.get(ps[0].botId) ?? String(ps[0].botId);
    winners.set(n, (winners.get(n) ?? 0) + 1);
  }
}
const show = (k: string, rs: R[]) => console.log(k.padEnd(8), (Object.keys(rs[0]!) as (keyof R)[]).map((f) => `${f}=${mean(rs.map((r) => r[f])).toFixed(1)}`).join("  "));
console.log(`matches ${me.length}`);
show("Lala", me);
show("winner", win);
console.log("winners when Lala lost:", [...winners.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n}:${c}`).join(" "));
