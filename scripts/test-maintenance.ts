#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// Maintenance mode: one switch on /admin that shuts the shrine to everybody but
// the panel, so the database stops being read and written while it is on.
//
// While it is on, every route but /admin and /version answers 503 with
// {maintenance: true} — decided ahead of the IP cap's token lookup, so a shut
// shrine costs no KV read per request — and the clients put one resting screen
// over everything and stop polling. It goes off from the same panel, and every
// account is where it was.
//
//   ADMIN_KEY=devadminkey deno run --allow-net --allow-env --unstable-kv server.ts
//   ADMIN_KEY=devadminkey API=... deno run --allow-net --allow-env --allow-read scripts/test-maintenance.ts

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const API = (Deno.env.get("API") || "http://127.0.0.1:8000").replace(/\/$/, "");
const ADMIN = Deno.env.get("ADMIN_KEY") || "devadminkey";

function must(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}
// deno-lint-ignore no-explicit-any
type Any = any;
async function j(path: string, opt?: RequestInit) {
  const r = await fetch(API + path, opt);
  return { status: r.status, headers: r.headers, body: await r.json().catch(() => ({})) as Any };
}
const post = (path: string, obj: unknown) =>
  j(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(obj) });
const maint = (on: boolean, msg = "") => post("/admin/maint", { key: ADMIN, on, msg });

// ---- the source: the check comes before anything that can read KV ----
const server = await Deno.readTextFile(`${ROOT}/server.ts`);
const handle = server.slice(server.indexOf("async function handle("));
const gateAt = handle.indexOf("await maintState()");
must(gateAt > 0, "handle() must ask maintState()");
must(gateAt < handle.indexOf("requestIsAuthed(req, url)"), "the maintenance check must come before the IP cap's token lookup");
must(/function maintState\(\)[^]*?if \(Date\.now\(\) - maintAt < MAINT_TTL\) return Promise\.resolve\(maintKnown\);/.test(server),
  "maintState must answer from memory inside MAINT_TTL");

// ---- the clients: every answer goes past the switch, and it still parses ----
const win: { Shrine: Record<string, Any> } = { Shrine: { LBL: { POPUP: "p", ORIGINALS: "o", WEB_VEIL: "w" } } };
for (const f of ["chat", "casino"]) {
  new Function("window", "location", await Deno.readTextFile(`${ROOT}/assets/js/shrine/${f}.js`))(
    win, { href: "https://example.test/", search: "" },
  );
}
const chatJs = win.Shrine.CHAT_JS as string, casinoJs = win.Shrine.CASINO_JS as string;
new Function(chatJs);
new Function(casinoJs);
must(chatJs.includes("function api(p,opt){return fetch(API+p,opt).then(function(r){return r.json().catch(function(){return {};});}).then(function(j){if(j&&j.maintenance===true)resting(j);return j;});}"),
  "the chat's api() must hand a maintenance answer to resting()");
must(chatJs.includes('function resting(j){lockOut({reason:"rest",why:j&&j.msg});}'), "resting() must put up the lock screen");
must(chatJs.includes("window.__shrineRest=function(s){if(s&&s.maintenance===true)resting(s);};"), "the casino needs its own way to put the resting screen up");
must(casinoJs.includes("if(window.__shrineRest)window.__shrineRest(d);"), "and the casino must use it");
must(chatJs.includes('if(LOCKED.reason==="rest"){if(!pageHidden())statusT=setTimeout(refreshGate,30000);return;}'),
  "a resting shrine is asked about every 30s, not every 5s");
must(chatJs.includes("the shrine is resting"), "the resting screen needs its own words");
must(/function jget\(p\)\{[^\n]*\.then\(resting\);\}/.test(casinoJs) && /function jpost\(p,b\)\{[^\n]*\.then\(resting\);\}/.test(casinoJs),
  "both casino fetch helpers must pass answers through resting()");
const embed = await Deno.readTextFile(`${ROOT}/embed/chat.html`);
for (const s of embed.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) new Function(s[1]);
must(embed.includes('if (j && j.maintenance === true) showBan({ reason: "rest", msg: j.msg });'),
  "the chat embed must show its resting screen on a maintenance answer");

// ---- live ----
must((await maint(false)).body?.ok, "could not make sure maintenance starts off");
const name = "maint" + Math.random().toString(36).slice(2, 8);
let a = await post("/apply", { username: name, application: "maintenance test" });
for (let i = 0; a.body?.error === "slow down" && i < 15; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  a = await post("/apply", { username: name, application: "maintenance test" });
}
const token = a.body?.token as string;
must(!!token, "apply failed: " + JSON.stringify(a.body));
const pend = await j("/admin/pending?key=" + encodeURIComponent(ADMIN));
const id = (pend.body.pending as { username: string; id: string }[] || []).find((x) => x.username === name)?.id;
must(!!id, name + " not pending");
must((await post("/admin/decide", { key: ADMIN, id, action: "approve" })).body?.ok, "approve failed");
must((await j("/status?token=" + token)).body?.status === "approved", "the member should be approved before the switch");

try {
  // a wrong key flips nothing
  must((await post("/admin/maint", { key: "nope", on: true })).status === 403, "a wrong key must not turn it on");
  must((await j("/admin/maint", { headers: { "x-admin-key": "nope" } })).status === 403, "a wrong key must not read it");
  must((await j("/status?token=" + token)).status === 200, "a refused flip must leave the shrine open");

  const on = await maint(true, "back after lunch");
  must(on.body?.ok && on.body.on === true && on.body.msg === "back after lunch" && on.body.since > 0, "turning it on: " + JSON.stringify(on.body));
  const since = on.body.since as number;

  // every member route is shut, with the reason and the message on it
  const shut: [string, Promise<{ status: number; headers: Headers; body: Any }>][] = [
    ["/status", j("/status?token=" + token)],
    ["/events", j("/events?since=0&token=" + token)],
    ["/cas/me", j("/cas/me?token=" + token)],
    ["/login", post("/login", { token })],
    ["/apply", post("/apply", { username: name + "x", application: "while shut" })],
    ["an unknown path", j("/no/such/thing")],
  ];
  for (const [what, p] of shut) {
    const r = await p;
    must(r.status === 503, what + " should be 503 while resting, got " + r.status);
    must(r.body?.maintenance === true && r.body.error === "maintenance", what + " should say maintenance: " + JSON.stringify(r.body));
    must(r.body.msg === "back after lunch", what + " should carry tung's message");
    must(r.headers.get("access-control-allow-origin") === "*", what + " needs CORS or the page cannot read why");
    must(r.headers.get("retry-after") === "30", what + " should say when to ask again");
  }

  // what stays open: the panel, its routes, /version and preflight
  must((await j("/version")).body?.v, "/version must still answer");
  must((await fetch(API + "/admin")).status === 200, "the panel's door must still open");
  const adm = await fetch(API + "/admin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: ADMIN }) });
  const html = await adm.text();
  must(adm.status === 200 && html.includes('id="pane-maint"') && html.includes('data-pane="maint"'), "the panel must have the Maintenance pane");
  must(html.includes("refreshVeil();refreshMaint();"), "the panel must load the switch with everything else");
  for (const s of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Function(s[1]);
  must((await j("/admin/veil", { headers: { "x-admin-key": ADMIN } })).status === 200, "other admin routes must keep working");
  const read = await j("/admin/maint", { headers: { "x-admin-key": ADMIN } });
  must(read.body?.on === true && read.body.msg === "back after lunch" && read.body.since === since, "reading it back: " + JSON.stringify(read.body));
  must((await fetch(API + "/status", { method: "OPTIONS" })).status < 300, "preflight must still pass");

  // changing the message keeps the time it went on
  const again = await maint(true, "back tonight");
  must(again.body?.since === since && again.body.msg === "back tonight", "a new message must not reset since: " + JSON.stringify(again.body));
  must((await j("/status?token=" + token)).body?.msg === "back tonight", "members must see the new message");

  // off again: the member is exactly as they were, and nothing applied while shut
  const off = await maint(false, "back tonight");
  must(off.body?.ok && off.body.on === false && off.body.since === 0, "turning it off: " + JSON.stringify(off.body));
  must(off.body.msg === "back tonight", "the message is kept for next time");
  const st = await j("/status?token=" + token);
  must(st.status === 200 && st.body?.status === "approved" && st.body.username === name, "the member must come back as they were: " + JSON.stringify(st.body));
  const pend2 = await j("/admin/pending?key=" + encodeURIComponent(ADMIN));
  must(!(pend2.body.pending as { username: string }[] || []).some((x) => x.username === name + "x"), "an application sent while resting must not have been written");
} finally {
  await maint(false);
}

console.log("maintenance OK");
