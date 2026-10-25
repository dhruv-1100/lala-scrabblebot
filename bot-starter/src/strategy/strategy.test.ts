import { test } from "node:test";
import assert from "node:assert/strict";
import { Dict, loadDict } from "../engine/dict.js";
import { countsOf } from "../engine/letters.js";
import { Tracker } from "../engine/tracker.js";
import { Lala } from "./lala.js";
import { TUNED } from "./params.js";
import { runMatch } from "../sim/sim.js";
import { MarketBot, StarterBot, SimBot } from "../sim/agents.js";
import type { View } from "../sim/types.js";

const dict = loadDict();

function view(rack: string, letter: string, left: number, balance = 100): View {
  const t = new Tracker(0, [0, 1, 2, 3, 4, 5], countsOf(rack), "Vickrey", 5);
  t.onAuction(letter.charCodeAt(0) - 65, left - 1);
  return {
    auctionType: "Vickrey", me: 0, n: 6, round: 69 - left, letter: letter.charCodeAt(0) - 65,
    auctionsLeft: left, rack: countsOf(rack), balance, score: 0, tracker: t, wonLast: false,
  };
}

test("final auction: cash out everything, bid nothing", () => {
  const d = new Lala(dict, TUNED).act(view("RETAINSQ", "E", 1));
  assert.equal(d.bid, 0);
  assert.ok(d.words.includes("RETAINS") || d.words.join("").length >= 7);
});

test("second-to-last auction: spend otherwise worthless coins on gain or denial", () => {
  const helps = new Lala(dict, TUNED).act(view("ETAINS", "R", 2, 57));
  assert.equal(helps.bid, 57);
  const useless = new Lala(dict, TUNED).act(view("JJVV", "Q", 2, 57));
  assert.equal(useless.bid, 57);
});

test("bids are integers within balance and decisions are fast", () => {
  const lala = new Lala(dict, TUNED);
  for (const [r, l] of [["", "E"], ["AEIRS", "T"], ["QZXJK", "U"], ["EEEEII", "E"]] as const) {
    const d = lala.act(view(r, l, 40, 30));
    assert.ok(Number.isInteger(d.bid) && d.bid >= 0 && d.bid <= 30, `${r}+${l}: ${d.bid}`);
    assert.ok(d.ms < 50, `slow decision ${d.ms}ms`);
  }
});

test("cashes in a complete word when it beats holding it", () => {
  // Late, a held word may wait for a better extension, but it is always
  // cashed by the final auction.
  const d = new Lala(dict, TUNED).act(view("RETAINS", "E", 1, 20));
  assert.ok(d.words.some((w) => w.length >= 7), d.words.join(","));
  // QUIXOTE is worth far more than anything it could grow into.
  const q = new Lala(dict, TUNED).act(view("QUIXOTE", "E", 30, 20));
  assert.deepEqual(q.words, ["QUIXOTE"]);
});

test("simulated match conserves tiles and never submits an illegal action", () => {
  for (let seed = 1; seed <= 5; seed++) {
    const agents = [new Lala(dict, TUNED), new MarketBot(dict, seed), new StarterBot(dict), new SimBot(dict, "Aggressive", seed), new MarketBot(dict, seed + 9), new Lala(dict, TUNED)];
    const r = runMatch(dict, agents, { seed, record: true });
    assert.deepEqual(r.rejected, [0, 0, 0, 0, 0, 0]);
    const played = r.words.map((ws) => ws.join("").length);
    const sold = r.auctions!.filter((a) => a.winner !== null).length;
    const held = r.unplayed.reduce((a, b) => a + b, 0) + played.reduce((a, b) => a + b, 0);
    assert.equal(held, 30 + sold);
    assert.equal(r.auctions!.length, 98 - 30);
  }
});

test("v2 values a vowel at least as much as a 1-point consonant on a consonant-heavy rack", () => {
  const v2 = { ...TUNED, liveUse: 1, kappa1: 0.5, capMul: 1.25 };
  const lala = new Lala(dict, v2);
  const vowel = lala.act(view("BCNRTS", "E", 40, 100));
  const cons = lala.act(view("BCNRTS", "L", 40, 100));
  assert.ok(vowel.bid >= cons.bid, `E ${vowel.bid} < L ${cons.bid}`);
});

test("the price cap holds before the last 3 auctions (completion premium off)", () => {
  const v2 = { ...TUNED, liveUse: 1, kappa1: 0.5, capMul: 1.25, completeMul: 0 };
  const lala = new Lala(dict, v2);
  for (const [r, l] of [["ETAINS", "R"], ["QUIXOT", "E"], ["ZAXJ", "Q"]] as const) {
    const d = lala.act(view(r, l, 30, 200));
    const price = lala.prices(view(r, l, 30, 200))[l.charCodeAt(0) - 65]!;
    assert.ok(d.bid <= Math.floor(1.25 * price) + 1, `${r}+${l}: bid ${d.bid} price ${price}`);
  }
});

test("pays the completion premium for a letter that finishes a 7-letter word", () => {
  const lala = new Lala(dict, TUNED);
  const finish = lala.act(view("ETAINS", "R", 30, 100));
  const price = lala.prices(view("ETAINS", "R", 30, 100))[17]!;
  assert.ok(finish.bid >= Math.floor(1.4 * price), `bid ${finish.bid} < 1.4 x ${price}`);
});

test('memoized and uncached decisions agree, including affordability-dependent values', () => {
  for (const affordK of [0, 2]) {
    const fast = new Lala(dict, { ...TUNED, affordK, memoizeRack: true });
    const slow = new Lala(dict, { ...TUNED, affordK, memoizeRack: false });
    for (const [r, l] of [['AEINRST','E'],['ADDEEILNNOOSTU','X'],['QUIXOTE','E'],['EEEEII','A']]) {
      const v = view(r!, l!, 30, 35);
      const a=fast.act(v), b=slow.act(v);
      assert.deepEqual({words:a.words,bid:a.bid,value:a.value,marginal:a.marginal},
        {words:b.words,bid:b.bid,value:b.value,marginal:b.marginal});
    }
  }
});

test('liquidity rule can be restricted to full-multiplier words', async () => {
  const { Dict } = await import('../engine/dict.js');
  const small = new Dict(['RETAIN', 'RETAINS']);
  const p = { ...TUNED, starveBal:25, starveMinLen:7, playMargin:1e6 };
  assert.deepEqual(new Lala(small,p).act(view('RETAINS','Z',30,5)).words,['RETAINS']);
  assert.deepEqual(new Lala(small,p).act(view('RETAIN','Z',30,5)).words,[]);
});

test('completion-value bid is proportional to reward and remains affordable', async () => {
  const { Dict } = await import('../engine/dict.js');
  const small = new Dict(['QUIXOTE']);
  const params={...TUNED,capMul:0,completeMul:0,completeValue:0.5};
  assert.equal(new Lala(small,params).act(view('UIXOTE','Q',30,100)).bid,34);
  assert.equal(new Lala(small,params).act(view('UIXOTE','Q',30,13)).bid,13);
  assert.equal(new Lala(small,{...params,completeValue:0}).act(view('UIXOTE','Q',30,100)).bid,0);
});

test('last useful auction can spend income from words safe in both plans', async () => {
  const { Dict } = await import('../engine/dict.js');
  const small=new Dict(['AX','RETAINS']);
  const d=new Lala(small,TUNED).act(view('AXETAINS','R',2,10));
  assert.deepEqual(d.words,['AX']);
  assert.equal(d.bid,19); // 10 coins + 9 from AX; the live runtime rebids after acknowledgement
});

test('penultimate denial uses safe word income without sacrificing existing points', () => {
  const small = new Dict(['AX', 'RETAINS']);
  const v = view('AX', 'R', 2, 5);
  const opponent = v.tracker.opps.get(1)!;
  opponent.known = countsOf('ETAINS');opponent.balance = 13;
  const d = new Lala(small,TUNED).act(v);
  assert.deepEqual(d.words,['AX']);assert.equal(d.bid,14);
  assert.ok(d.bid>opponent.balance, 'safe AX income can deny the rival its 21-point RETAINS');
});

test('learned bids retain the configured completion premium', () => {
  const small = new Dict(['QUIXOTE']);
  const p = {...TUNED,expertPolicy:1,expertWordMode:1,completeMul:0,completeValue:1,playMargin:1000};
  const d = new Lala(small,p).act(view('UIXOTE','Q',30,100));
  assert.ok(d.bid>=69, `completion bid was overwritten: ${d.bid}`);
});
