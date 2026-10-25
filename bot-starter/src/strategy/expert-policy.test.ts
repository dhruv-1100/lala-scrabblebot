import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadDict } from '../engine/dict.js';
import { countsOf, canSpell, wordReward } from '../engine/letters.js';
import { removeWord } from '../engine/words.js';
import { Tracker } from '../engine/tracker.js';
import { Lala } from './lala.js';
import { predict } from './expert-policy.js';
import { TUNED } from './params.js';
const dict = loadDict();
test('expert policy artifacts contain all trained strategies and feature widths', () => {
 const data = JSON.parse(readFileSync(new URL('./expert-models.json', import.meta.url), 'utf8'));
 assert.equal(data.meta.bidFeatures,68);assert.equal(data.meta.wordFeatures,127);
 for(const name of ['all','shark','bro','nijello'])for(const kind of ['bid','word'])assert.ok(data.models[name][kind].trees.length>=100);
});
test('learned policies submit affordable bids and legal words on novel racks', () => {
 for (const expertPolicy of [1,2,3,4]) for (const T of [68,35,12,3,2,1]) for (const tiles of ['AEIRS', 'QZXJK', 'RETAINS', 'UIXOTE', 'AAEEIII', 'VERNIXES']) {
  const rack = countsOf(tiles), tracker = new Tracker(0, [0,1,2,3,4,5], rack, 'Vickrey', 5);
  tracker.onAuction(4, T-1);
  const before = new Uint8Array(rack);
  const d = new Lala(dict, { ...TUNED, expertPolicy }).act({ auctionType:'Vickrey', me:0, n:6, round:69-T, letter:4, auctionsLeft:T, rack, balance:17, score:20, tracker, wonLast:false });
  let remaining = rack, coins = 17;
  for (const word of d.words) {
   assert.ok(dict.isValid(word));assert.ok(canSpell(remaining, word), `${tiles}: ${word}`);
   remaining = removeWord(remaining, word);coins += wordReward(word);
  }
  assert.ok(Number.isInteger(d.bid) && d.bid>=0 && d.bid<=coins, `${expertPolicy}/${tiles}/${T}: ${d.bid}/${coins}`);
  assert.deepEqual(rack,before);
  if(T===1)assert.equal(d.bid,0);
 }
});

test('TypeScript inference matches Python for reserved expert observations', () => {
 const data = JSON.parse(readFileSync(new URL('./expert-models.json', import.meta.url), 'utf8'));
 const references = JSON.parse(readFileSync(new URL('./expert-reference.json', import.meta.url), 'utf8'));
 assert.equal(references.length,40);
 for(const r of references)assert.ok(Math.abs(predict(data.models[r.name][r.kind],r.x)-r.expected)<1e-9, `${r.name}/${r.kind}`);
});
