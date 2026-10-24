import * as fs from "node:fs";
import * as path from "node:path";

export const RAW = path.resolve(process.env.RAW_DIR ?? "data/raw");

export function load<T = any>(table: string): T[] {
  const p = path.join(RAW, `${table}.jsonl`);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

export function groupBy<T, K>(xs: T[], key: (x: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const x of xs) {
    const k = key(x);
    let arr = m.get(k);
    if (!arr) m.set(k, (arr = []));
    arr.push(x);
  }
  return m;
}

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
export const quantile = (xs: number[], q: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
};
