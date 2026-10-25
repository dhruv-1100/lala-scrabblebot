// Tournaments, leaderboard top and Lala's row, straight from the database the site reads.
import { DbConnection } from "../src/module_bindings/index.js";
const S = 400 / (Math.LN10 * (25 / 6) * Math.SQRT2);
DbConnection.builder().withUri("https://maincloud.spacetimedb.com").withDatabaseName("scrabblebot")
  .onConnect((c) => c.subscriptionBuilder().onApplied(() => {
    const names = new Map([...c.db.bot.iter()].map((b) => [b.id, b.name]));
    const tours = [...c.db.tournament.iter()];
    console.log("tournaments:", tours.length ? tours.map((t) => `#${t.id} ${t.status.tag} round ${t.currentRound}/${t.swissRoundsTotal} cut ${t.topCut} size ${t.matchSize} ${t.auctionType.tag}`).join("; ") : "none");
    const entries = [...c.db.tournamentEntry.iter()];
    if (entries.length) console.log("entries:", entries.map((e) => names.get(e.botId)).join(", "));
    const ranked = [...c.db.botStats.iter()].filter((s) => S * s.openskillSigma <= 175).sort((a, b) => b.openskillMu - a.openskillMu);
    ranked.slice(0, 12).forEach((s, i) => console.log(`${i + 1}. ${names.get(s.botId)} (#${s.botId}): ${Math.round(1500 + S * (s.openskillMu - 25))} ± ${Math.round(S * s.openskillSigma)}  ${s.matchesPlayed} games, ${Math.round((100 * s.wins) / s.matchesPlayed)}% wins, avg ${(Number(s.totalScore) / s.matchesPlayed).toFixed(1)}`));
    const me = ranked.findIndex((s) => s.botId === 88n);
    console.log(`Lala rank ${me + 1}/${ranked.length}`);
    process.exit(0);
  }).subscribe(["SELECT * FROM bot_stats", "SELECT * FROM bot", "SELECT * FROM tournament", "SELECT * FROM tournament_entry"])).build();
setTimeout(() => process.exit(2), 20000);
