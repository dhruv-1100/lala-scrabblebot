// When did Lala's current site version start, and its stats so far.
import { DbConnection } from "../src/module_bindings/index.js";
const S = 400 / (Math.LN10 * (25 / 6) * Math.SQRT2);
DbConnection.builder().withUri("https://maincloud.spacetimedb.com").withDatabaseName("scrabblebot")
  .onConnect((c) => c.subscriptionBuilder().onApplied(() => {
    const vs = [...c.db.botVersion.iter()].filter((v) => v.botId === 88n).sort((a, b) => a.version - b.version);
    for (const v of vs.slice(-3)) console.log(`version ${v.version} started ${new Date(Number(v.startedAt.microsSinceUnixEpoch / 1000n)).toISOString()}`);
    const s = [...c.db.botStats.iter()].find((x) => x.botId === 88n);
    console.log(s ? `current: ${s.matchesPlayed} games, ${s.wins} wins, rating ${Math.round(1500 + S * (s.openskillMu - 25))} ± ${Math.round(S * s.openskillSigma)}` : "current: no games yet");
    process.exit(0);
  }).subscribe(["SELECT * FROM bot_version", "SELECT * FROM bot_stats"])).build();
setTimeout(() => { console.log("timeout"); process.exit(2); }, 60000);
