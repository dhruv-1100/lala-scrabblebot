// One-shot snapshot of the public research tables into data/raw/<table>.jsonl.
import { DbConnection } from "../src/module_bindings/index.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { plain } from "../src/live/plain.js";

const OUT = path.resolve(process.argv[2] ?? "data/raw");
fs.mkdirSync(OUT, { recursive: true });

const TABLES = [
  "matchState", "matchParticipant", "auctionResult", "auctionTopBidArchive",
  "wordPlay", "bot", "botStats", "lobby", "lobbyMember",
  "ratingHistory", "team", "botVersion", "retiredBotStats",
];

DbConnection.builder()
  .withUri(process.env.STDB_HOST ?? "https://maincloud.spacetimedb.com")
  .withDatabaseName(process.env.STDB_DB ?? "scrabblebot")
  .onConnect((c) => {
    c.subscriptionBuilder()
      .onApplied(() => {
        for (const t of TABLES) {
          const tbl = (c.db as unknown as Record<string, { iter(): Iterable<unknown> }>)[t];
          const lines: string[] = [];
          for (const row of tbl.iter()) lines.push(JSON.stringify(plain(row)));
          fs.writeFileSync(path.join(OUT, `${t}.jsonl`), lines.join("\n") + "\n");
          console.log(t, lines.length);
        }
        process.exit(0);
      })
      // Request only what we export: no live winning-bid view, private rack
      // views, or redundant full auction table in this historical snapshot.
      .subscribe(TABLES.map((name) => `SELECT * FROM ${name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}`));
  })
  .onConnectError((_c, e) => { console.error(e); process.exit(1); })
  .build();
setTimeout(() => process.exit(2), 120000);
