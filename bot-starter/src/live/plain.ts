// Turns SDK rows (bigints, timestamps, identities, enums) into plain JSON.
export function plain(v: unknown): unknown {
  if (typeof v === "bigint") return Number(v);
  if (v === null || v === undefined) return v ?? null;
  if (Array.isArray(v)) return v.map(plain);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("microsSinceUnixEpoch" in o) return Number(o.microsSinceUnixEpoch as bigint);
    if (typeof (o as { toHexString?: () => string }).toHexString === "function")
      return (o as { toHexString: () => string }).toHexString();
    if ("tag" in o && Object.keys(o).length <= 2) return o.tag;
    const r: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(o)) r[k] = plain(x);
    return r;
  }
  return v;
}
