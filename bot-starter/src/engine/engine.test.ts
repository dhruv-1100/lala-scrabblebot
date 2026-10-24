import { test } from "node:test";
import assert from "node:assert/strict";
import { loadDict } from "./dict.js";
import { countsOf, wordReward, multiplier, rewardFor, BAG_COUNTS, BAG_SIZE, countsToString } from "./letters.js";
import { bestPartition, playable } from "./words.js";
import { Tracker } from "./tracker.js";

const dict = loadDict();

test("bag has 98 tiles and the module's distribution", () => {
  assert.equal(BAG_COUNTS.reduce((a, b) => a + b, 0), BAG_SIZE);
  assert.equal(BAG_COUNTS[4], 12); // E
  assert.equal(BAG_COUNTS[16], 1); // Q
});

test("rewards use the module's integer arithmetic", () => {
  assert.deepEqual(multiplier(3), [1, 1]);
  assert.deepEqual(multiplier(4), [3, 2]);
  assert.deepEqual(multiplier(9), [3, 1]);
  assert.equal(wordReward("CAT"), 5);          // 3+1+1, 1x
  assert.equal(wordReward("QUIZ"), 33);        // 22 * 1.5
  assert.equal(rewardFor(5, 4), 7);            // floor(7.5)
  assert.equal(wordReward("RETAINS"), 21);     // 7 * 3
  assert.equal(wordReward("QUIXOTE"), 69);     // 23 * 3
});

test("dictionary matches the ENABLE list the module embeds", () => {
  assert.equal(dict.words.length, 172820);
  assert.ok(dict.isValid("RETAINS"));
  assert.ok(dict.isValid("aa"));
  assert.ok(!dict.isValid("QI"));              // ENABLE predates QI
  assert.ok(!dict.isValid("A"));               // single letters are refused
  assert.ok(!dict.isValid("RETAINZ"));
});

test("playable finds the anagrams of a rack", () => {
  const ws = playable(dict, countsOf("AEINRST"), 7, 20).map((i) => dict.words[i]);
  for (const w of ["NASTIER", "RETAINS", "RETINAS", "STAINER", "STEARIN"]) assert.ok(ws.includes(w), w);
});

// Exhaustive check of bestPartition on small racks.
function brute(rack: Uint8Array): number {
  const ws = dict.findWords(rack, 2);
  let best = 0;
  const rec = (r: Uint8Array, from: number, acc: number) => {
    best = Math.max(best, acc);
    for (let j = from; j < ws.length; j++) {
      const i = ws[j]!;
      if (!dict.fits(i, r)) continue;
      const nr = new Uint8Array(r);
      for (let p = dict.dOff[i]!; p < dict.dOff[i + 1]!; p++) nr[dict.dl[p]!]! -= dict.dc[p]!;
      rec(nr, j, acc + dict.reward[i]!);
    }
  };
  rec(rack, 0, 0);
  return best;
}

test("bestPartition is optimal on small racks", () => {
  for (const r of ["AEINRST", "QUIZAXE", "EEOOAAI", "BCDFGHT", "ZAXQIES", "OXENAIRT"]) {
    const c = countsOf(r);
    const p = bestPartition(dict, c, 2, 1000);
    assert.equal(p.reward, brute(c), r);
    const used = countsOf(p.words.join(""));
    for (let k = 0; k < 26; k++) assert.ok(used[k]! <= c[k]!, `${r} overuses ${countsToString(used)}`);
    for (const w of p.words) assert.ok(dict.isValid(w));
  }
});

test("tracker removes auctioned letters and revealed starting tiles from the unseen pool", () => {
  const t = new Tracker(0, [0, 1, 2], countsOf("AEIOU"), "Vickrey", 5);
  const start = t.unseenTotal();
  assert.equal(start, 98 - 5);
  t.onAuction(19, 82); // T
  t.onResult(19, 1, 10);
  assert.equal(t.unseenTotal(), start - 1);
  // Bot 1 plays CAT: T was won (known), C and A came from its hidden rack.
  t.onWord(1, "CAT");
  assert.equal(t.unseenTotal(), start - 3);
  assert.equal(t.opps.get(1)!.hidden, 3);
  assert.equal(t.opps.get(1)!.known[19], 0);
});
