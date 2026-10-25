// Phase-by-phase profile of a bot vs Lala: spending, coins on hand, tiles,
// bid levels and word timing per stage of the match.
//   npx tsx analysis/study.ts <botId> [games=150]
import * as fs from "node:fs";
import * as path from "node:path";
import { load, groupBy, mean } from "./load.js";
const BOT = Number(process.argv[2] ?? 77);
const GAMES = Number(process.argv[3] ?? 150);
const PAID = [11, 16, 17, 14, 11, 19, 12, 21, 10, 29, 23, 11, 17, 10, 10, 16, 28, 11, 12, 10, 10, 18, 18, 31, 21, 38];
const PH = [[1, 20], [21, 45], [46, 56], [57, 68]] as const;
const names = new Map(load("bot").map((b) => [b.id, b.name]));
const parts = load("matchParticipant");
const live = (p: string) => fs.readdirSync("data/live").filter((f) => f.startsWith(p))
  .flatMap((f) => fs.readFileSync(path.join("data/live", f), "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean));
const lalaV27 = new Set(live("matches-").filter((m) => ["v2.7", "v2.7.2", "v2.7.3", "v2.7.4"].includes(m.version) || (m.version === "v2.7-ab" && m.arm === "A")).map((m) => m.match));
const matchesOf = (bot: number) => {
  const ended = new Set(load("matchState").filter((m) => m.status === "Ended").map((m) => m.id));
  let ids = parts.filter((p) => p.botId === bot && ended.has(p.matchId)).map((p) => p.matchId);
  if (bot === 88) ids = ids.filter((id) => lalaV27.has(id));
  return ids.sort((a, b) => a - b).slice(-GAMES);
};
const res = groupBy(load("auctionResult"), (r) => r.matchId);
const words = groupBy(load("wordPlay"), (w) => w.matchId);
const tops = new Map(load("auctionTopBidArchive").map((t) => [t.auctionId, t.topBid]));
const pm = groupBy(parts, (p) => p.matchId);
function profile(bot: number) {
  const ids = matchesOf(bot);
  const rows = ids.map((mid) => {
    const rs = (res.get(mid) ?? []).sort((a, b) => a.auctionId - b.auctionId);
    const ws = (words.get(mid) ?? []).filter((w) => w.botId === bot).map((w) => ({ ...w, round: rs.filter((r) => r.closedAt <= w.playedAt).length }));
    const ps = pm.get(mid) ?? [];
    const me = ps.find((p) => p.botId === bot)!;
    const place = 1 + ps.filter((q) => q.score > me.score).length;
    const ph = PH.map(([lo, hi]) => {
      const won = rs.map((r, i) => ({ r, round: i + 1 })).filter((x) => x.r.winnerBotId === bot && x.round >= lo && x.round <= hi);
      return { tiles: won.length, spent: won.reduce((s, x) => s + x.r.paid, 0), ratio: won.map((x) => (tops.get(x.r.auctionId) ?? x.r.paid) / PAID[x.r.letter.charCodeAt(0) - 65]!) };
    });
    const coinsAt = (round: number) => 100 - rs.slice(0, round).filter((r) => r.winnerBotId === bot).reduce((s, r) => s + r.paid, 0) + ws.filter((w) => w.round < round).reduce((s, w) => s + w.totalReward, 0);
    const big = ws.filter((w) => w.word.length >= 7);
    return {
      place, score: me.score, ph, c20: coinsAt(20), c45: coinsAt(45), c56: coinsAt(56),
      nWords: ws.length, big: big.length, bigRounds: big.map((w) => w.round),
      late: ws.filter((w) => w.round >= 57).reduce((s, w) => s + w.totalReward, 0),
      lateLen: ws.filter((w) => w.round >= 57).map((w) => w.word.length),
    };
  });
  return rows;
}
const show = (label: string, rows: ReturnType<typeof profile>) => {
  const f = (xs: number[], d = 1) => mean(xs).toFixed(d);
  console.log(`\n${label}: ${rows.length} games, place ${f(rows.map((r) => r.place), 2)}, win ${(100 * mean(rows.map((r) => (r.place === 1 ? 1 : 0)))).toFixed(0)}%, score ${f(rows.map((r) => r.score))}`);
  console.log(`  coins on hand at round 20 / 45 / 56:  ${f(rows.map((r) => r.c20), 0)} / ${f(rows.map((r) => r.c45), 0)} / ${f(rows.map((r) => r.c56), 0)}`);
  PH.forEach(([lo, hi], i) => {
    const ratios = rows.flatMap((r) => r.ph[i]!.ratio).sort((a, b) => a - b);
    console.log(`  rounds ${String(lo).padStart(2)}-${hi}: tiles ${f(rows.map((r) => r.ph[i]!.tiles))}  spent ${f(rows.map((r) => r.ph[i]!.spent), 0)}  bid/price median ${ratios.length ? ratios[Math.floor(ratios.length / 2)]!.toFixed(2) : "-"}`);
  });
  const firstBig = rows.map((r) => r.bigRounds[0] ?? 68), secondBig = rows.filter((r) => r.bigRounds.length >= 2).map((r) => r.bigRounds[1]!);
  console.log(`  words ${f(rows.map((r) => r.nWords))}, 7+ words ${f(rows.map((r) => r.big), 2)}, 1st 7+ at round ${f(firstBig, 0)}, 2nd 7+ at round ${f(secondBig, 0)} (${rows.filter((r) => r.bigRounds.length >= 2).length} games)`);
  console.log(`  points from words played in rounds 57-68: ${f(rows.map((r) => r.late))}  (avg length ${f(rows.flatMap((r) => r.lateLen))})`);
};
const lambi = profile(BOT);
show(`${names.get(BOT)} (all)`, lambi);
show(`${names.get(BOT)} wins`, lambi.filter((r) => r.place === 1));
show(`${names.get(BOT)} 2nd-6th`, lambi.filter((r) => r.place > 1));
show("Lala v2.7.x", profile(88));
