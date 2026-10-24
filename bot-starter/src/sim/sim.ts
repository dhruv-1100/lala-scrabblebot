// Faithful re-implementation of one match as the module runs it
// (spacetimedb/src/game.ts): deal, draw, sealed-bid auction, payment,
// word plays, end when the bag is empty. Unsold tiles are discarded, as
// closeAuction does (the docs say they go back to the bag; the code
// doesn't). Words may be played while an auction is open; a tile won in
// the final auction can never be played.

import { BAG_COUNTS, STARTING_BALANCE, A_CODE, emptyCounts, type Counts } from "../engine/letters.js";
import type { Dict } from "../engine/dict.js";
import { Rng } from "../engine/rng.js";
import { Tracker, type AuctionType } from "../engine/tracker.js";
import type { Agent, View } from "./types.js";

export interface MatchOptions {
  seed: number;
  auctionType?: AuctionType;
  startRack?: number;
  record?: boolean;
}

export interface AuctionLog {
  round: number;
  letter: number;
  bids: number[];
  winner: number | null;
  paid: number;
}

export interface MatchResult {
  scores: number[];
  balances: number[];
  tilesWon: number[];
  vowelsWon: number[];
  spent: number[];
  words: string[][];
  unplayed: number[];
  places: number[]; // 1 = best; ties share the better place
  auctions?: AuctionLog[];
  rejected: number[];
}

export function placesOf(scores: number[]): number[] {
  return scores.map((s) => 1 + scores.filter((t) => t > s).length);
}

export function runMatch(dict: Dict, agents: Agent[], opts: MatchOptions): MatchResult {
  const rng = new Rng(opts.seed);
  const auctionType = opts.auctionType ?? "Vickrey";
  const startRack = opts.startRack ?? 5;
  const n = agents.length;
  const bag = Uint8Array.from(BAG_COUNTS);
  let bagTotal = 98;

  const draw = (): number => {
    if (bagTotal === 0) return -1;
    let r = rng.int(0, bagTotal - 1);
    for (let k = 0; k < 26; k++) {
      if (r < bag[k]!) {
        bag[k]!--;
        bagTotal--;
        return k;
      }
      r -= bag[k]!;
    }
    return -1;
  };

  const racks: Counts[] = agents.map(() => emptyCounts());
  for (let p = 0; p < n; p++) {
    for (let j = 0; j < startRack; j++) {
      const l = draw();
      if (l >= 0) racks[p]![l]!++;
    }
  }
  const balance = new Array<number>(n).fill(STARTING_BALANCE);
  const score = new Array<number>(n).fill(0);
  const tilesWon = new Array<number>(n).fill(0);
  const vowelsWon = new Array<number>(n).fill(0);
  const spent = new Array<number>(n).fill(0);
  const rejected = new Array<number>(n).fill(0);
  const words: string[][] = agents.map(() => []);
  const ids = agents.map((_, i) => i);
  const trackers = agents.map((_, p) => new Tracker(p, ids, racks[p]!, auctionType, startRack));
  const auctions: AuctionLog[] = [];
  agents.forEach((a, p) => a.startMatch?.(p, n, auctionType));

  let lastWinner: number | null = null;
  let round = 0;
  let letter = draw();
  while (letter >= 0) {
    round++;
    for (const t of trackers) t.onAuction(letter, bagTotal);

    // Everyone decides from the same moment: the auction just opened.
    const actions = agents.map((a, p) => {
      const view: View = {
        auctionType, me: p, n, round, letter,
        auctionsLeft: bagTotal + 1,
        rack: new Uint8Array(racks[p]!),
        balance: balance[p]!, score: score[p]!,
        tracker: trackers[p]!, wonLast: lastWinner === p,
      };
      return a.act(view);
    });

    const bids = new Array<number>(n).fill(0);
    for (let p = 0; p < n; p++) {
      const act = actions[p]!;
      for (const w of act.words) {
        if (!playWord(dict, racks[p]!, w)) {
          rejected[p]!++;
          continue;
        }
        const r = dict.isValid(w) ? rewardOf(dict, w) : 0;
        balance[p]! += r;
        score[p]! += r;
        words[p]!.push(w);
        for (const t of trackers) t.onWord(p, w);
      }
      let b = Math.floor(act.bid);
      if (!Number.isFinite(b) || b < 0) b = 0;
      if (b > balance[p]!) {
        rejected[p]!++; // the module refuses the bid outright
        b = 0;
      }
      bids[p] = b;
    }

    // Shuffle, then stable sort by amount: ties land in random order.
    const order = ids.filter((p) => bids[p]! > 0);
    rng.shuffle(order);
    order.sort((x, y) => bids[y]! - bids[x]!);
    let winner: number | null = null;
    let paid = 0;
    if (order.length) {
      const first = order[0]!;
      winner = first;
      paid = auctionType === "FirstPrice"
        ? bids[first]!
        : order.length > 1 ? bids[order[1]!]! : Math.min(1, bids[first]!);
      if (balance[first]! >= paid) {
        balance[first]! -= paid;
        racks[first]![letter]!++;
        tilesWon[first]!++;
        if (letter === 0 || letter === 4 || letter === 8 || letter === 14 || letter === 20) vowelsWon[first]!++;
        spent[first]! += paid;
      }
    }
    lastWinner = winner;
    for (const t of trackers) {
      t.onResult(letter, winner, paid);
      for (let p = 0; p < n; p++) t.setStanding(p, balance[p]!, score[p]!);
    }
    if (opts.record) auctions.push({ round, letter, bids, winner, paid });
    letter = draw();
  }

  const places = placesOf(score);
  agents.forEach((a, p) => a.endMatch?.(places[p]!, score));
  return {
    scores: score, balances: balance, tilesWon, vowelsWon, spent, words,
    unplayed: racks.map((r) => r.reduce((s, x) => s + x, 0)),
    places, auctions: opts.record ? auctions : undefined, rejected,
  };
}

function rewardOf(dict: Dict, w: string): number {
  // Same integer arithmetic as playWord in the module.
  let base = 0;
  for (let i = 0; i < w.length; i++) base += [1, 3, 3, 2, 1, 4, 2, 4, 1, 8, 5, 1, 3, 1, 1, 3, 10, 1, 1, 1, 1, 4, 4, 8, 4, 10][w.charCodeAt(i) - A_CODE]!;
  const len = w.length;
  const [num, den] = len <= 3 ? [1, 1] : len === 4 ? [3, 2] : len === 5 ? [2, 1] : len === 6 ? [5, 2] : [3, 1];
  void dict;
  return Math.floor((base * num) / den);
}

// Validates and applies a word to a rack. Mirrors submitWord's checks.
function playWord(dict: Dict, rack: Counts, word: string): boolean {
  const w = word.toUpperCase();
  if (w.length < 2 || !/^[A-Z]+$/.test(w) || !dict.isValid(w)) return false;
  const need = new Uint8Array(26);
  for (let i = 0; i < w.length; i++) {
    const k = w.charCodeAt(i) - A_CODE;
    if (++need[k]! > rack[k]!) return false;
  }
  for (let k = 0; k < 26; k++) rack[k]! -= need[k]!;
  return true;
}
