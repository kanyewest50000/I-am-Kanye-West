#!/usr/bin/env -S deno run --allow-net --allow-env --allow-write
// Pull the whole shrine database out of a running server, into one file.
//
// The server hands its own data over: POST /admin/export, a page at a time,
// with the admin key — no Deno login or access token needed. This walks the
// pages and writes one entry per line (NDJSON).
// scripts/kv-import.ts writes that file into any other Deno KV — a new Deno
// account, or a plain file on a server of your own.
//
// The file holds everything, login keys included: treat it like the admin key.
//
//   API=https://tung.takelearningoffline.deno.net ADMIN_KEY=... \
//     deno run --allow-net --allow-env --allow-write scripts/kv-export.ts shrine-export.ndjson

const API = (Deno.env.get("API") || "http://127.0.0.1:8000").replace(/\/$/, "");
const ADMIN = Deno.env.get("ADMIN_KEY") || "";
const OUT = Deno.args[0] || "shrine-export.ndjson";
if (!ADMIN) {
  console.error("set ADMIN_KEY");
  Deno.exit(1);
}

const file = await Deno.open(OUT, { write: true, create: true, truncate: true });
const enc = new TextEncoder();
let cursor = "", pages = 0, total = 0;
const byPrefix = new Map<string, number>();
for (;;) {
  let body: { ok?: boolean; entries?: { k: unknown[]; v: unknown }[]; cursor?: string; error?: string } = {};
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await fetch(API + "/admin/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: ADMIN, cursor }),
    });
    body = await r.json().catch(() => ({}));
    if (r.ok) break;
    if (r.status === 403) {
      console.error("the server refused the key");
      Deno.exit(1);
    }
    await new Promise((res) => setTimeout(res, 1000 * (attempt + 1)));
  }
  if (!body.ok || !Array.isArray(body.entries)) {
    console.error("export failed: " + JSON.stringify(body).slice(0, 300));
    Deno.exit(1);
  }
  for (const e of body.entries) {
    await file.write(enc.encode(JSON.stringify(e) + "\n"));
    const p = String(e.k[0]);
    byPrefix.set(p, (byPrefix.get(p) || 0) + 1);
  }
  total += body.entries.length;
  pages++;
  if (!body.cursor) break;
  cursor = body.cursor;
}
file.close();
console.log("wrote " + total + " entries in " + pages + " pages to " + OUT);
for (const [p, n] of [...byPrefix.entries()].sort((a, b) => b[1] - a[1])) console.log("  " + p.padEnd(14) + n);
