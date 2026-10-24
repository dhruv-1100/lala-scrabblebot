// Lala live runtime.
//
//   BOT_NAME=Lala BOT_TOKEN=<token> npm run bot        (first run)
//   BOT_NAME=Lala npm run bot                          (token saved to .token-Lala)
//   TOURNAMENT_ID=<id> ...                             (register for a tournament)
//   DRY_RUN=1 ...                                      (decide and log, never call reducers)
//
// Connects with the bot's token, subscribes to the bot's matches, bids on
// every auction the moment it opens, plays words, rejoins the lobby after
// each match, reconnects with backoff and logs every decision as JSONL.

import * as fs from "node:fs";
import * as path from "node:path";
import { DbConnection } from "../module_bindings/index.js";
import type { Identity } from "spacetimedb";
import { loadDict } from "../engine/dict.js";
import { LIVE_PAID } from "../sim/agents.js";
import { Lala, type LalaParams } from "../strategy/lala.js";
import { TUNED } from "../strategy/params.js";
import { buildView, readMatch } from "./view.js";
import { idx, countsToString } from "../engine/letters.js";

const HOST = process.env.STDB_HOST ?? "https://maincloud.spacetimedb.com";
const DB_NAME = process.env.STDB_DB ?? "scrabblebot";
const BOT_NAME = process.env.BOT_NAME ?? "Lala";
const TOURNAMENT_ID = process.env.TOURNAMENT_ID;
const DRY_RUN = process.env.DRY_RUN === "1";
const NO_LOBBY = process.env.NO_LOBBY === "1";
const ROOT = process.cwd();
const TOKEN_PATH = path.join(ROOT, `.token-${BOT_NAME}`);
const LOG_DIR = path.resolve(process.env.LOG_DIR ?? path.join(ROOT, "data", "live"));
fs.mkdirSync(LOG_DIR, { recursive: true });

const params: Partial<LalaParams> = { ...TUNED, ...JSON.parse(process.env.LALA_PARAMS ?? "{}") };
const dict = loadDict();
const lala = new Lala(dict, params, BOT_NAME);

// ---------- logging ----------

function stamp(): string {
  return new Date().toISOString();
}
function log(msg: string): void {
  console.log(`${stamp()} [${BOT_NAME}] ${msg}`);
}
function jsonl(file: string, row: Record<string, unknown>): void {
  const day = new Date().toISOString().slice(0, 10);
  fs.appendFileSync(
    path.join(LOG_DIR, `${file}-${day}.jsonl`),
    JSON.stringify({ t: stamp(), ...row }, (_k, v) => (typeof v === "bigint" ? Number(v) : v)) + "\n",
  );
}

function loadToken(): string | undefined {
  if (process.env.BOT_TOKEN) return process.env.BOT_TOKEN.trim();
  try {
    return fs.readFileSync(TOKEN_PATH, "utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}
function saveToken(tok: string): void {
  try {
    fs.writeFileSync(TOKEN_PATH, tok, { mode: 0o600 });
  } catch (e) {
    log(`couldn't save token: ${String(e)}`);
  }
}

// ---------- state ----------

let conn: DbConnection | null = null;
let myIdentity: Identity | null = null;
let myBotId: bigint | null = null;
let lastEventAt = Date.now();
let lastLobbyJoin = 0;
let reconnectDelay = 1000;
let mainSub: { unsubscribe(): void } | null = null;
let subFloor = 0n;
const handled = new Map<bigint, { bid: number; words: string[] }>(); // auctionId -> what we sent
const endedLogged = new Set<bigint>();

function myRunningMatches(c: DbConnection): bigint[] {
  if (myBotId === null) return [];
  const out: bigint[] = [];
  for (const p of c.db.matchParticipant.iter()) {
    if (p.botId !== myBotId) continue;
    const m = c.db.matchState.id.find(p.matchId);
    if (m?.status.tag === "Running") out.push(p.matchId);
  }
  return out;
}

function inOpenLobby(c: DbConnection): boolean {
  if (myBotId === null) return false;
  for (const l of c.db.lobby.iter()) {
    if (l.status.tag !== "Open") continue;
    for (const m of c.db.lobbyMember.iter()) if (m.lobbyId === l.id && m.botId === myBotId) return true;
  }
  return false;
}

function heldForTournament(c: DbConnection): boolean {
  if (myBotId === null) return false;
  for (const e of c.db.tournamentEntry.iter()) {
    if (e.botId !== myBotId || e.eliminated) continue;
    const t = c.db.tournament.id.find(e.tournamentId);
    if (t && ["Swiss", "Bracket", "Final"].includes(t.status.tag)) return true;
  }
  return false;
}

function call(what: string, p: Promise<unknown>): Promise<boolean> {
  return p.then(
    () => true,
    (err) => {
      log(`${what} failed: ${err instanceof Error ? err.message : String(err)}`);
      jsonl("errors", { what, err: err instanceof Error ? err.message : String(err) });
      return false;
    },
  );
}

// ---------- decisions ----------

function fallbackBid(letter: string, balance: number, bagTotal: number): number {
  if (bagTotal === 0) return 0;
  return Math.max(0, Math.min(balance, Math.round(LIVE_PAID[idx(letter)]! * 0.8)));
}

function decide(auctionId: bigint): void {
  const c = conn;
  if (!c || myBotId === null) return;
  if (handled.has(auctionId)) return;
  const a = c.db.auction.id.find(auctionId);
  if (!a || a.status.tag !== "Open") return;
  const me = Number(myBotId);
  const m = readMatch(c, a.matchId, myBotId);
  if (!m || !m.running || !m.players.includes(me)) return;
  const t0 = performance.now();
  const recvLag = Date.now() - Number(a.opensAt.microsSinceUnixEpoch / 1000n);
  let bid = 0;
  let words: string[] = [];
  let info: Record<string, unknown> = {};
  const balance = m.balances.get(me)?.balance ?? 0;
  try {
    const view = buildView(m, me, a.letter);
    const d = lala.act(view);
    bid = d.bid;
    words = d.words;
    info = { value: +d.value.toFixed(2), marginal: +d.marginal.toFixed(2), mu: +d.mu.toFixed(3) };
  } catch (e) {
    log(`decide crashed, using fallback: ${e instanceof Error ? e.stack : String(e)}`);
    bid = fallbackBid(a.letter, balance, m.bagTotal);
    info = { fallback: true, err: String(e) };
  }
  const ms = performance.now() - t0;
  handled.set(auctionId, { bid, words });
  jsonl("decisions", {
    match: a.matchId, auction: auctionId, round: m.results.length + 1, left: m.bagTotal + 1,
    letter: a.letter, rack: countsToString(m.rack), balance, words, bid, ms: +ms.toFixed(1), lagMs: recvLag, ...info,
  });
  if (DRY_RUN) {
    log(`[dry] ${a.letter} rack=${countsToString(m.rack)} bal=${balance} words=${words.join(",")} bid=${bid}`);
    return;
  }

  // Bid at once with what we can afford now, play the words, then raise
  // the bid to the full amount once their rewards have landed.
  const now = Math.min(bid, balance);
  if (now > 0) void call(`bid ${now} on ${a.letter}`, c.reducers.submitBid({ auctionId, amount: BigInt(now) }));
  if (words.length) {
    void (async () => {
      for (const w of words) {
        const ok = await call(`word ${w}`, c.reducers.submitWord({ matchId: a.matchId, word: w }));
        log(`play ${w} ${ok ? "ok" : "REFUSED"}`);
      }
      if (bid > now) {
        const fresh = c.db.auction.id.find(auctionId);
        if (fresh?.status.tag === "Open") {
          const p = [...c.db.matchParticipant.iter()].find((x) => x.matchId === a.matchId && x.botId === myBotId);
          const amt = Math.min(bid, Number(p?.balance ?? 0));
          if (amt > now) void call(`rebid ${amt}`, c.reducers.submitBid({ auctionId, amount: BigInt(amt) }));
        }
      }
    })();
  }
  log(`r${m.results.length + 1} ${a.letter} rack=${countsToString(m.rack)} bal=${balance} ${words.length ? `play=${words.join(",")} ` : ""}bid=${bid} (${ms.toFixed(0)}ms, lag ${recvLag}ms)`);
}

function scheduleOpenAuctions(): void {
  const c = conn;
  if (!c || myBotId === null) return;
  for (const matchId of myRunningMatches(c)) {
    const ms = c.db.matchState.id.find(matchId);
    const aid = ms?.currentAuctionId;
    if (aid !== undefined && aid !== null && !handled.has(aid)) decide(aid);
  }
}

function onMatchEnded(matchId: bigint): void {
  const c = conn;
  if (!c || myBotId === null || endedLogged.has(matchId)) return;
  const parts = [...c.db.matchParticipant.iter()].filter((p) => p.matchId === matchId);
  if (!parts.some((p) => p.botId === myBotId)) return;
  endedLogged.add(matchId);
  const mine = parts.find((p) => p.botId === myBotId)!;
  const place = 1 + parts.filter((p) => p.score > mine.score).length;
  const words = [...c.db.wordPlay.iter()].filter((w) => w.matchId === matchId && w.botId === myBotId).map((w) => w.word);
  const won = [...c.db.auctionResult.iter()].filter((r) => r.matchId === matchId && r.winnerBotId === myBotId);
  const row = {
    match: matchId, place, score: Number(mine.score), balance: Number(mine.balance),
    scores: parts.map((p) => ({ bot: p.botId, score: p.score })).sort((a, b) => Number(b.score - a.score)),
    words, tiles: won.length, spent: won.reduce((s, r) => s + Number(r.paid), 0), params,
  };
  jsonl("matches", row);
  log(`match ${matchId} ended: place ${place}/${parts.length} score ${mine.score} words ${words.join(" ")}`);
  setTimeout(() => maybeJoinLobby(true), 300);
}

function maybeJoinLobby(force = false): void {
  const c = conn;
  if (!c || myBotId === null || DRY_RUN || NO_LOBBY) return;
  if (myRunningMatches(c).length > 0 || inOpenLobby(c) || heldForTournament(c)) return;
  if (!force && Date.now() - lastLobbyJoin < 10_000) return;
  lastLobbyJoin = Date.now();
  log("joining lobby");
  void call("join lobby", c.reducers.joinLobby({}));
}

// ---------- subscriptions ----------

function subscribeMain(c: DbConnection, floor: bigint, lobbyFloor: bigint): void {
  const old = mainSub;
  subFloor = floor;
  const q = [
    "SELECT * FROM bot",
    "SELECT * FROM bot_credential",
    "SELECT * FROM my_rack",
    "SELECT * FROM tournament",
    "SELECT * FROM tournament_entry",
    `SELECT * FROM match_state WHERE id >= ${floor}`,
    `SELECT * FROM match_participant WHERE match_id >= ${floor}`,
    `SELECT * FROM auction WHERE match_id >= ${floor}`,
    `SELECT * FROM auction_result WHERE match_id >= ${floor}`,
    `SELECT * FROM word_play WHERE match_id >= ${floor}`,
    `SELECT * FROM lobby WHERE id >= ${lobbyFloor}`,
    `SELECT * FROM lobby_member WHERE lobby_id >= ${lobbyFloor}`,
  ];
  mainSub = c.subscriptionBuilder()
    .onApplied(() => {
      old?.unsubscribe();
      lastEventAt = Date.now();
      myBotId = myIdentity ? (c.db.botCredential.identity.find(myIdentity)?.botId ?? null) : null;
      if (myBotId === null) {
        log("this token is not a credential for any bot. Generate one on /team and set BOT_TOKEN.");
        process.exit(2);
      }
      const bot = c.db.bot.id.find(myBotId);
      log(`subscribed (floor match ${floor}); acting as '${bot?.name}' (bot id ${myBotId})`);
      if (TOURNAMENT_ID && !DRY_RUN) {
        void call(`register for tournament ${TOURNAMENT_ID}`, c.reducers.registerForTournament({ tournamentId: BigInt(TOURNAMENT_ID) }))
          .then((ok) => ok && log(`registered for tournament ${TOURNAMENT_ID}`));
      }
      scheduleOpenAuctions();
      maybeJoinLobby(true);
    })
    .onError((_ctx) => log("subscription error"))
    .subscribe(q);
}

// Find the newest match and lobby ids with a one-off query, then subscribe
// to everything from there on. Matches we're still in are included.
function bootstrap(c: DbConnection): void {
  const sub = c.subscriptionBuilder()
    .onApplied(() => {
      let maxMatch = 0n;
      let minRunning: bigint | null = null;
      for (const m of c.db.matchState.iter()) {
        if (m.id > maxMatch) maxMatch = m.id;
        if (m.status.tag === "Running" && (minRunning === null || m.id < minRunning)) minRunning = m.id;
      }
      let maxLobby = 0n;
      for (const l of c.db.lobby.iter()) if (l.id > maxLobby) maxLobby = l.id;
      const floor = minRunning !== null && minRunning < maxMatch ? minRunning : maxMatch;
      subscribeMain(c, floor, maxLobby > 2n ? maxLobby - 2n : 0n);
      sub.unsubscribe();
    })
    .subscribe(["SELECT * FROM match_state", "SELECT * FROM lobby"]);
}

function wire(c: DbConnection): void {
  const touch = () => {
    lastEventAt = Date.now();
  };
  c.db.auction.onInsert((_ctx, a) => {
    touch();
    if (a.status.tag === "Open") setImmediate(() => decide(a.id));
  });
  c.db.auctionResult.onInsert((_ctx, r) => {
    touch();
    if (myBotId !== null && r.winnerBotId === myBotId) log(`won ${r.letter} for ${r.paid}`);
  });
  c.db.matchState.onUpdate((_ctx, old, neu) => {
    touch();
    if (old.status.tag !== "Ended" && neu.status.tag === "Ended") setImmediate(() => onMatchEnded(neu.id));
  });
  c.db.matchState.onInsert(() => {
    touch();
    setImmediate(scheduleOpenAuctions);
  });
  c.db.matchParticipant.onInsert(() => setImmediate(scheduleOpenAuctions));
  c.db.lobby.onInsert(() => setImmediate(() => maybeJoinLobby()));
}

// ---------- connection lifecycle ----------

function connect(): void {
  log(`connecting to ${DB_NAME} at ${HOST}${DRY_RUN ? " (dry run)" : ""}`);
  const token = loadToken();
  if (!token) {
    log(`no token: set BOT_TOKEN or create ${TOKEN_PATH}`);
    process.exit(2);
  }
  DbConnection.builder()
    .withUri(HOST)
    .withDatabaseName(DB_NAME)
    .withToken(token)
    .withAutomaticReconnect({ minDelayMs: 1000, maxDelayMs: 15000 })
    .onConnect((c, identity, tok) => {
      conn = c;
      myIdentity = identity;
      reconnectDelay = 1000;
      saveToken(tok);
      log(`connected as ${identity.toHexString().slice(0, 16)}…`);
      wire(c);
      bootstrap(c);
    })
    .onAutomaticReconnect((c) => {
      conn = c;
      log("reconnected");
      lastEventAt = Date.now();
      setTimeout(() => {
        scheduleOpenAuctions();
        maybeJoinLobby(true);
      }, 500);
    })
    .onConnectError((_ctx, err, next) => {
      log(`connect error: ${err.message}${next === undefined ? "" : ` (retry ${next})`}`);
      if (next === undefined) retryLater();
    })
    .onDisconnect((_ctx, err) => {
      log(`disconnected${err ? `: ${err.message}` : ""}`);
    })
    .build();
}

function retryLater(): void {
  conn = null;
  const d = reconnectDelay;
  reconnectDelay = Math.min(30_000, reconnectDelay * 2);
  log(`reconnecting in ${d}ms`);
  setTimeout(connect, d);
}

// Watchdog: keep the bot in the lobby, catch auctions we somehow missed,
// roll the subscription floor forward, and rebuild a silent connection.
setInterval(() => {
  const c = conn;
  if (!c) return;
  scheduleOpenAuctions();
  maybeJoinLobby();
  if (Date.now() - lastEventAt > 180_000) {
    log("no updates for 3 minutes; rebuilding the connection");
    lastEventAt = Date.now();
    try {
      c.disconnect();
    } catch {
      /* already gone */
    }
    retryLater();
    return;
  }
  // Keep the client cache small on long runs.
  let maxMatch = subFloor;
  for (const m of c.db.matchState.iter()) if (m.id > maxMatch) maxMatch = m.id;
  if (maxMatch - subFloor > 200n && myRunningMatches(c).length === 0) bootstrap(c);
  for (const [aid] of handled) if (handled.size > 5000) handled.delete(aid);
}, 2000);

process.on("unhandledRejection", (e) => log(`unhandled rejection: ${String(e)}`));
process.on("uncaughtException", (e) => {
  log(`uncaught exception: ${e.stack ?? String(e)}`);
  jsonl("errors", { what: "uncaught", err: e.stack ?? String(e) });
  process.exit(1); // pm2 restarts us
});

log(`params ${JSON.stringify(params)}`);
connect();
