// Words and purchases of every player in matches >= a given id (targeted query).
//   npx tsx scripts/match-detail.ts <minMatchId> <maxMatchId>
import { DbConnection } from "../src/module_bindings/index.js";
import * as fs from "node:fs";
const lo = BigInt(process.argv[2]!), hi = BigInt(process.argv[3]!);
DbConnection.builder().withUri("https://maincloud.spacetimedb.com").withDatabaseName("scrabblebot")
  .onConnect((c) => c.subscriptionBuilder().onApplied(() => {
    const names = new Map([...c.db.bot.iter()].map((b) => [b.id, b.name]));
    const out: any[] = [];
    const parts = [...c.db.matchParticipant.iter()].filter((p) => p.matchId >= lo && p.matchId <= hi);
    const res = [...c.db.auctionResult.iter()].filter((r) => r.matchId >= lo && r.matchId <= hi).sort((a, b) => (a.auctionId < b.auctionId ? -1 : 1));
    const words = [...c.db.wordPlay.iter()].filter((w) => w.matchId >= lo && w.matchId <= hi).sort((a, b) => (a.playedAt.microsSinceUnixEpoch < b.playedAt.microsSinceUnixEpoch ? -1 : 1));
    for (const p of parts) {
      const mr = res.filter((r) => r.matchId === p.matchId);
      const won = mr.map((r, i) => ({ r, i })).filter(({ r }) => r.winnerBotId === p.botId);
      const ws = words.filter((w) => w.matchId === p.matchId && w.botId === p.botId).map((w) => ({ word: w.word, reward: Number(w.totalReward), round: mr.filter((r) => r.closedAt.microsSinceUnixEpoch <= w.playedAt.microsSinceUnixEpoch).length }));
      out.push({ match: Number(p.matchId), bot: Number(p.botId), name: names.get(p.botId), score: Number(p.score), tiles: won.length, spent: won.reduce((s, x) => s + Number(x.r.paid), 0), late: won.filter((x) => x.i >= mr.length - 12).length, lateSpent: won.filter((x) => x.i >= mr.length - 12).reduce((s, x) => s + Number(x.r.paid), 0), words: ws });
    }
    fs.writeFileSync("data/recent-detail.json", JSON.stringify(out));
    console.log(`saved ${out.length} rows`);
    process.exit(0);
  }).subscribe([
    "SELECT * FROM bot",
    `SELECT * FROM match_participant WHERE match_id >= ${lo}`,
    `SELECT * FROM auction_result WHERE match_id >= ${lo}`,
    `SELECT * FROM word_play WHERE match_id >= ${lo}`,
  ])).build();
setTimeout(() => { console.log("timeout"); process.exit(2); }, 90000);
