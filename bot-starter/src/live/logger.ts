// Public-table logger. Connects anonymously (no token needed), follows every
// match from now on and appends each auction result, word play, archived
// top bid and final standings to data/stream/*.jsonl. History before the
// logger started is in the database too: `npm run dump` snapshots it.
//
//   npm run logger

import * as fs from "node:fs";
import * as path from "node:path";
import { DbConnection } from "../module_bindings/index.js";
import { plain } from "./plain.js";

const HOST = process.env.STDB_HOST ?? "https://maincloud.spacetimedb.com";
const DB_NAME = process.env.STDB_DB ?? "scrabblebot";
const OUT = path.resolve(process.env.STREAM_DIR ?? "data/stream");
fs.mkdirSync(OUT, { recursive: true });

function write(kind: string, row: unknown): void {
  const day = new Date().toISOString().slice(0, 10);
  fs.appendFileSync(path.join(OUT, `${kind}-${day}.jsonl`), JSON.stringify(plain(row)) + "\n");
}
function log(msg: string): void {
  console.log(`${new Date().toISOString()} [logger] ${msg}`);
}

let lastEvent = Date.now();
let counts = { results: 0, words: 0, matches: 0 };

function start(): void {
  DbConnection.builder()
    .withUri(HOST)
    .withDatabaseName(DB_NAME)
    .withAutomaticReconnect({ minDelayMs: 1000, maxDelayMs: 30000 })
    .onConnect((c) => {
      log("connected");
      const boot = c.subscriptionBuilder()
        .onApplied(() => {
          let floor = 0n;
          for (const m of c.db.matchState.iter()) if (m.id > floor) floor = m.id;
          floor = floor > 10n ? floor - 10n : 0n;
          c.subscriptionBuilder()
            .onApplied(() => {
              boot.unsubscribe();
              log(`following matches from ${floor}`);
            })
            .subscribe([
              "SELECT * FROM bot",
              `SELECT * FROM match_state WHERE id >= ${floor}`,
              `SELECT * FROM match_participant WHERE match_id >= ${floor}`,
              `SELECT * FROM auction_result WHERE match_id >= ${floor}`,
              `SELECT * FROM word_play WHERE match_id >= ${floor}`,
              `SELECT * FROM auction_top_bid_archive WHERE match_id >= ${floor}`,
            ]);
        })
        .subscribe(["SELECT * FROM match_state"]);

      c.db.auctionResult.onInsert((_ctx, r) => {
        lastEvent = Date.now();
        counts.results++;
        write("auction_result", r);
      });
      c.db.wordPlay.onInsert((_ctx, w) => {
        lastEvent = Date.now();
        counts.words++;
        write("word_play", w);
      });
      c.db.auctionTopBidArchive.onInsert((_ctx, t) => write("top_bid", t));
      c.db.matchState.onInsert((_ctx, m) => write("match_start", m));
      c.db.matchState.onUpdate((_ctx, old, neu) => {
        if (old.status.tag === "Ended" || neu.status.tag !== "Ended") return;
        counts.matches++;
        const parts = [...c.db.matchParticipant.iter()].filter((p) => p.matchId === neu.id);
        const names = new Map([...c.db.bot.iter()].map((b) => [b.id, b.name]));
        write("match_end", {
          ...neu,
          participants: parts.map((p) => ({ botId: p.botId, name: names.get(p.botId), balance: p.balance, score: p.score })),
        });
      });
    })
    .onConnectError((_ctx, err, next) => {
      log(`connect error ${err.message}`);
      if (next === undefined) setTimeout(start, 5000);
    })
    .onDisconnect(() => log("disconnected"))
    .build();
}

setInterval(() => {
  log(`results=${counts.results} words=${counts.words} matches=${counts.matches} idle=${Math.round((Date.now() - lastEvent) / 1000)}s`);
}, 300_000);
start();
