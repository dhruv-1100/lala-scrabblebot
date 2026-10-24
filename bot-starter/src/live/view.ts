// Builds the strategy's View for one match from the SDK's client cache.
// Rebuilt from scratch at every decision so the result never depends on
// the order the SDK fires callbacks within a transaction.

import type { DbConnection } from "../module_bindings/index.js";
import { A_CODE, emptyCounts, idx } from "../engine/letters.js";
import { Tracker, type AuctionType } from "../engine/tracker.js";
import type { View } from "../sim/types.js";

export interface MatchRows {
  matchId: bigint;
  auctionType: AuctionType;
  bagTotal: number;
  startingRackSize: number;
  running: boolean;
  players: number[];
  results: { auctionId: bigint; letter: string; winner: number | null; paid: number; at: bigint }[];
  words: { id: bigint; botId: number; word: string; reward: number; at: bigint }[];
  balances: Map<number, { balance: number; score: number }>;
  rack: Uint8Array;
}

export function readMatch(conn: DbConnection, matchId: bigint, myBotId: bigint): MatchRows | null {
  const ms = conn.db.matchState.id.find(matchId);
  if (!ms) return null;
  const parts = [...conn.db.matchParticipant.iter()]
    .filter((p) => p.matchId === matchId)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const balances = new Map<number, { balance: number; score: number }>();
  for (const p of parts) balances.set(Number(p.botId), { balance: Number(p.balance), score: Number(p.score) });
  const results = [...conn.db.auctionResult.iter()]
    .filter((r) => r.matchId === matchId)
    .map((r) => ({
      auctionId: r.auctionId, letter: r.letter,
      winner: r.winnerBotId === undefined || r.winnerBotId === null ? null : Number(r.winnerBotId),
      paid: Number(r.paid), at: r.closedAt.microsSinceUnixEpoch,
    }))
    .sort((a, b) => (a.auctionId < b.auctionId ? -1 : 1));
  const words = [...conn.db.wordPlay.iter()]
    .filter((w) => w.matchId === matchId)
    .map((w) => ({ id: w.id, botId: Number(w.botId), word: w.word, reward: Number(w.totalReward), at: w.playedAt.microsSinceUnixEpoch }))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1));
  const rack = emptyCounts();
  for (const h of conn.db.myRack.iter()) {
    if (h.matchId === matchId) rack[idx(h.letter)]! += h.count;
  }
  void myBotId;
  return {
    matchId, auctionType: ms.auctionType.tag as AuctionType, bagTotal: ms.bagTotal,
    startingRackSize: ms.startingRackSize, running: ms.status.tag === "Running",
    players: parts.map((p) => Number(p.botId)), results, words, balances, rack,
  };
}

export function buildView(m: MatchRows, me: number, letter: string): View {
  // Our starting rack = rack now + letters we played - tiles we won.
  const start = new Int16Array(26);
  for (let k = 0; k < 26; k++) start[k] = m.rack[k]!;
  for (const w of m.words) {
    if (w.botId !== me) continue;
    for (let i = 0; i < w.word.length; i++) start[w.word.charCodeAt(i) - A_CODE]!++;
  }
  for (const r of m.results) if (r.winner === me) start[idx(r.letter)]!--;
  const myStart = emptyCounts();
  for (let k = 0; k < 26; k++) myStart[k] = Math.max(0, start[k]!);

  const t = new Tracker(me, m.players, myStart, m.auctionType, m.startingRackSize);
  // Replay results and word plays in time order.
  let wi = 0;
  for (const r of m.results) {
    while (wi < m.words.length && m.words[wi]!.at < r.at) {
      t.onWord(m.words[wi]!.botId, m.words[wi]!.word);
      wi++;
    }
    t.onAuction(idx(r.letter), 0);
    t.onResult(idx(r.letter), r.winner, r.paid);
  }
  for (; wi < m.words.length; wi++) t.onWord(m.words[wi]!.botId, m.words[wi]!.word);
  t.onAuction(idx(letter), m.bagTotal);
  for (const [id, s] of m.balances) t.setStanding(id, s.balance, s.score);

  const mine = m.balances.get(me) ?? { balance: 0, score: 0 };
  return {
    auctionType: m.auctionType, me, n: m.players.length,
    round: m.results.length + 1, letter: idx(letter),
    auctionsLeft: m.bagTotal + 1, rack: new Uint8Array(m.rack),
    balance: mine.balance, score: mine.score, tracker: t,
    wonLast: m.results.length > 0 && m.results[m.results.length - 1]!.winner === me,
  };
}
