import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Bandit } from "./bandit.js";

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bandit-")), "b.json");
const priors = [{ name: "base", n: 15, mean: 0.4 }, { name: "x", n: 8, mean: 0.3 }];

test("a match keeps its arm, across restarts", () => {
  const file = tmp();
  const a = new Bandit(file, priors);
  const arm = a.armFor(101n);
  for (let i = 0; i < 20; i++) assert.equal(a.armFor(101n), arm);
  assert.equal(new Bandit(file, priors).armFor(101n), arm);
});

test("results update only the assigned arm, once", () => {
  const file = tmp();
  const b = new Bandit(file, priors);
  const arm = b.armFor(7n);
  assert.ok(b.record(7n, 1));
  assert.equal(b.record(7n, 1), null); // duplicate end event
  assert.equal(b.record(999n, 1), null); // never assigned
  assert.match(new Bandit(file, priors).summary(), new RegExp(`${arm}: est [0-9.-]+ \\(1 live games`));
});

test("a clearly better arm ends up with most matches", () => {
  const b = new Bandit(tmp(), priors);
  let xCount = 0;
  for (let m = 0; m < 300; m++) {
    const arm = b.armFor(BigInt(m));
    if (arm === "x") xCount++;
    b.record(BigInt(m), arm === "x" ? 1 : 4); // x keeps winning, base keeps finishing 4th
  }
  assert.ok(xCount > 200, `x got only ${xCount} of 300`);
});
