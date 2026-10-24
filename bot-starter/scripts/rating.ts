// Print a bot's current rating row (OpenSkill on the site's Elo-like scale).
import { DbConnection } from "../src/module_bindings/index.js";
const id = BigInt(process.argv[2] ?? 88);
DbConnection.builder()
  .withUri("https://maincloud.spacetimedb.com").withDatabaseName("scrabblebot")
  .onConnect((c) => {
    c.subscriptionBuilder().onApplied(() => {
      const s = [...c.db.botStats.iter()].find((x) => x.botId === id);
      const all = [...c.db.botStats.iter()];
      if (!s) { console.log("no stats yet"); process.exit(0); }
      // Same transform as the site (src/rating.ts): ordinal-style mu - 3 sigma ranks; display scale below.
      const S = 400 / (Math.LN10 * (25 / 6) * Math.SQRT2); const ranked = all.filter((x) => S * x.openskillSigma <= 175); const rank = ranked.filter((x) => x.openskillMu > s.openskillMu).length + 1;
      console.log(JSON.stringify({ matches: s.matchesPlayed, wins: s.wins, mu: +s.openskillMu.toFixed(2), sigma: +s.openskillSigma.toFixed(2), rating: Math.round(1500 + S * (s.openskillMu - 25)), plusMinus: Math.round(S * s.openskillSigma), rank: `${rank}/${ranked.length} ranked`, avgScore: +(Number(s.totalScore) / s.matchesPlayed).toFixed(1) }));
      process.exit(0);
    }).subscribe(["SELECT * FROM bot_stats"]);
  })
  .build();
setTimeout(() => process.exit(2), 20000);
