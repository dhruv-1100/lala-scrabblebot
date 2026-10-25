import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Dict } from '../engine/dict.js';
import { countsOf, wordReward } from '../engine/letters.js';
import { rackSummary } from './expert-features.js';
import { predict } from './expert-policy.js';

test('expert features distinguish ready words and completions from this tile', () => {
 const dict = new Dict(['QUIXOTE', 'AX', 'TAX', 'AZ']);
 const rack = countsOf('UIXOTE');
 const r = rackSummary(dict, rack, 16, countsOf('AAA'), 4);
 assert.equal(r.length, 30);assert.equal(r[6], 0);
 assert.equal(r[14], wordReward('QUIXOTE'));
 assert.equal(r[18], wordReward('QUIXOTE'));
 assert.deepEqual(rack, countsOf('UIXOTE'));
});
test('cached expert rack potentials are independent of letter query order', () => {
 const dict = new Dict(['AX', 'TAX', 'AZ']);const rack = countsOf('A');
 const x = rackSummary(dict, rack, 23, countsOf('TTT'), 10);
 rackSummary(dict, rack, 25, countsOf('TT'), 9);
 assert.deepEqual(rackSummary(dict, rack, 23, countsOf('T'), 8), x);
});
test('exported tree inference respects split boundary and transforms log bids', () => {
 const model = { initial: Math.log(11), rate: 1, kind: 'bid', trees: [{ f: 0, t: 3, l: { v: Math.log(2) }, r: { v: 0 } }] };
 assert.ok(Math.abs(predict(model, [3]) - 21) < 1e-9);
 assert.ok(Math.abs(predict(model, [4]) - 10) < 1e-9);
});

test('tree thresholds use the same float32 feature precision as training', () => {
 const model = { initial: 0, rate: 1, kind: 'bid', trees: [{ f: 0, t: Math.fround(.7), l: { v: 1 }, r: { v: 2 } }] };
 assert.equal(predict(model, [.7]), Math.expm1(1));
});
