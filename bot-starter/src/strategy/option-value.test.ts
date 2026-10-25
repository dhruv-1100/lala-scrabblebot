import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Dict } from '../engine/dict.js';
import { countsOf, wordReward } from '../engine/letters.js';
import { DEFAULT_LALA } from './lala.js';
import { OptionValuer } from './option-value.js';
const p = { ...DEFAULT_LALA, maxMissing: 3, kappa0: 0, kappa1: 0, rho: 0, leaveW: 0, winP: 1 };
const prices = new Float64Array(26).fill(1);
test('recourse keeps the option to use either available completion', () => {
 const d = new Dict(['AX', 'AZ']);
 const r = new OptionValuer(d).evaluate(countsOf('A'), 16, countsOf('XZ'), 1, prices, 0, p, 1);
 assert.ok(r.base >= Math.min(wordReward('AX'), wordReward('AZ')));
 assert.ok(r.base <= Math.max(wordReward('AX'), wordReward('AZ')));
});
test('recourse includes the current tile even if no future copy exists', () => {
 const r = new OptionValuer(new Dict(['QUIXOTE'])).evaluate(countsOf('UIXOTE'), 16, countsOf('AAAA'), 4, prices, 0, p, 1);
 assert.equal(r.base, 0);assert.equal(r.withLetter, wordReward('QUIXOTE'));
});
test('recourse cannot invent duplicate tiles or lose value on acquiring a tile', () => {
 const d = new Dict(['EEL', 'EL']);
 const r = new OptionValuer(d).evaluate(countsOf('L'), 0, countsOf('E'), 10, prices, 0, p, 1);
 assert.equal(r.base, wordReward('EL'));assert.ok(r.withLetter >= r.base);
});
test('joint and separate recourse evaluations use identical future worlds', () => {
 const d = new Dict(['AX', 'AZ', 'TAX', 'ACT']);
 const v = new OptionValuer(d), unseen = countsOf('XXZZTTCC');
 const joint = v.evaluate(countsOf('A'), 19, unseen, 3, prices, 0, p, 1);
 const separate = v.evaluate(countsOf('AT'), 4, unseen, 3, prices, 0, p, 1);
 assert.equal(joint.withLetter, separate.base);
});
