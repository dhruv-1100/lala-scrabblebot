import { test } from "node:test";
import assert from "node:assert/strict";
import { Dict } from "../engine/dict.js";
import { countsOf, wordReward } from "../engine/letters.js";
import { Valuer } from "./value.js";
import { DEFAULT_LALA } from "./lala.js";
const prices = new Float64Array(26).fill(1);
const params = { ...DEFAULT_LALA, kappa0: 0, kappa1: 0, rho: 0, leaveW: 0 };

test("last available Q completes QUIXOTE even with zero future Q probability", () => {
  const val = new Valuer(new Dict(["QUIXOTE"])).evaluate(
    countsOf("UIXOTE"), 16, countsOf("AAAAEEEE"), 10, prices, 0, params, 1);
  assert.equal(val.base, 0);
  assert.equal(val.withLetter, wordReward("QUIXOTE"));
});

test("plans cannot obtain more copies than remain unseen", () => {
  const val = new Valuer(new Dict(["EEL"])).evaluate(
    countsOf("L"), 0, countsOf("EAAA"), 20, prices, 0, params, 1);
  assert.equal(val.base, 0);
  assert.equal(val.withLetter, 0);
});

test("leftover duplicate is valued as the first remaining copy", () => {
  const val = new Valuer(new Dict(["AX"])).evaluate(
    countsOf("AAX"), 4, countsOf("EE"), 10, prices, 0,
    { ...params, kappa1: 0.1, dupDecay: 0.5 }, 1);
  assert.ok(Math.abs(val.base - (wordReward("AX") + 0.1)) < 1e-9);
});

test("joint valuation equals separately valuing the augmented rack", () => {
  const d = new Dict(["AX", "EEL", "QUIXOTE", "RETAINS"]);
  for (const [rack, letter] of [["AAX", "A"], ["EL", "E"], ["UIXOTE", "Q"], ["ETAINS", "R"]]) {
    const v = new Valuer(d);
    const p = { ...params, kappa1: 0.1 };
    const unseen = countsOf("AAAEEEEIIINRST");
    const joint = v.evaluate(countsOf(rack!), letter!.charCodeAt(0)-65, unseen, 8, prices, 0, p, 1);
    const separate = v.evaluate(countsOf(rack!+letter!), 25, unseen, 8, prices, 0, p, 1);
    assert.ok(Math.abs(joint.withLetter-separate.base) < 1e-9, rack);
  }
});
