#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-net --unstable-kv
// Write a file made by scripts/kv-export.ts into a Deno KV.
//
// The target is whatever Deno.openKv() is given: a file path for a server of
// your own (the same path you then run the shrine with, as SHRINE_KV_PATH), or
// a Deno Deploy database's KV Connect URL,
// https://api.deno.com/v2/databases/<DATABASE_ID>/connect, with
// DENO_KV_ACCESS_TOKEN set to an access token for the organization that owns
// it (that needs --allow-net --allow-env too). Existing entries under the same
// keys are overwritten; nothing else is touched.
//
// KV does not say how long an entry had left to live, so the ones the server
// writes to expire get their full lifetime again from the moment of import —
// chat lines two weeks, a finished duel a day, and so on (the table below
// mirrors the server's own). Everything else is kept with no expiry, as the
// server keeps it.
//
//   deno run --allow-read --allow-write --unstable-kv scripts/kv-import.ts shrine-export.ndjson /srv/shrine/shrine.db
//
// Run it against a server that is stopped, or not yet started: the shrine's
// counters (the room's seq, the pending count) are read once here and trusted.

const IN = Deno.args[0];
const TARGET = Deno.args[1];
if (!IN) {
  console.error("usage: kv-import.ts <export.ndjson> [kv path]");
  Deno.exit(1);
}

const DAY = 86_400_000;
// the lifetimes server.ts gives what it writes, by the key's first part
const TTL: Record<string, number> = {
  ev: 14 * DAY, msg: 14 * DAY, gift: 14 * DAY, rx: 14 * DAY,
  cas: 400 * DAY, shoppend: 400 * DAY, loan: 400 * DAY, loanboost: 400 * DAY, loanmax: 400 * DAY,
  bj: DAY / 4, beef: DAY / 4, mines: DAY / 4, dtalk: DAY / 4,
  dmconv: 30 * DAY, dmev: 30 * DAY, dmseq: 30 * DAY,
  duel: DAY, duelof: DAY, duelopen: DAY,
  raffle: 14 * DAY, raffle_in: 14 * DAY, raffle_paid: 14 * DAY, raffleq: 14 * DAY, rafflen: 14 * DAY,
  claimlog: 30 * DAY, claimnet: 30 * DAY,
  tiplog: 90 * DAY, tiplogu: 90 * DAY, tiplock: 7 * DAY,
  dmblock: 30 * DAY,
};

// the tags kvEnc() in server.ts writes, back into the real thing
function dec(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(dec);
  if (x && typeof x === "object") {
    const o = x as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length === 1) {
      const [t] = keys, v = o[t];
      if (t === "$bigint") return BigInt(String(v));
      if (t === "$u64") return new Deno.KvU64(BigInt(String(v)));
      if (t === "$bytes") return Uint8Array.from(atob(String(v)), (c) => c.charCodeAt(0));
      if (t === "$date") return new Date(String(v));
      if (t === "$num") return Number(v);
      if (t === "$map") return new Map((v as unknown[][]).map(([a, b]) => [dec(a), dec(b)]));
      if (t === "$set") return new Set((v as unknown[]).map(dec));
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) out[k] = dec(v);
    return out;
  }
  return x;
}

const kv = await Deno.openKv(TARGET);
const text = await Deno.readTextFile(IN);
let batch = kv.atomic(), inBatch = 0, total = 0, skipped = 0;
const now = Date.now();
async function flush() {
  if (!inBatch) return;
  const r = await batch.commit();
  if (!r.ok) throw new Error("a batch did not commit");
  batch = kv.atomic();
  inBatch = 0;
}
for (const line of text.split("\n")) {
  if (!line.trim()) continue;
  const e = JSON.parse(line) as { k: unknown[]; v: unknown };
  const key = dec(e.k) as Deno.KvKey;
  const value = dec(e.v);
  const head = String(key[0]);
  let ttl = TTL[head];
  // a sahur-watch penalty lives until its last part runs out, and a day more
  if (head === "claimpen" && value && typeof value === "object") {
    const p = value as Record<string, number>;
    const until = Math.max(Number(p.banUntil) || 0, Number(p.reduceUntil) || 0, Number(p.slowUntil) || 0);
    if (until <= now) {
      skipped++;
      continue;
    }
    ttl = until - now + DAY;
  }
  batch.set(key, value, ttl ? { expireIn: ttl } : undefined);
  inBatch++;
  total++;
  if (inBatch >= 50) await flush();
}
await flush();
kv.close();
console.log("imported " + total + " entries" + (skipped ? " (" + skipped + " spent penalties left behind)" : "") +
  " into " + (TARGET || "the default KV"));
