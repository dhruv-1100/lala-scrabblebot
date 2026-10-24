import { DbConnection } from "../src/module_bindings/index.js";
const conn = DbConnection.builder()
  .withUri("https://maincloud.spacetimedb.com")
  .withDatabaseName("scrabblebot")
  .onConnect((c) => {
    c.subscriptionBuilder()
      .onApplied(() => {
        const d = c.db as any;
        const out: Record<string, number> = {};
        for (const k of Object.keys(d)) {
          try { out[k] = Number(d[k].count()); } catch {}
        }
        console.log(JSON.stringify(out));
        const ms = [...c.db.matchState.iter()];
        const ended = ms.filter((m) => m.status.tag === "Ended");
        console.log("matches", ms.length, "ended", ended.length, "running", ms.filter(m=>m.status.tag==="Running").length);
        console.log("auctionTypes", JSON.stringify(ms.reduce((a: any, m) => { a[m.auctionType.tag] = (a[m.auctionType.tag] ?? 0) + 1; return a; }, {})));
        console.log("bots", [...c.db.bot.iter()].map((b) => `${b.id}:${b.name}${b.isSimulated ? "(sim)" : ""}`).join(", "));
        console.log("lobbies", JSON.stringify([...c.db.lobby.iter()].filter(l=>l.status.tag==="Open").map(l=>({id: String(l.id), max: l.maxSize, type: l.auctionType.tag}))));
        console.log("cfg", JSON.stringify([...c.db.matchmakerConfig.iter()], (_k, v) => typeof v === "bigint" ? String(v) : v));
        console.log("tournaments", JSON.stringify([...c.db.tournament.iter()], (_k, v) => typeof v === "bigint" ? String(v) : v));
        console.log("stats", JSON.stringify([...c.db.botStats.iter()].map(s=>({b:String(s.botId), mu:s.openskillMu.toFixed(1), sg:s.openskillSigma.toFixed(1), n:s.matchesPlayed, w:s.wins, ts:String(s.totalScore)}))));
        process.exit(0);
      })
      .subscribeToAllTables();
  })
  .onConnectError((_c, e) => { console.error("err", e); process.exit(1); })
  .build();
setTimeout(() => { console.error("timeout"); process.exit(2); }, 30000);
