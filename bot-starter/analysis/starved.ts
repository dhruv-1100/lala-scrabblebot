// How often Lala sits nearly broke while holding a playable word, and what
// it costs: from the live decision log.
//   npx tsx analysis/starved.ts [sinceMatch] [maxCoins] [minLeft]
import * as fs from "node:fs";
import * as path from "node:path";
import { loadDict } from "../src/engine/dict.js";
import { countsOf } from "../src/engine/letters.js";
import { playable } from "../src/engine/words.js";
const since = Number(process.argv[2] ?? 3377), maxCoins = Number(process.argv[3] ?? 6), minLeft = Number(process.argv[4] ?? 14);
const d = loadDict();
const dec = fs.readdirSync("data/live").filter((f) => f.startsWith("decisions-"))
  .flatMap((f) => fs.readFileSync(path.join("data/live", f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)))
  .filter((x) => x.match >= since);
const ms = fs.readdirSync("data/live").filter((f) => f.startsWith("matches-"))
  .flatMap((f) => fs.readFileSync(path.join("data/live", f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));
const place = new Map(ms.map((m) => [m.match, m.place]));
const per = new Map<number, number>();
for (const x of dec) {
  if (x.balance >= maxCoins || x.left < minLeft || x.words.length) continue;
  const best = playable(d, countsOf(x.rack), 5, 1)[0];
  if (best === undefined || d.reward[best]! < 15) continue;
  per.set(x.match, (per.get(x.match) ?? 0) + 1);
}
const games = [...new Set(dec.map((x) => x.match))].filter((m) => place.has(m));
const hit = games.filter((m) => (per.get(m) ?? 0) >= 5), clean = games.filter((m) => (per.get(m) ?? 0) < 5);
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
console.log(`games ${games.length}; with 5+ rounds broke (<${maxCoins} coins, ${minLeft}+ left) while holding a 15+ point word: ${hit.length}`);
console.log(`  avg place in those games ${avg(hit.map((m) => place.get(m)!)).toFixed(2)} (wins ${hit.filter((m) => place.get(m) === 1).length}); other games ${avg(clean.map((m) => place.get(m)!)).toFixed(2)} (wins ${clean.filter((m) => place.get(m) === 1).length})`);
console.log(`  broke-but-holding rounds per affected game: ${avg(hit.map((m) => per.get(m)!)).toFixed(1)}`);
