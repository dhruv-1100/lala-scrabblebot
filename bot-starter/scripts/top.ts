// Top of the leaderboard on the site's rating scale.
import { DbConnection } from "../src/module_bindings/index.js";
const S = 400 / (Math.LN10 * (25 / 6) * Math.SQRT2);
DbConnection.builder().withUri("https://maincloud.spacetimedb.com").withDatabaseName("scrabblebot")
  .onConnect((c) => c.subscriptionBuilder().onApplied(() => {
    const names = new Map([...c.db.bot.iter()].map((b) => [b.id, b.name]));
    const rows = [...c.db.botStats.iter()].filter((s) => S * s.openskillSigma <= 175)
      .sort((a, b) => b.openskillMu - a.openskillMu).slice(0, 6);
    for (const s of rows) console.log(`${names.get(s.botId)}: ${Math.round(1500 + S * (s.openskillMu - 25))} ± ${Math.round(S * s.openskillSigma)} (${s.matchesPlayed} games, ${s.wins} wins)`);
    process.exit(0);
  }).subscribe(["SELECT * FROM bot_stats", "SELECT * FROM bot"])).build();
setTimeout(() => process.exit(2), 20000);
