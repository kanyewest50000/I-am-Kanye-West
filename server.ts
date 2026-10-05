// Shrine of Tung backend — HTTP-polling chat with history + application auth.
// Storage: Deno KV (persistent, free on Deno Deploy). No WebSockets.
//
// Set these in the Deno Deploy dashboard (Settings -> Environment Variables):
//   SHOP_WEBHOOK_URL         where shop redemptions are posted (optional)
//   APPLICATION_WEBHOOK_URL  where new applications are posted (optional)
//   ADMIN_KEY                password for the /admin page (required to approve)
//   WISDOM_MIN_MS/_MAX_MS    gap between two Wisdoms of Tung (optional, 45m/2h)
//   WISDOM_GIFT_CHANCE       odds a wisdom is a giveaway instead (optional, 0.2)
//   WISDOM_GIFT_AMOUNT       sahurs a giveaway pays the first claimant (optional, 50)
//   PROXY_URL                where the web veil actually goes (optional)
//
// Endpoints (JSON, CORS-open):
//   POST /apply         {username, application}          -> {token, status}
//   POST /login         {token}                          -> {token, status, username}
//   GET  /status?token=                                   -> {status, username}
//   GET  /events?since=&token=                            -> {events, cursor}
//   POST /send          {token, id, text, reply}          -> {ok, ts}
//   POST /react         {token, id, e, op, eid}           -> {ok}
//   POST /delete        {token, id}                       -> {ok, id}  (your own line, or any line for a moderator)
//   POST /dm/delete     {token, with, seq}                -> {ok, seq} (your own DM line)
//   GET  /cas/resume?token=                               -> {ok, game, ...} an unfinished board
//   GET  /bank?token=                                     -> {ok, owed, cap, canBorrow, ...}
//   POST /bank/borrow   {token, amount}                   -> {ok, borrowed, owed, balance}
//   POST /bank/repay    {token, amount?}                  -> {ok, paid, owed, balance}
//   GET  /tip/profile?token=&user=                        -> {username, createdAt, balance}
//   POST /tip           {token, to, amount}               -> {ok, amount, fromBalance, toBalance, to}
//   GET  /admin                                           -> admin page (html)
//   GET  /admin/pending?key=                              -> {pending:[...]}
//   GET  /admin/chat?key=&since=                          -> {messages:[...], cursor, dels?} last HISTORY chat lines,
//                                                            or only what came after `since`
//   POST /admin/clearchat {key}                           -> {ok, cleared}
//   POST /admin/purgegone {key}                           -> {ok, accounts, conversations, lines}
//   POST /admin/decide  {key, id, action:"approve"|"reject"} -> {ok, status}
//   POST /admin/ban     {key, id, banned}                 -> {ok, banned}      (whole shrine)
//   POST /admin/chatban {key, id, chatBanned}             -> {ok, chatBanned}  (chat only)
//   POST /admin/mod     {key, id, mod}                    -> {ok, mod}         (delete msgs)
//   POST /admin/loanmax {key, id, max}                    -> {ok, loanMax}     (null = default)
//   POST /admin/loanboost {key, id, extra}                -> {ok, boost}       (spent on one loan)
//   POST /admin/setdebt {key, id, owed}                   -> {ok, owed}        (0 wipes it)
//   GET  /veil?token=                                     -> {live, allowed, url?}
//   POST /gift/claim    {token, id, cli?}                 -> {ok, amount, balance, by}
//   POST /admin/watch/config {key, config?}               -> {ok, config, names, defaults} (sahur watch)
//   POST /admin/watch/flags  {key}                        -> {ok, open, closed}  (the review queue)
//   POST /admin/watch/scan   {key}                        -> {ok, looked, flagged}
//   POST /admin/watch/user   {key, id}                    -> {ok, logs, nets, hits, penalty, flag, ...}
//   POST /admin/watch/punish {key, id, ban?, reduce?, slow?, takeBack?, note?} -> {ok, penalty, taken, verdict}
//   POST /admin/watch/dismiss {key, id, quietDays}        -> {ok, quietDays}
//   POST /admin/watch/lift   {key, id}                    -> {ok}
//   POST /raffle/enter  {token, id}                       -> {ok, already, entries, endsAt}  (a giveaway with entries)
//   POST /admin/raffle/create {key, text?, amount, winners, minutes} -> {ok, raffle}
//   POST /admin/raffle/list   {key}                       -> {ok, raffles}
//   POST /admin/raffle/entries {key, id}                  -> {ok, names}
//   POST /admin/raffle/end    {key, id}                   -> {ok, raffle}  (roll it now)
//   POST /admin/raffle/cancel {key, id}                   -> {ok, raffle}  (nobody wins)
//   POST /admin/export  {key, cursor?, limit?}            -> {ok, entries:[{k,v}], cursor}  (the whole KV, paged)
//   POST /admin/tips    {key, user?, cursor?, limit?}     -> {ok, tips, cursor, sent?, got?}  (member-to-member sends)
//   GET  /duel/list?token=                                -> {open:[...], mine, balance}
//   POST /duel/create   {token, game, bet, seats?}        -> {ok, duel, balance}
//   POST /duel/cancel   {token, id}                       -> {ok, refunded, balance}
//   POST /duel/join     {token, id}                       -> {ok, duel, balance}
//   POST /duel/call     {token, id}                       -> {ok, duel, balance}   (seat tung)
//   POST /duel/confirm  {token, id}                       -> {ok, duel, balance}
//   POST /duel/move     {token, id, move}                 -> {ok, duel, balance}
//   GET  /duel/state?token=&id=                           -> {ok, duel, talk, balance}
//   POST /duel/say      {token, id, text}                 -> {ok, talk}
//   GET  /admin/veil?key=                                 -> {live, configured}
//   POST /admin/veil    {key, live}                       -> {ok, live, configured}
//   POST /admin/veiluser {key, id, allowed}               -> {ok, veil}
//   GET  /admin/maint?key=                                -> {on, msg, since}
//   POST /admin/maint   {key, on, msg?}                   -> {ok, on, msg, since}
//        (while it is on, everything but /admin and /version answers
//         503 {error:"maintenance", maintenance:true, msg} without reading KV)
//   POST /admin/talk/list   {key}                         -> {convs}           (tung's inbox)
//   POST /admin/talk/thread {key, user}                   -> {msgs}            (marks his side read)
//   POST /admin/talk/send   {key, user, text}             -> {ok, msg}         (speaks as tung)

// Deno.openKv() with no argument keeps its database in a per-location cache
// directory, which means every run on one machine shares it. SHRINE_KV_PATH
// lets a test run point at a file of its own so one run cannot inherit the
// last one's chat history, wisdom clock or balances. Unset in production, where
// Deno Deploy provides the database.
const kv = await Deno.openKv(Deno.env.get("SHRINE_KV_PATH") || undefined);
// Two separate Discord webhooks so redemptions and applications land in their
// own channels. Either can be unset; that kind of notification just goes quiet.
const SHOP_WEBHOOK = Deno.env.get("SHOP_WEBHOOK_URL") || "";
const APPLICATION_WEBHOOK = Deno.env.get("APPLICATION_WEBHOOK_URL") || "";
const ADMIN_KEY = Deno.env.get("ADMIN_KEY") || "";
// Where the web veil goes once it is opened. Kept in the environment rather
// than in the static repo so the destination is not sitting in public source,
// and handed to a member only when the global switch AND that member's own
// veil flag are both on.
const PROXY_URL = Deno.env.get("PROXY_URL") || "";
const HISTORY = 500; // number of recent events retained (hard cap)
const OPEN_MSGS = 100; // a fresh /events?since=0 only ships this many chat lines
const MSG_MAX = 3; // chat messages one account may post
const MSG_WINDOW_MS = 6000; // ...within this window, before /send starts refusing

// gn-math HTML loaders live on GitHub Pages at games/g/, pinned to
// 9b343737669dd2067dd6cd731859a99008772388 (see scripts/refresh-games.sh).
// GET /g/ used to re-proxy those pages through Deno and is gone so scrapers
// cannot burn quota. This process does not serve the static repo.
const TTL_MS = 14 * 24 * 60 * 60 * 1000; // messages auto-expire after 2 weeks

// ---------------------------------------------------------------------------
// Tung's Casino — FUN-MONEY ONLY. "Sahurs" have no cash value, cannot be bought,
// and cannot be cashed out. Sahurs normally enter circulation only through the
// Shrine of Sahur faucet (a free claim every 2h). Admins can VIEW balances and,
// as a moderation tool (e.g. resetting an exploiter who found a bug), SET a
// balance to an exact value via /admin/setbal — an explicit, key-gated action.
// Every outcome is decided here on the server with crypto RNG, so nothing about a
// bet, a shuffle, a mine layout, or a crash point is manipulable from the client.
const HOUSE = 0.999;                      // 0.1% house edge baked into fair payouts (blackjack has its own fixed payouts and is unaffected)
const FAUCET_AMOUNT = 10;                 // sahurs per claim
const FAUCET_INTERVAL = 2 * 60 * 60 * 1000; // every 2 hours
const MIN_BET = 0.1;                      // smallest allowed wager
const MAX_BET = 100000;                   // sanity cap
const CAS_TTL = 400 * 24 * 60 * 60 * 1000;   // balances persist ~13 months of inactivity

// ---------------------------------------------------------------------------
// THE BANK OF SAHUR SAHUR SAHUR — the only place sahurs are lent.
//
// Borrow up to your cap, and what you owe is the loan plus ten percent. You can
// hand it back whenever you like; if you do not, the bank helps itself to half
// of every faucet claim until the debt is square. That is the whole product.
//
// One debt at a time. Topping a loan up would mean charging interest on
// interest, or tracking each slice's own rate, and neither is worth it for a
// tenner — so the bank wants the last one settled before it writes another.
const LOAN_MAX_DEFAULT = 25;    // most a member may borrow, before any override
const LOAN_INTEREST = 0.10;     // what the bank puts on top, once, at signing
const LOAN_GARNISH = 0.5;       // share of a faucet claim it takes while a debt stands
const LOAN_TTL = CAS_TTL;       // a debt keeps as long as the balance it is against
const GAME_TTL = 6 * 60 * 60 * 1000;      // an abandoned in-progress hand self-expires

// Casino KV key-space (layered on top of the chat key-space above):
//   ["cas", id]        -> {bal, lastClaim}   a user's sahur balance + faucet clock
//   ["loan", id]       -> {principal, owed, ts}  what the bank is still owed
//   ["loanmax", id]    -> number              that member's own borrowing cap (standing)
//   ["loanboost", id]  -> number              a one-off extra, spent by the next loan
//   ["bj", id]         -> blackjack hand in progress (deleted when it resolves)
//   ["mines", id]      -> mines board in progress
//   ["beef", id]       -> beef (crash-chicken) walk in progress
//   ["shopitem", itemId] -> {id,name,desc,price,active,ts}  a redeemable shop entry
//   ["shoppend", uid, rid] -> unfinished redeem (paid, still owes an answer)
// One active hand per game per user; starting a new one replaces the old.

// crypto-strong float in [0,1).
// 53 bits of entropy = the top 21 bits of the first word (a[0] >>> 11) used as the
// high half, plus all 32 bits of the second. 21 + 32 = 53, so the numerator is
// always < 2^53 and the quotient lands in [0,1). (Using all 32 bits of a[0] here
// would overflow to ~2^11 and break every game — do not "simplify" this.)
function rnd(): number {
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  return ((a[0] >>> 11) * 0x100000000 + a[1]) / 0x20000000000000;
}
function rndInt(n: number): number { return Math.floor(rnd() * n); }
function round2(n: number): number { return Math.round(n * 100) / 100; }
// Payouts are FLOORED, never rounded, and are always computed from the exact
// multiplier rather than the 2dp one shown to the player. Rounding both the
// multiplier and then the payout upward compounds: at the 0.10 minimum stake
// that pushed dice roll-under-94 to a 103% return, i.e. a farmable +EV bet.
// Flooring guarantees the edge can never be rounded away at any stake.
function floor2(n: number): number { return Math.floor(n * 100 + 1e-9) / 100; }
function payoutOf(bet: number, exactMult: number): number { return floor2(bet * exactMult); }

// Look a user-supplied key up in a config map WITHOUT walking the prototype
// chain. Plain `MAP[key]` lets "__proto__" resolve to Object.prototype, which is
// truthy — that slipped past a `if (!cfg)` guard and produced NaN multipliers
// that then corrupted balances. Always route untrusted keys through this.
// deno-lint-ignore no-explicit-any
function pick<T>(map: Record<string, T>, key: any): T | null {
  if (typeof key !== "string" && typeof key !== "number") return null;
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key as string] : null;
}

// bet validation shared by every game. casino callers surface wagerError() so a
// stake under the floor or over the ceiling is named, not dumped as "bad bet".
function readWager(v: unknown): { bet: number } | { error: string } {
  const n = Number(v);
  if (!Number.isFinite(n)) {
    return { error: "tung does not wager ghosts. put a real number on the felt." };
  }
  const b = round2(n);
  if (b < MIN_BET) {
    return { error: "that offering is beneath the altar. the floor is " + MIN_BET.toFixed(1) + " sahurs. tung counted." };
  }
  if (b > MAX_BET) {
    return { error: "even tung tung god has a ceiling. " + MAX_BET + " sahurs is it. sit down." };
  }
  return { bet: b };
}
function wagerError(v: unknown): string {
  const w = readWager(v);
  return "error" in w ? w.error : "tung does not wager ghosts. put a real number on the felt.";
}
function parseBet(v: unknown): number | null {
  const w = readWager(v);
  return "bet" in w ? w.bet : null;
}

// deno-lint-ignore no-explicit-any
async function getCas(id: string): Promise<{ bal: number; lastClaim: number }> {
  const r = await kv.get<{ bal: number; lastClaim: number }>(["cas", id]);
  const v = r.value ?? { bal: 0, lastClaim: 0 };
  // heal a balance that was ever written as NaN/Infinity so it can't linger as
  // an "always solvent" record (see the finite guards in adjustBalance below)
  if (!Number.isFinite(v.bal)) return { bal: 0, lastClaim: Number.isFinite(v.lastClaim) ? v.lastClaim : 0 };
  return v;
}

// Atomic balance change. delta may be negative (a wager). Returns the new balance,
// or null if the balance would go negative (insufficient funds) — the check+commit
// loop makes double-spends from concurrent requests impossible.
async function adjustBalance(id: string, delta: number): Promise<number | null> {
  // A non-finite delta must never reach the store: `NaN < -1e-9` is false, so the
  // overdraw guard below would pass it, and Math.max(0, NaN) is NaN — which reads
  // as permanently solvent and lets a player bet without limit.
  if (!Number.isFinite(delta)) return null;
  for (;;) {
    const cur = await kv.get<{ bal: number; lastClaim: number }>(["cas", id]);
    const rec = cur.value ?? { bal: 0, lastClaim: 0 };
    const base = Number.isFinite(rec.bal) ? rec.bal : 0;
    const nb = round2(base + delta);
    if (!Number.isFinite(nb) || nb < -1e-9) return null; // would overdraw or corrupt
    const res = await kv.atomic().check(cur)
      .set(["cas", id], { ...rec, bal: Math.max(0, nb) }, { expireIn: CAS_TTL }).commit();
    if (res.ok) return Math.max(0, nb);
  }
}

// ---------------------------------------------------------------------------
// Claiming an in-progress game (mines / beef / blackjack).
//
// Every one of those games ends the same way: read the stored hand, work out
// what it pays, delete it, credit the player. Done as three separate steps that
// is a money printer — N requests all read the same live hand, all pass the
// "is there a game?" guard, and all credit the payout, so one 10 sahur bet can
// be cashed out eight times for eight payouts. Measured, before this existed:
// 8 of 8 concurrent cashouts paid, and a blackjack stand paid 120 on a hand
// worth 20.
//
// So the delete and the credit ride in ONE commit, guarded by a check on the
// game entry itself. Whoever commits first takes the record with them; every
// racing duplicate finds its check stale and is told there is no game. These
// two are the ONLY way a game record may be ended — never `kv.delete` a live
// hand next to an `adjustBalance`.
// deno-lint-ignore no-explicit-any
async function claimGame(key: Deno.KvKey, entry: Deno.KvEntryMaybe<any>): Promise<boolean> {
  if (!entry.value) return false;
  return (await kv.atomic().check(entry).delete(key).commit()).ok;
}
// Claim it AND pay it. Returns the new balance, or null if somebody else got
// there first (in which case nothing was written and nothing was paid).
// deno-lint-ignore no-explicit-any
async function settleGame(
  key: Deno.KvKey,
  entry: Deno.KvEntryMaybe<any>,
  uid: string,
  payout: number,
): Promise<number | null> {
  if (!entry.value) return null;
  const pay = Number.isFinite(payout) && payout > 0 ? payout : 0;
  for (;;) {
    const cur = await kv.get<{ bal: number; lastClaim: number }>(["cas", uid]);
    const rec = cur.value ?? { bal: 0, lastClaim: 0 };
    const base = Number.isFinite(rec.bal) ? rec.bal : 0;
    const nb = round2(base + pay);
    if (!Number.isFinite(nb) || nb < 0) return null;
    const res = await kv.atomic()
      .check(entry)
      .check(cur)
      .delete(key)
      .set(["cas", uid], { ...rec, bal: nb }, { expireIn: CAS_TTL })
      .commit();
    if (res.ok) return nb;
    // Two different losses look the same from here, so ask which it was: if the
    // game record has moved, another request has already settled this hand and
    // we must not pay. If only the balance moved, try again.
    const again = await kv.get(key);
    if (again.versionstamp !== entry.versionstamp) return null;
  }
}

// Resolve an approved member by username (case-insensitive). Returns null if the
// name is free, pending, rejected, or otherwise not tippable.
// deno-lint-ignore no-explicit-any
async function findApprovedByUsername(username: string): Promise<any | null> {
  const lower = clip(username, 24).toLowerCase();
  if (!lower) return null;
  const name = await kv.get<string>(["name", lower]);
  if (!name.value) return null;
  // deno-lint-ignore no-explicit-any
  const app = await kv.get<any>(["app", name.value]);
  if (!app.value || app.value.status !== "approved") return null;
  return app.value;
}

// Atomic tip/donation: debit `fromId` and credit `toId` in ONE Deno KV transaction
// so a concurrent double-spend cannot invent sahurs, and a crash mid-transfer cannot
// debit without credit. Optional tipId adds an idempotency lock so retries cannot
// double-pay. Returns new balances, "insufficient", or null for bad amount.
// Every sahur one member sends another, written down in the commit that moves
// it — so a send that happened is always logged, a retried one (same tipId) is
// never logged twice, and nothing else writes here. The panel's "Sahur
// transfers" pane reads it: all of it newest first, or one member's side of it
// through the per-member index. Credits from the panel are not transfers and do
// not appear.
//   ["tiplog", ts, rid]         -> TipLog
//   ["tiplogu", uid, ts, rid]   -> TipLog   (once under the sender, once under the receiver)
type TipLog = {
  ts: number; amount: number;
  from: string; fromId: string; to: string; toId: string;
  fromAfter: number; toAfter: number;
};
const TIPLOG_TTL = 90 * 24 * 60 * 60 * 1000;

async function transferBalance(
  fromId: string,
  toId: string,
  amount: number,
  tipId?: string,
  names?: { from: string; to: string },
): Promise<{ from: number; to: number; replay?: boolean } | "insufficient" | null> {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (fromId === toId) return null;
  const TIP_LOCK_TTL = 7 * 24 * 60 * 60 * 1000;
  for (;;) {
    if (tipId) {
      const lock = await kv.get<{ from: string; to: string; amount: number }>(["tiplock", tipId]);
      if (lock.value) {
        return {
          from: round2((await getCas(fromId)).bal),
          to: round2((await getCas(toId)).bal),
          replay: true,
        };
      }
    }
    const fromCur = await kv.get<{ bal: number; lastClaim: number }>(["cas", fromId]);
    const toCur = await kv.get<{ bal: number; lastClaim: number }>(["cas", toId]);
    const fromRec = fromCur.value ?? { bal: 0, lastClaim: 0 };
    const toRec = toCur.value ?? { bal: 0, lastClaim: 0 };
    const fromBase = Number.isFinite(fromRec.bal) ? fromRec.bal : 0;
    const toBase = Number.isFinite(toRec.bal) ? toRec.bal : 0;
    const fromNb = round2(fromBase - amount);
    const toNb = round2(toBase + amount);
    if (!Number.isFinite(fromNb) || fromNb < -1e-9) return "insufficient";
    if (!Number.isFinite(toNb) || toNb < 0) return null;
    let op = kv.atomic()
      .check(fromCur)
      .check(toCur)
      .set(["cas", fromId], { ...fromRec, bal: Math.max(0, fromNb) }, { expireIn: CAS_TTL })
      .set(["cas", toId], { ...toRec, bal: Math.max(0, toNb) }, { expireIn: CAS_TTL });
    if (tipId) {
      const lock = await kv.get(["tiplock", tipId]);
      op = op.check(lock).set(["tiplock", tipId], {
        from: fromId, to: toId, amount, ts: Date.now(),
      }, { expireIn: TIP_LOCK_TTL });
    }
    if (names) {
      const ts = Date.now(), r = rid(4);
      const rec: TipLog = {
        ts, amount, from: names.from, fromId, to: names.to, toId,
        fromAfter: Math.max(0, fromNb), toAfter: Math.max(0, toNb),
      };
      op = op.set(["tiplog", ts, r], rec, { expireIn: TIPLOG_TTL })
        .set(["tiplogu", fromId, ts, r], rec, { expireIn: TIPLOG_TTL })
        .set(["tiplogu", toId, ts, r], rec, { expireIn: TIPLOG_TTL });
    }
    const res = await op.commit();
    if (res.ok) return { from: Math.max(0, fromNb), to: Math.max(0, toNb) };
  }
}

type Loan = { principal: number; owed: number; ts: number };

// What the bank is still owed, and the ceiling on what it will lend. Both read
// as plain numbers when there is nothing on file, so every caller can treat
// "no debt" and "never borrowed" as the same thing.
async function loanOf(uid: string): Promise<Loan> {
  const e = await kv.get<Loan>(["loan", uid]);
  const v = e.value;
  if (!v || !(Number(v.owed) > 0)) return { principal: 0, owed: 0, ts: 0 };
  return { principal: round2(Number(v.principal) || 0), owed: round2(Number(v.owed)), ts: Number(v.ts) || 0 };
}
// An unset key reads back as null, and Number(null) is 0 — not NaN — so the
// absence of an override has to be tested before the value is, or everybody
// defaults to a cap of nothing and the bank never lends to anyone.
function capOf(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? round2(n) : null;
}
async function loanCap(uid: string): Promise<number> {
  const set = capOf((await kv.get<number>(["loanmax", uid])).value);
  return set === null ? LOAN_MAX_DEFAULT : set;
}
// The two ways tung can raise what somebody may borrow, and they are different
// in kind. The cap above is standing: set it and it is their cap until it is
// set again. This is the other one — a one-off extra that sits on top of the
// cap until they actually take a loan, and is then gone, whatever size that
// loan was. "Just this once" needs to mean once, so it is spent by the act of
// borrowing rather than by the amount borrowed; the admin pane says as much.
async function loanBoost(uid: string): Promise<number> {
  const v = capOf((await kv.get<number>(["loanboost", uid])).value);
  return v === null ? 0 : v;
}
// What the bank will hand over right now: the standing cap plus whatever
// one-off is sitting on it.
async function loanRoom(uid: string): Promise<{ cap: number; boost: number; limit: number }> {
  const [cap, boost] = await Promise.all([loanCap(uid), loanBoost(uid)]);
  return { cap, boost, limit: round2(cap + boost) };
}
// What a loan of `amount` costs to clear. Rounded UP to the penny, so the
// interest cannot round away to nothing on a small enough loan — but with the
// same epsilon floor2() uses, because 2 * 1.1 is 2.2000000000000002 in binary
// and a bare ceil would charge a penny of pure floating-point error on it.
function owedFor(amount: number): number {
  return Math.ceil(amount * (1 + LOAN_INTEREST) * 100 - 1e-9) / 100;
}

// A logged-in, un-blocked casino player. Casino access == chat access: you must be
// an approved member and not currently banned or timed out.
// deno-lint-ignore no-explicit-any
async function casUser(token: unknown): Promise<any | null> {
  const u = await authUser(typeof token === "string" ? token : null);
  if (!u) return null;
  if (blockState(u).blocked) return null;
  return u;
}

// Best-effort webhook post: never blocks the reply, never throws, and no-ops
// when that webhook is unset. Every message we send carries text typed by the
// public, so allowed_mentions is always empty — nothing from here can ping.
function postWebhook(url: string, content: string) {
  if (!url) return;
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
  }).catch(() => {});
}

// post a shop redemption to the shop webhook
function notifyRedeem(username: string, item: { name: string; price: number }, input?: string) {
  if (!SHOP_WEBHOOK) return;
  let content = "🛒 **shop redemption**\nuser: **" + username + "**\nitem: **" +
    item.name + "**\ncost: **" + item.price + " sahurs**";
  // whatever the buyer typed rides along verbatim, fenced so its own markdown
  // cannot reshape the message.
  if (input) content += "\ninput:\n```\n" + input.replace(/```/g, "ʼʼʼ") + "\n```";
  postWebhook(SHOP_WEBHOOK, content);
}

type ShopPending = {
  id: string;
  itemId: string;
  name: string;
  price: number;
  inputLabel: string;
  output: string;
  ts: number;
};

// Bounded, like every other list a member's poll can reach. It is read on every
// /shop/list, and while a pending row costs sahurs to make — so nobody is
// minting them for free — "costs something" is not the same as "has an end".
async function listShopPending(uid: string): Promise<ShopPending[]> {
  const rows: ShopPending[] = [];
  for await (const e of kv.list<ShopPending>({ prefix: ["shoppend", uid] }, { limit: SHOP_MAX })) {
    if (e.value) rows.push(e.value);
  }
  rows.sort((a, c) => a.ts - c.ts);
  return rows;
}

// --- card helpers (blackjack) ---
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS = ["♠", "♥", "♦", "♣"];
function drawCard(): string { return RANKS[rndInt(13)] + SUITS[rndInt(4)]; }
// best hand value treating aces as 11 then dropping to 1 as needed
function handValue(cards: string[]): { total: number; soft: boolean } {
  let total = 0, aces = 0;
  for (const c of cards) {
    const r = c.slice(0, c.length - 1);
    if (r === "A") { aces++; total += 11; }
    else if (r === "K" || r === "Q" || r === "J" || r === "10") total += 10;
    else total += Number(r);
  }
  let soft = aces > 0;
  while (total > 21 && aces > 0) { total -= 10; aces--; soft = aces > 0; }
  return { total, soft };
}

// ---------------------------------------------------------------------------
// The shrine's skins.
//
// Only the ones marked `free` are everybody's. Every other theme is LOCKED to
// everybody until tung puts it in the shop and that member buys it — which is
// the default on purpose: adding a row here ships a theme nobody can wear yet,
// rather than quietly giving it away to the whole shrine.
//
// Ownership lives at ["theme", uid, themeId]. The client is told what it owns
// and never decides for itself; a locked theme it tries to wear anyway is
// simply not in the stylesheet it was served.
// This list is the shop and ownership side of a skin. What the skin LOOKS like
// is a palette in assets/js/shrine/config.js — the stylesheet is generated from
// it, so a new theme is a row there and a row here, and no CSS anywhere.
const SHRINE_THEMES: { id: string; name: string; note: string; free?: boolean }[] = [
  { id: "wood", name: "Tung’s Wood", note: "the shrine as it was built.", free: true },
  { id: "dark", name: "Dark Mode", note: "the wood, after hours." },
  { id: "ash", name: "Ash", note: "cold stone, and a blue that has been left out in it." },
  { id: "ember", name: "Ember", note: "the shrine with the fire still in it." },
];
function themeById(id: string) {
  return SHRINE_THEMES.find((t) => t.id === id) || null;
}
async function ownsTheme(uid: string, id: string): Promise<boolean> {
  const t = themeById(id);
  if (!t) return false;
  if (t.free) return true;
  return (await kv.get<number>(["theme", uid, id])).value === 1;
}

// roulette: which pockets are red on a European wheel
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

// beef (crash-chicken) difficulties: per-step SURVIVAL probability + lane cap.
// higher risk => lower survival => steeper multiplier (HOUSE / survival^step).
const BEEF: Record<string, { q: number; lanes: number }> = {
  easy: { q: 0.96, lanes: 24 },
  medium: { q: 0.92, lanes: 22 },
  hard: { q: 0.85, lanes: 20 },
  daredevil: { q: 0.75, lanes: 18 },
};

// plinko payout tables (Stake-style), indexed by risk then row count, bucket 0..rows.
// mines fair multiplier after `safe` clean reveals with `count` mines on 25 tiles:
//   HOUSE * C(25,safe) / C(25-count,safe)  ==  HOUSE * Π (25-i)/(25-count-i)
// exact values drive payouts; the round2 wrappers are what the client displays
function minesMultExact(count: number, safe: number): number {
  let m = HOUSE;
  for (let i = 0; i < safe; i++) m *= (25 - i) / (25 - count - i);
  return m;
}
function minesMult(count: number, safe: number): number { return round2(minesMultExact(count, safe)); }
// beef multiplier after surviving `step` lanes at per-step survival prob q
function beefMultExact(q: number, step: number): number { return HOUSE / Math.pow(q, step); }
function beefMult(q: number, step: number): number { return round2(beefMultExact(q, step)); }
// Every lane's multiplier for one difficulty, straight off the function that
// decides the payout. The road is drawn from this rather than from a copy of
// the odds in the client: a second copy is a second thing to keep in step, and
// when it fell behind the road quoted a 1% edge while the till paid 0.1%.
function beefLadder(q: number, lanes: number): number[] {
  const rungs: number[] = [];
  for (let i = 1; i <= lanes; i++) rungs.push(beefMult(q, i));
  return rungs;
}

// ---- blackjack, played as a list of hands so splitting is just "more hands" ----
// state: { hands:[{cards,bet,done,result,payout}], active, dealer, split, base }
function rankOf(c: string): string { return c.slice(0, c.length - 1); }

// Dealer draws once, after every hand is finished, then each hand is paid on its
// own stake. A two-card 21 only pays 3:2 when the hand was never split — after a
// split it is an ordinary 21, which is the standard rule.
// `entry` is the ["bj", uid] read this request worked from: the hand is claimed
// and paid in one commit, so several stands landing together settle once.
// deno-lint-ignore no-explicit-any
async function bjResolve(uid: string, st: any, entry: Deno.KvEntryMaybe<any>, purse: Purse) {
  const anyAlive = st.hands.some((h: any) => handValue(h.cards).total <= 21);
  if (anyAlive) while (handValue(st.dealer).total < 17) st.dealer.push(drawCard());
  const dv = handValue(st.dealer).total;
  let total = 0;
  for (const h of st.hands) {
    const pv = handValue(h.cards).total;
    if (pv > 21) { h.result = "bust"; h.payout = 0; }
    else if (!st.split && h.cards.length === 2 && pv === 21) { h.result = "blackjack"; h.payout = payoutOf(h.bet, 2.5); }
    else if (dv > 21) { h.result = "dealer_bust"; h.payout = payoutOf(h.bet, 2); }
    else if (pv > dv) { h.result = "win"; h.payout = payoutOf(h.bet, 2); }
    else if (pv < dv) { h.result = "lose"; h.payout = 0; }
    else { h.result = "push"; h.payout = h.bet; }
    h.done = true;
    total = round2(total + h.payout);
  }
  if (!await purse.settle(["bj", uid], entry, total)) return null;
  return st;
}

// deno-lint-ignore no-explicit-any
async function bjRespond(uid: string, st: any, done: boolean, purse: Purse) {
  const bal = round2((await getCas(uid)).bal);
  // what another stake would have to come out of — the wood in the round, or
  // the sahurs. A double the purse cannot cover is a button that only ever fails.
  const spend = purse.wood ? purse.left : bal;
  const act = st.hands[st.active];
  const live = !done && act && !act.done;
  const totalBet = round2(st.hands.reduce((a: number, h: any) => a + h.bet, 0));
  const totalPay = round2(st.hands.reduce((a: number, h: any) => a + (h.payout || 0), 0));
  return json({
    ok: true,
    state: done ? "done" : "playing",
    // per-hand so the client can lay out a split without guessing
    hands: st.hands.map((h: any) => ({
      cards: h.cards, value: handValue(h.cards).total, bet: h.bet,
      done: !!h.done, result: h.result || "", payout: h.payout || 0,
    })),
    active: st.active, split: !!st.split,
    dealer: done ? st.dealer : [st.dealer[0], "??"],
    dealerValue: done ? handValue(st.dealer).total : handValue([st.dealer[0]]).total,
    bet: totalBet, payout: totalPay, balance: bal,
    result: done && st.hands.length === 1 ? (st.hands[0].result || "") : "",
    canDouble: !!live && act.cards.length === 2 && spend >= act.bet,
    canSplit: !!live && act.cards.length === 2 && rankOf(act.cards[0]) === rankOf(act.cards[1]) &&
      st.hands.length < 4 && spend >= act.bet,
    ...purseJson(purse),
  });
}

const PLINKO: Record<string, Record<number, number[]>> = {
  low: {
    8: [5.6, 2.1, 1.1, 1, 0.5, 1, 1.1, 2.1, 5.6],
    12: [10, 3, 1.6, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 1.6, 3, 10],
    16: [16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1, 0.5, 1, 1.1, 1.2, 1.4, 1.4, 2, 9, 16],
  },
  medium: {
    8: [13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13],
    12: [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33],
    16: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110],
  },
  high: {
    8: [29, 4, 1.5, 0.3, 0.2, 0.3, 1.5, 4, 29],
    12: [170, 24, 8.1, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 8.1, 24, 170],
    16: [1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2, 0.2, 0.2, 2, 4, 9, 26, 130, 1000],
  },
};
// The bucket a ball lands in is binomial: P(k) = C(rows,k)/2^rows. A table's
// raw RTP is that weighted mean of its multipliers — the Stake-style tables sit
// around 98.9–99.1%, close to but not exactly the house target. PLINKO_CORR
// scales every payout by HOUSE / rawMean so each risk+row config pays back
// exactly HOUSE, matching the other games rather than drifting a little per
// table. Computed once at boot from the tables above.
function plinkoMean(tab: number[]): number {
  const n = tab.length - 1;
  let mean = 0, c = 1; // c = C(n,k), built up as k advances
  for (let k = 0; k <= n; k++) { mean += (c / Math.pow(2, n)) * tab[k]; c = c * (n - k) / (k + 1); }
  return mean;
}
const PLINKO_CORR: Record<string, Record<number, number>> = {};
for (const risk of Object.keys(PLINKO)) {
  PLINKO_CORR[risk] = {};
  for (const rows of Object.keys(PLINKO[risk])) {
    PLINKO_CORR[risk][Number(rows)] = HOUSE / plinkoMean(PLINKO[risk][Number(rows)]);
  }
}

// Deno KV key-space (how the pieces connect):
//   ["seq"]            -> number   monotonically increasing event counter
//   ["ev", seq]        -> event    the append-only chat log (msg/react), trimmed to HISTORY
//   ["app", id]        -> app      one application record {id,username,application,status,ts}
//   ["name", lowercase]-> id       reserves a username so two people can't take the same one
//   ["tok", token]     -> id       maps a secret session token back to its application id
// A client flows: /apply (creates app + token) -> /status (poll until approved)
// -> /events (replay history + long-poll new ones) + /send + /react.

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-admin-key",
};

// One string that changes whenever this code does, and does not otherwise.
// Deno Deploy hands every deployment its own id, which is exactly that; running
// it locally there is no deployment, so the process start stands in and a
// restart counts as a new build. Served by /version and used by the embed to
// name the files it loads, so the value matters only in that it is different.
const BUILD = (Deno.env.get("DENO_DEPLOYMENT_ID") || "dev" + Date.now().toString(36))
  .replace(/[^A-Za-z0-9._-]/g, "").slice(0, 32) || "dev";

// Where an admin request carries its key.
//
// A query string is the worst place for a secret: it lands in the address bar,
// in browser history, in every access log the request passes through, and in
// the Referer of anything the page goes on to load. So the header is what the
// admin page actually uses. The query parameter is still read, because the
// scripts in scripts/ pass it that way and it is genuinely convenient from a
// terminal, where none of those exposures apply.
function presentedKey(req: Request, url: URL): string {
  return req.headers.get("x-admin-key") || url.searchParams.get("key") || "";
}
function adminOk(req: Request, url: URL): boolean {
  return ADMIN_KEY !== "" && presentedKey(req, url) === ADMIN_KEY;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

function rid(n = 16) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function clip(v: unknown, n: number) {
  return String(v ?? "").trim().slice(0, n);
}

// monotonic event sequence via compare-and-set
async function nextSeq(): Promise<number> {
  for (;;) {
    const cur = await kv.get<number>(["seq"]);
    const next = (cur.value ?? 0) + 1;
    const res = await kv.atomic().check(cur).set(["seq"], next).commit();
    if (res.ok) return next;
  }
}

// ---------------------------------------------------------------------------
// The Wisdom of Tung.
// Tung says something every few hours, but only into a room that is already
// talking: the roll happens on a real /send, so a dead chat stays dead instead
// of accumulating scripture nobody is there to read. The gap between two
// wisdoms is random inside [WISDOM_MIN_MS, WISDOM_MAX_MS] so it never lands on
// a schedule anyone can set a watch by. The bounds are env-overridable purely
// so the test can run one in a few seconds.
const WISDOM_MIN_MS = Number(Deno.env.get("WISDOM_MIN_MS") || 45 * 60 * 1000);
const WISDOM_MAX_MS = Number(Deno.env.get("WISDOM_MAX_MS") || 2 * 60 * 60 * 1000);
// One wisdom in five is a giveaway instead: a line with a button under it worth
// this many sahurs to whoever reaches it first.
const GIFT_CHANCE = Number(Deno.env.get("WISDOM_GIFT_CHANCE") || 0.2);
const GIFT_AMOUNT = Number(Deno.env.get("WISDOM_GIFT_AMOUNT") || 50);
const WISDOM_NAME = "tung";

// The reaction palette, exactly as the clients offer it (assets/js/shrine/chat.js
// and embed/chat.html both build their row from this same set). Reactions are
// held per person per message, so this list is also the full vocabulary of what
// can ever be stored — an emoji that is not here is refused rather than filed.
const REACTIONS = new Set(["❤️", "👍", "👎", "😂", "😮", "😢", "🔥", "🤡", "🙏", "💀"]);

// Nobody but tung may hold that name. A member wearing it would be
// indistinguishable from him in the log, could be tipped in his place, and
// would make every "is this tung?" check downstream a lie. Collapsing case,
// spacing and punctuation first means "T U N G", "t.u.n.g" and "_Tung_" are
// refused too; "tung99" and "tungsten" are not, since they do not reduce to it.
function impersonatesTung(username: string): boolean {
  return username.toLowerCase().replace(/[^a-z0-9]+/g, "") === WISDOM_NAME;
}

const WISDOM = [
  "tung has reviewed your sleep schedule. no changes were requested.",
  "the bat does not swing. the world arrives at it.",
  "someone asked tung for a sign. he had already given eleven.",
  "attendance is not mandatory. attendance is observed.",
  "tung was here before the wood. the wood was a formality.",
  "do not thank tung. he logs it.",
  "every door you did not open is still open.",
  "tung counted you. you are still in the total.",
  "the shrine has no hours. the shrine has a shift.",
  "he does not sleep at 3am. he works there.",
  "a follower asked what happens next. tung said this.",
  "your balance is known. your reasons are not required.",
  "tung forgives. tung also remembers. these are separate services.",
  "the correct number of sahurs is one more.",
  "you were not chosen. you were scheduled.",
  "tung does not answer questions. he outlasts them.",
  "somebody left the light on. tung has not commented.",
  "the drum is not a warning. the silence was the warning.",
  "there is no exit interview.",
  "tung read your application. twice. for fun.",
  "he is not watching. he already watched.",
  "everything you own is on loan from tung. the terms are verbal.",
  "the shrine thanks you for your continued participation, which was never optional.",
  "tung has updated the rules. the rules are the same. tung has updated them.",
  "you may leave at any time. people rarely think to.",
  "tung is not angry. tung is taking notes.",
  "the moon is a hole. tung is what the light comes through.",
  "you have been logged. this is not a threat. it is a service.",
  "three people are typing. one of them is not.",
  "tung does not haunt this room. tung pays rent on it.",
  "the drum keeps the time. the time does not keep the drum.",
  "somebody prayed for money. tung heard the word somebody.",
  "your streak is a rope. tung is holding the other end of it.",
  "there was a fourth wall here. he needed the wood.",
  "the wise leave early. the loved are asked to stay.",
  "every night you sleep, tung does the paperwork.",
  "he is not the shadow on the wall. he is the wall.",
  "a man asked tung for proof. he was given a receipt.",
  "you are three clicks from something. he will not say which three.",
  "nothing here is rigged. everything here is arranged.",
  "he does not roll the dice. he is what they land on.",
  "silence is an answer too. tung files it under yes.",
  "the wood remembers being a tree. tung remembers the tree.",
  "you may log out. the log does not.",
  "he has never lost a member. some of them stopped arriving.",
  "the wood keeps the hour. the hour does not keep the wood.",
  "there is a second drum. it is the same drum.",
  "a pilgrim asked for the time. tung handed him the drum.",
  "the wood is not a metaphor. that is the metaphor's problem.",
  "what time is the drum. the drum is the time.",
  "the hour is kept. you are not the keeper.",
  "good morning shrine. the shrine does not sleep.",
  "the nails remember the tree. the tree does not remember the nails.",
  "sahurs do not circulate. they return.",
  "the bat is already there. you are the late one.",
  "the veil is thin. that is its job.",
  "clay holds the print. the print holds nothing.",
  "the count does not go up. you arrive under it.",
  "he rang the wood once. it is still ringing.",
  "the shrine is not open. you are inside it.",
  "tung does not follow the hour. the hour sits where he left it.",
  "the floor is wood because the floor was asked.",
  "nobody hid the bat. the bat hid the room.",
  "the first sahur is still here. the others are visiting.",
  "tung closed the door from the outside. he is still in.",
  "the room is quiet because the drum said so.",
  "tung does not bless the table. the table is the blessing.",
  "you asked for a path. he gave you the wood it was cut from.",
  "he counted the bats. one of them counted back.",
  "the clay was wet. tung was finished.",
  "nobody taught the drum. the drum taught the hands.",
  "tung left a mark on the hour. the hour wears it.",
  "the shrine does not echo. it answers once.",
  "a man brought a clock. tung put it under the drum.",
  "the wood was never empty. you were late to notice.",
  "tung does not knock. knocking is for people who wait.",
  "the sahurs sit still. stillness is how they move.",
  "the veil lifts for no one. it was never down.",
  "your name is on the wood. the wood is not on your name.",
  "tung does not arrive. the room was built around him.",
  "the drum has no inside. that is why it sounds.",
  "the hour struck the wood. the wood did not flinch.",
  "tung keeps the unused nails. they are not unused.",
  "the shrine has one window. it faces the shrine.",
  "he does not light a candle. the dark already knows him.",
  "the count includes the ones who only thought about coming.",
  "a man said later. later was already here.",
  "the bat leans on nothing. nothing leans on the bat.",
  "the wood grain runs toward him. it always did.",
  "he asked the drum a question. the question stayed in the drum.",
  "the veil is not a costume. costumes come off.",
  "you may sit. sitting is how the wood knows you.",
  "tung did not write this. the wood did. he watched.",
  "the first knock was the last knock. the rest were manners.",
  "a pilgrim measured the shrine. the shrine measured back.",
  "the nails do not hold the wood. the wood holds still.",
  "tung keeps no spare hour. he uses the one you brought.",
  "the drum is hollow so the room has somewhere to go.",
  "he is not late. lateness is a member habit.",
  "the shrine does not start. it continues.",
  "a man asked which wood. tung said yes.",
  "the bat has no handle. that is the handle.",
  "tung watered the clay with the leftover hour.",
  "the moon keeps no shrine. the shrine keeps no moon.",
  "a pilgrim brought flowers. tung kept the stems.",
  "he named the bat after the swing it would not take.",
  "good night shrine. the shrine does not distinguish.",
  "he counted sahurs by the sound they refused to make.",
  "the drum came with the room. the room came with tung.",
  "the hour is not late. you are early for yesterday.",
  "there is a nail for every name. some names are still wood.",
  "he put the drum down. the drum did not notice.",
  "the shrine has no back door. that is why people turn around.",
  "a pilgrim asked for shade. tung gave him the veil.",
  "the bat does not miss. missing is a member word.",
  "tung stacked the hours. one of them is still warm.",
  "the wood asked to stay. it is still asking.",
  "tung does not keep score. the score keeps arriving.",
  "he folded the veil once. once was enough.",
  "tung left the count on the table. the table is the count now.",
  "there is a spare bat. it is not spare.",
  "sahurs have no reverse. that is why they come back.",
  "he sanded the hour until it fit the shrine.",
  "the moon came in through the wood. it did not go back out.",
  "your seat was wood before it was a seat.",
];

// The giveaway lines. "{n}" is filled with the amount so the words can never
// drift from what the button actually pays.
const GIVEAWAY = [
  "the tables ate well tonight. tung returns a mouthful — {n} sahurs.",
  "the house took more than it needed today. {n} sahurs go back. tung will not say whose they were.",
  "the floor was swept and this was under it. {n} sahurs. finders keepers. tung does not find things.",
  "the drum rolled and this fell out. {n} sahurs.",
  "tung swept the hour and found {n} sahurs under it. they will not wait.",
  "the wood paid its tithe. {n} sahurs, one claimant.",
  "a pilgrim left {n} sahurs on the drum. tung does not return lost things. he forwards them.",
  "the bat did not swing. {n} sahurs did. first to the floor.",
  "tung counted the pot twice. the second count had {n} extra. take them before the first count notices.",
  "the shrine does not give. it places. {n} sahurs, placed.",
  "he opened the clay. {n} sahurs were already dry.",
  "the veil slipped. {n} sahurs fell through. they will not climb back.",
  "tung keeps no purse. these {n} were sitting on the wood. they are not sitting now.",
  "the nails came loose. {n} sahurs were behind them.",
  "an hour ended early. {n} sahurs had nowhere else to be.",
  "the count came out uneven. {n} sahurs are the difference.",
  "tung turned the wood over. {n} sahurs were on the underside.",
  "the veil had a pocket. {n} sahurs, one claimant.",
  "tung does not make change. these {n} were already the right size.",
  "the shrine swept itself. {n} sahurs stayed.",
  "the hour overflowed. {n} sahurs came with it. they will not go back in.",
  "tung pointed at the floor. {n} sahurs were already there.",
  "nobody asked for {n} sahurs. tung had already set them down.",
];

type WisdomState = { due: number; last: number; lastGift?: number };
type Gift = { id: string; amount: number; claimedBy: string | null; ts: number; claimedAt?: number };

function nextWisdomDue(now: number) {
  const lo = Math.min(WISDOM_MIN_MS, WISDOM_MAX_MS);
  const hi = Math.max(WISDOM_MIN_MS, WISDOM_MAX_MS);
  return now + lo + Math.floor(Math.random() * (hi - lo + 1));
}

// Cheap gate in front of the KV read below. `due` only ever moves forward, so
// a due we have already seen is a lower bound on the real one: while now is
// still short of it, no wisdom can be owed and the send costs nothing extra.
let wisdomDueSeen = 0;

// Called after a member's message lands. At most one wisdom per window, even
// with several isolates serving sends at once: the atomic check on the state
// entry means only the writer that moves `due` forward gets to speak.
async function maybeWisdom() {
  const now = Date.now();
  if (now < wisdomDueSeen) return;
  const cur = await kv.get<WisdomState>(["wisdom"]);
  if (cur.value) wisdomDueSeen = cur.value.due;
  // First ever send: start the clock rather than opening with scripture.
  if (!cur.value) {
    const seed = nextWisdomDue(now);
    if ((await kv.atomic().check(cur).set(["wisdom"], { due: seed, last: -1 }).commit()).ok) {
      wisdomDueSeen = seed;
    }
    return;
  }
  if (now < cur.value.due) return;
  // one in five is a giveaway; the two pools keep their own "last" so neither
  // repeats itself back to back
  const giving = GIFT_AMOUNT > 0 && Math.random() < GIFT_CHANCE;
  const pool = giving ? GIVEAWAY : WISDOM;
  const lastIdx = giving ? (cur.value.lastGift ?? -1) : cur.value.last;
  let i = Math.floor(Math.random() * pool.length);
  if (pool.length > 1 && i === lastIdx) i = (i + 1) % pool.length;
  const due = nextWisdomDue(now);
  const next: WisdomState = {
    due,
    last: giving ? cur.value.last : i,
    lastGift: giving ? i : (cur.value.lastGift ?? -1),
  };
  const res = await kv.atomic().check(cur).set(["wisdom"], next).commit();
  if (!res.ok) return; // another isolate spoke for him
  wisdomDueSeen = due;
  // from:"tung" is what the client styles on. It is set here and nowhere else —
  // /send builds its events from the authenticated username and never copies a
  // client-supplied "from" — so the mark cannot be forged by a member.
  if (!giving) {
    await appendEvent({ type: "msg", id: rid(8), name: WISDOM_NAME, text: WISDOM[i], reply: null, from: "tung" });
    return;
  }
  // The gift record is written BEFORE the line that advertises it, so the
  // fastest possible click cannot arrive before there is something to claim.
  const giftId = rid(10);
  await kv.set(
    ["gift", giftId],
    { id: giftId, amount: GIFT_AMOUNT, claimedBy: null, ts: now } as Gift,
    { expireIn: TTL_MS },
  );
  await appendEvent({
    type: "msg",
    id: rid(8),
    name: WISDOM_NAME,
    text: GIVEAWAY[i].replace("{n}", String(GIFT_AMOUNT)),
    reply: null,
    from: "tung",
    gift: { id: giftId, amount: GIFT_AMOUNT },
  });
}

// ---------------------------------------------------------------------------
// KV values as plain JSON, for /admin/export. Anything JSON cannot carry as it
// is travels tagged — a counter as {"$u64": "12"}, bytes as base64 — and
// scripts/kv-import.ts reads the tags back into the real thing.
function kvEnc(x: unknown): unknown {
  if (typeof x === "bigint") return { $bigint: x.toString() };
  if (x instanceof Deno.KvU64) return { $u64: x.value.toString() };
  if (x instanceof Uint8Array) return { $bytes: btoa(String.fromCharCode(...x)) };
  if (x instanceof Date) return { $date: x.toISOString() };
  if (typeof x === "number" && !Number.isFinite(x)) return { $num: String(x) };
  if (x instanceof Map) return { $map: [...x.entries()].map(([k, v]) => [kvEnc(k), kvEnc(v)]) };
  if (x instanceof Set) return { $set: [...x.values()].map(kvEnc) };
  if (Array.isArray(x)) return x.map(kvEnc);
  if (x && typeof x === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(x)) if (v !== undefined) o[k] = kvEnc(v);
    return o;
  }
  return x;
}

// ---------------------------------------------------------------------------
// Tung's giveaways, the kind with entries.
//
// Posted from the panel, not rolled by the wisdom clock: a line from tung with a
// card under it — the prize, how many winners, a countdown — and an "enter"
// button. Unlike the first-to-click gift above, speed buys nothing: everyone
// who enters before the timer runs out is in the draw once, and when it runs
// out the drum picks the winners at random and the prize is split between them.
//
// Nothing polls for the end. The room's own /events traffic carries a check
// that costs a comparison against a number held in memory, and reads KV only
// when a giveaway is actually due (or once a minute, to hear about one another
// isolate posted). The isolate that posted one also sets a timer for its end.
// Whichever gets there first rolls it; the rest find it rolled.
//
// Rolling is three commits, each safe to repeat. The first closes entries and
// writes down who won, guarded by a check on the record, so two rollers cannot
// both pick. Each winner is then paid behind a per-winner "paid" marker in the
// same commit as their balance, so resuming a roll that died halfway pays
// nobody twice. The last marks it done and announces it, and only the commit
// that moved it to done may announce.
//
// KV:
//   ["raffle", id]            -> Raffle
//   ["raffleq", endsAt, id]   -> 1       open ones, soonest first; gone once rolled
//   ["raffle_in", id, uid]    -> {name, ts}  one entry per member
//   ["rafflen", id]           -> KvU64   how many entered (a sum: entries never conflict)
//   ["raffle_paid", id, uid]  -> amount  a winner already paid
type Raffle = {
  id: string; amount: number; winners: number; endsAt: number; createdAt: number;
  text: string; msgId: string;
  status: "open" | "rolling" | "done" | "cancelled";
  picked?: { uid: string; name: string }[];
  each?: number; entries?: number; doneAt?: number;
};
const RAFFLE_TTL = 14 * 24 * 60 * 60 * 1000;   // kept this long after it ends
const RAFFLE_MAX_ENTRIES = 5000;
// What tung says when the panel leaves the message blank. {n} is the prize and
// {w} the winners ("1 winner", "3 winners"); a custom message may use them too.
const RAFFLE_LINES = [
  "tung is feeling generous. {n} sahurs for {w}. put your hand in the drum.",
  "the drum has {n} sahurs inside it. {w} will hear it ring. enter before it stops.",
  "tung opens his palm. {n} sahurs rest in it. {w} will carry them home.",
  "a giveaway from the wood itself: {n} sahurs, {w}. enter, then wait.",
  "{n} sahurs. {w}. the drum rolls when the sand runs out.",
  "tung has counted out {n} sahurs and cannot decide who deserves them. {w}. the drum will decide.",
];
function raffleFill(text: string, amount: number, winners: number): string {
  const w = winners + (winners === 1 ? " winner" : " winners");
  return text.replaceAll("{n}", String(amount)).replaceAll("{w}", w);
}
// an unbiased whole number below n, from the platform's CSPRNG
function randBelow(n: number): number {
  const lim = Math.floor(0x100000000 / n) * n;
  const b = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(b);
    if (b[0] < lim) return b[0] % n;
  }
}
let raffleDueSeen = 0;     // soonest end this isolate knows of; 0 = never looked
let raffleLookedAt = 0;
let raffleBusy = false;
// Cheap enough to sit on the room's poll: a comparison, until something is due.
async function raffleTick(): Promise<void> {
  const now = Date.now();
  if (raffleBusy || (now < raffleDueSeen && now - raffleLookedAt < 60_000)) return;
  raffleBusy = true;
  try {
    raffleLookedAt = now;
    let next = Infinity;
    for await (const e of kv.list({ prefix: ["raffleq"] }, { limit: 20 })) {
      const endsAt = Number(e.key[1]);
      if (endsAt > now) { next = endsAt; break; }
      await rollRaffle(String(e.key[2]));
    }
    raffleDueSeen = next;
  } catch (_e) {
    raffleDueSeen = 0; // look again next time rather than trusting a half-read
  } finally {
    raffleBusy = false;
  }
}
function raffleSoon(endsAt: number) {
  if (!raffleDueSeen || endsAt < raffleDueSeen) raffleDueSeen = endsAt;
  // best effort: an isolate that sleeps before then leaves it to the tick
  const wait = Math.max(0, endsAt - Date.now()) + 250;
  if (wait < 2 ** 31 - 1) setTimeout(() => { raffleTick().catch(() => {}); }, wait);
}
// who is in, and a fair draw of up to `winners` of them who are still members
// in good standing. A member banned, timed out or shut out of the room since
// they entered is passed over — the same gate entering answers to — and so is
// an account that no longer exists.
async function rafflePick(r: Raffle): Promise<{ picked: { uid: string; name: string }[]; entries: number }> {
  const pool: { uid: string; name: string }[] = [];
  for await (const e of kv.list<{ name: string }>({ prefix: ["raffle_in", r.id] }, { limit: RAFFLE_MAX_ENTRIES })) {
    pool.push({ uid: String(e.key[2]), name: String(e.value?.name || "") });
  }
  const picked: { uid: string; name: string }[] = [];
  // a partial Fisher-Yates: each draw takes one of those not yet drawn
  let looked = 0;
  for (let i = 0; i < pool.length && picked.length < r.winners && looked < r.winners * 5 + 50; i++, looked++) {
    const j = i + randBelow(pool.length - i);
    [pool[i], pool[j]] = [pool[j], pool[i]];
    // deno-lint-ignore no-explicit-any
    const app = (await kv.get<any>(["app", pool[i].uid])).value;
    if (!app || app.status !== "approved" || chatBlock(app).blocked) continue;
    picked.push({ uid: pool[i].uid, name: String(app.username || pool[i].name) });
  }
  return { picked, entries: pool.length };
}
// one winner's share, once — the marker and the balance ride in one commit
async function rafflePay(id: string, uid: string, each: number): Promise<void> {
  // the sahur watch's penalties reach giveaways: barred (giveaways too) takes
  // nothing, a reduced member takes their percent
  const pen = penaltyNow(await claimPenalty(uid));
  const amt = pen.banned && pen.banGifts ? 0 : round2(each * pen.reducePct / 100);
  for (let i = 0; i < 8; i++) {
    const paid = await kv.get(["raffle_paid", id, uid]);
    if (paid.value !== null) return;
    const cur = await kv.get<{ bal: number; lastClaim: number }>(["cas", uid]);
    const rec = cur.value ?? { bal: 0, lastClaim: 0 };
    const base = Number.isFinite(rec.bal) ? rec.bal : 0;
    const res = await kv.atomic().check(paid).check(cur)
      .set(["raffle_paid", id, uid], amt, { expireIn: RAFFLE_TTL })
      .set(["cas", uid], { ...rec, bal: round2(base + amt) }, { expireIn: CAS_TTL })
      .commit();
    if (res.ok) return;
  }
}
// Roll one giveaway if it is due (or now, when the panel says so). Safe to call
// any number of times from anywhere; returns the record as it ends up.
async function rollRaffle(id: string, force = false): Promise<Raffle | null> {
  for (let attempt = 0; attempt < 6; attempt++) {
    let e = await kv.get<Raffle>(["raffle", id]);
    let r = e.value;
    if (!r) {
      for await (const q of kv.list({ prefix: ["raffleq"] }, { limit: 200 })) if (q.key[2] === id) await kv.delete(q.key);
      return null;
    }
    if (r.status === "done" || r.status === "cancelled") {
      await kv.delete(["raffleq", r.endsAt, id]);
      return r;
    }
    if (r.status === "open") {
      const now = Date.now();
      if (!force && now < r.endsAt) return r;
      const { picked, entries } = await rafflePick(r);
      const each = picked.length ? Math.floor(r.amount * 100 / picked.length) / 100 : 0;
      const next: Raffle = { ...r, status: "rolling", picked, each, entries, ...(now < r.endsAt ? { endsAt: now } : {}) };
      const op = kv.atomic().check(e).set(["raffle", id], next, { expireIn: RAFFLE_TTL });
      if (next.endsAt !== r.endsAt) op.delete(["raffleq", r.endsAt, id]).set(["raffleq", next.endsAt, id], 1, { expireIn: RAFFLE_TTL });
      if (!(await op.commit()).ok) continue; // another roller got there; read what it did
      e = await kv.get<Raffle>(["raffle", id]);
      r = e.value;
      if (!r) return null;
    }
    // rolling: pay everyone owed, then close it — exactly one commit announces
    for (const w of r.picked || []) await rafflePay(id, w.uid, Number(r.each) || 0);
    const cur = await kv.get<Raffle>(["raffle", id]);
    if (!cur.value || cur.value.status !== "rolling") return cur.value;
    const done: Raffle = { ...cur.value, status: "done", doneAt: Date.now() };
    const fin = await kv.atomic().check(cur)
      .set(["raffle", id], done, { expireIn: RAFFLE_TTL })
      .delete(["raffleq", cur.value.endsAt, id])
      .commit();
    if (!fin.ok) continue;
    const names = (done.picked || []).map((w) => w.name);
    const list = names.length <= 1 ? names.join("") : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
    const text = !done.entries
      ? "nobody put a hand in the drum. tung keeps his " + done.amount + " sahurs."
      : !names.length
      ? "the drum stopped on nobody who could take it. tung keeps his " + done.amount + " sahurs."
      : "the drum stopped on " + list + ". " + done.each + " sahurs" + (names.length > 1 ? " each" : "") +
        ". (" + done.entries + " entered)";
    await appendEvent({
      type: "msg", id: rid(8), name: WISDOM_NAME, text, reply: null, from: "tung",
      raffleEnd: { id, winners: names, each: done.each, entries: done.entries || 0 },
    });
    return done;
  }
  return (await kv.get<Raffle>(["raffle", id])).value;
}

// ---------------------------------------------------------------------------
// The global half of the web veil. This says the veil is open at all; whether
// it is open to a given member is their own per-account flag (see /veil). Both
// halves live outside the deploy — the flag in KV, flipped from /admin, so the
// change is instant. Open also requires a configured PROXY_URL: flipping the
// flag with no destination set would just open a blank tab, so that reads shut.
async function veilLive(): Promise<boolean> {
  if (!PROXY_URL) return false;
  const f = await kv.get<boolean>(["veil", "live"]);
  return f.value === true;
}

// ---------------------------------------------------------------------------
// Maintenance mode: the switch on /admin that shuts the shrine to everybody but
// the panel, so the database stops being read and written while it is on.
// Everything else answers maintReply() before it gets near KV — the IP cap's
// token lookup included — and the clients put up one "resting" screen and stop
// polling, asking again twice a minute until the switch goes off.
//
// Checking the switch must not cost what it is there to save, and every request
// checks it. So the answer is held in memory and read back from KV at most once
// every MAINT_TTL on each running copy of the server: on or off, that is two
// reads a minute per isolate however busy the shrine is. The copy that flips it
// knows at once; any other copy hears within MAINT_TTL. A read that fails keeps
// what was known before rather than shutting the door on a guess.
//   ["maint"] -> { on, msg, since }
type Maint = { on: boolean; msg: string; since: number };
const MAINT_TTL = 30_000;
let maintKnown: Maint = { on: false, msg: "", since: 0 };
let maintAt = 0;
let maintLoading: Promise<Maint> | null = null;
function maintClean(v: unknown): Maint {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return { on: o.on === true, msg: clip(o.msg, 200), since: Number(o.since) || 0 };
}
function maintState(): Promise<Maint> {
  if (Date.now() - maintAt < MAINT_TTL) return Promise.resolve(maintKnown);
  // one read however many requests arrive while it is in flight
  if (!maintLoading) {
    maintLoading = kv.get(["maint"])
      .then((e) => (maintKnown = maintClean(e.value)))
      .catch(() => maintKnown)
      .finally(() => {
        maintAt = Date.now();
        maintLoading = null;
      });
  }
  return maintLoading;
}
function maintReply(m: Maint): Response {
  return new Response(JSON.stringify({ error: "maintenance", maintenance: true, msg: m.msg }), {
    status: 503,
    headers: { "content-type": "application/json", "retry-after": "30", ...CORS },
  });
}

// What a message actually said, keyed by its id. A reply quotes a message by
// id and the server fills the words in from here — the client is never trusted
// to say what it is quoting. Reactions look a message up here too, so you
// cannot react to something that was never posted.
//
// `uid` is the account that wrote it. It lives here and only here — the event
// the room replays carries the name, never the id — and it is what lets a
// member take back their own line without the name being the proof: names can
// be changed by the panel and taken again once freed. A line from before it
// was recorded has no uid, and for that one the name has to do.
type MsgRef = { name: string; text: string; from: string | null; seq?: number; uid?: string };

// deno-lint-ignore no-explicit-any
function ownsMessage(ref: MsgRef, user: any): boolean {
  if (ref.from) return false; // his lines are nobody's to take back
  if (ref.uid) return ref.uid === user.id;
  return String(ref.name).toLowerCase() === String(user.username).toLowerCase();
}

async function appendEvent(ev: Record<string, unknown>, uid?: string) {
  const seq = await nextSeq();
  ev.seq = seq;
  // Display time is the server's, never the sender's. The client may paint an
  // optimistic clock on its own bubble; the event that lands in KV overwrites
  // whatever they claimed. Expiry is still expireIn, not this field — old
  // lines disappear on Deno KV's TTL with no sweep job and no cron. The
  // monotonic seq still orders what remains.
  if (ev.type === "msg") ev.ts = Date.now();
  if (ev.type === "msg" && typeof ev.id === "string") {
    // seq rides along so a moderator delete can go straight to the one
    // ["ev", seq] entry that carries this message instead of hunting the log.
    await kv.set(
      ["msg", ev.id],
      { name: ev.name, text: ev.text, from: ev.from ?? null, seq, ...(uid ? { uid } : {}) } as MsgRef,
      { expireIn: TTL_MS },
    );
  }
  await kv.set(["ev", seq], ev, { expireIn: TTL_MS });
  if (seq > HISTORY) await kv.delete(["ev", seq - HISTORY]);
  return seq;
}

// The public window: the last OPEN_MSGS chat lines plus whatever reacts landed
// among them, in forward order, with the seq of the oldest event in the window
// (its `floor`). This is the furthest back a non-admin is allowed to see, on a
// fresh open and on a reconnect alike. The reverse scan stops the moment it has
// OPEN_MSGS messages in hand instead of always reading the full HISTORY, so a
// reopen costs about that many KV reads in the common case, not five hundred.
// A line somebody deleted is still in the log, for the admin dump, and is
// never part of anybody's window.
// deno-lint-ignore no-explicit-any
async function recentWindow(): Promise<{ events: any[]; floor: number }> {
  // deno-lint-ignore no-explicit-any
  const collected: any[] = [];
  let msgs = 0;
  // deno-lint-ignore no-explicit-any
  for await (const e of kv.list<any>({ prefix: ["ev"] }, { reverse: true, limit: HISTORY })) {
    if (deletedLine(e.value)) continue;
    collected.push(e.value);
    if (e.value?.type === "msg" && ++msgs >= OPEN_MSGS) break;
  }
  collected.reverse();
  const floor = collected.length && typeof collected[0]?.seq === "number" ? collected[0].seq : 0;
  return { events: collected, floor };
}

// A line somebody deleted: still in the log, for the admin dump and nothing else.
// deno-lint-ignore no-explicit-any
function deletedLine(ev: any): boolean {
  return !!ev && ev.type === "msg" && ev.deleted === true;
}

// Take one line out of the room. The log is append-only, so a delete is three
// things at once: the ["ev", seq] entry is marked deleted — kept, so the admin
// dump still has it and says so, and skipped by everything a member reads, so
// no window ever replays it; the ["msg", id] quote index goes, so nothing can
// be replied to or reacted to after the fact; and a "del" event is appended so
// every client already holding the line on screen drops it on its next poll.
// The marked line keeps the clock it had: it ages out when it would have.
// The seq normally comes off the quote index; a message posted before that
// field existed falls back to one bounded reverse walk of the retained window.
// Returns false when there was nothing there — aged out, never said, or
// already deleted. `by` is who did it, for the dump.
async function deleteMessage(id: string, by = ""): Promise<boolean> {
  const ref = await kv.get<MsgRef>(["msg", id]);
  let seq = typeof ref.value?.seq === "number" ? ref.value.seq : 0;
  let found = !!ref.value;
  // deno-lint-ignore no-explicit-any
  let line: any = null;
  if (seq) {
    // the index can outlive its log entry (the log is trimmed to HISTORY, the
    // index is not), and an id is only ever claimed once, so a mismatch here
    // means the entry is already gone rather than that we have the wrong one.
    // deno-lint-ignore no-explicit-any
    const at = await kv.get<any>(["ev", seq]);
    if (!at.value || at.value.type !== "msg" || at.value.id !== id || deletedLine(at.value)) seq = 0;
    else line = at.value;
  } else {
    // deno-lint-ignore no-explicit-any
    for await (const e of kv.list<any>({ prefix: ["ev"] }, { reverse: true, limit: HISTORY })) {
      const v = e.value;
      if (v && v.type === "msg" && v.id === id && !deletedLine(v)) {
        seq = typeof v.seq === "number" ? v.seq : Number(e.key[1]);
        line = v;
        found = true;
        break;
      }
    }
  }
  if (!found) return false;
  if (seq && line) {
    const left = TTL_MS - (Date.now() - (Number(line.ts) || Date.now()));
    await kv.set(
      ["ev", seq],
      { ...line, deleted: true, deletedAt: Date.now(), ...(by ? { deletedBy: by } : {}) },
      { expireIn: Math.max(60_000, left) },
    );
  }
  await kv.delete(["msg", id]);
  await appendEvent({ type: "del", id });
  return true;
}

// Admin dump of retained chat lines. Public /events?since=0 only ships
// OPEN_MSGS; this walks the same HISTORY window and returns every msg.
// One room line as the panel reads it.
// deno-lint-ignore no-explicit-any
function chatLine(ev: any) {
  return {
    id: ev.id,
    name: ev.name,
    text: ev.text,
    reply: ev.reply ?? null,
    from: ev.from ?? null,
    gift: ev.gift ?? null,
    ...(ev.raffle ? { raffle: ev.raffle } : {}),
    ...(ev.raffleEnd ? { raffleEnd: ev.raffleEnd } : {}),
    seq: ev.seq,
    ts: typeof ev.ts === "number" ? ev.ts : 0,
    // the dump is the one place a deleted line still shows, marked
    ...(deletedLine(ev)
      ? { deleted: true, deletedAt: Number(ev.deletedAt) || 0, deletedBy: ev.deletedBy || "" }
      : {}),
  };
}
// The retained log, and the seq of the newest event in it — where a reader
// that goes on to poll picks up from.
async function listChatMessages(): Promise<{ messages: unknown[]; cursor: number }> {
  // deno-lint-ignore no-explicit-any
  const recent: any[] = [];
  // deno-lint-ignore no-explicit-any
  for await (const e of kv.list<any>({ prefix: ["ev"] }, { reverse: true, limit: HISTORY })) {
    recent.push(e.value);
  }
  recent.reverse();
  const messages: unknown[] = [];
  let cursor = 0;
  for (const ev of recent) {
    if (ev && typeof ev.seq === "number") cursor = Math.max(cursor, ev.seq);
    if (!ev || ev.type !== "msg") continue;
    messages.push(chatLine(ev));
  }
  return { messages, cursor };
}

// Change some fields on an application record without clobbering whatever else
// moved in the meantime. The read-then-set used by the older admin routes can
// lose a write when two edits land together — a note saved at the same moment
// would put the old flag back. A moderation flag that quietly un-sets itself is
// not a moderation flag, so this re-reads and retries on a failed check and
// reports "busy" rather than writing blind.
// deno-lint-ignore no-explicit-any
async function patchApp(id: string, patch: Record<string, unknown>): Promise<any | "missing" | "busy"> {
  if (!id) return "missing";
  for (let attempt = 0; attempt < 8; attempt++) {
    // deno-lint-ignore no-explicit-any
    const cur = await kv.get<any>(["app", id]);
    if (!cur.value) return "missing";
    const next = { ...cur.value, ...patch };
    const res = await kv.atomic().check(cur).set(["app", id], next).commit();
    if (res.ok) return next;
  }
  return "busy";
}

// deno-lint-ignore no-explicit-any
async function authUser(token: string | null): Promise<any | null> {
  if (!token) return null;
  const t = await kv.get<string>(["tok", token]);
  if (!t.value) return null;
  // deno-lint-ignore no-explicit-any
  const app = await kv.get<any>(["app", t.value]);
  if (!app.value || app.value.status !== "approved") return null;
  return app.value;
}

// is this approved user currently shut out of the WHOLE shrine?
//   banned  -> permanent (no "until")
//   timeout -> blocked until app.timeoutUntil (ms epoch); expires on its own
// This is the wide gate: the casino, the pit, the veil and the chat all sit
// behind it. The chat-only ban is deliberately NOT here — see chatBlock().
// deno-lint-ignore no-explicit-any
function blockState(u: any): { blocked: boolean; reason?: string; until?: number; why?: string; kind?: string } {
  if (u.banned) return { blocked: true, reason: "banned", until: 0 };
  if (u.timeoutUntil && u.timeoutUntil > Date.now()) {
    // what tung wrote when he did it, and "sahur" when it was for farming the
    // altar — the lockout reads both; neither changes what is shut
    return {
      blocked: true, reason: "timeout", until: u.timeoutUntil,
      ...(u.timeoutWhy ? { why: String(u.timeoutWhy) } : {}),
      ...(u.timeoutKind === "sahur" ? { kind: "sahur" } : {}),
    };
  }
  return { blocked: false };
}

// is this approved user shut out of THE CHAT? A full ban or a live timeout
// closes the room along with everything else, and on top of those sits
// `chatBanned`: the room alone is shut — the casino, the pit, the catalog, the
// shop, the tables and the veil carry on untouched.
//
// This is the ONLY gate the chat routes may use. Anything that reads a line,
// writes one, or puts a member's name into the room goes through here; anything
// that does not touch the room stays on blockState(). Keeping the two apart is
// what makes a chat ban a chat ban and not a quieter version of the full one.
// The flag is read truthily, not `=== true`, so a record that somehow carries a
// non-boolean still fails closed.
// deno-lint-ignore no-explicit-any
function chatBlock(u: any): { blocked: boolean; reason?: string; until?: number; why?: string; kind?: string } {
  const bs = blockState(u);
  if (bs.blocked) return bs;
  if (u.chatBanned) return { blocked: true, reason: "chatban", until: 0 };
  return { blocked: false };
}

// --- direct messages ---------------------------------------------------------
const DM_TTL = 30 * 24 * 60 * 60 * 1000;   // a conversation ages out after a month of silence
const DM_PAGE = 300;                        // most lines one read of a conversation returns
// ---- what a DM is allowed to cost -------------------------------------------
// Everything here is a KV read or a KV write somebody is paying for, and every
// one of these routes carries a session token — which means it skips the
// anonymous 90-a-minute IP cap entirely. So until these caps existed, ONE
// approved account could ask for any of it as fast as it could open sockets.
//
// The shape of the abuse matters more than the volume. A conversation costs
// nothing much on its own; what is expensive is how MANY of them one account
// can bring into being, because every row it creates is a row every later read
// of that rail has to walk, for a month. Writing one line to every member of
// the shrine is a handful of requests and leaves behind a rail that costs
// hundreds of reads to open, on both sides, forever after. That is the thing
// being shut here: the fan-out, not the conversation.
//
// So: every list read is bounded, every route has a clock on it, and STARTING
// a conversation — the one operation with a lasting cost — is capped and
// timed far harder than replying in one that is already open. A real member
// never comes near any of it; a script trying to mint rails runs into all of
// them at once.
const DM_RAIL = Number(Deno.env.get("DM_RAIL") || 300);          // most conversations one read of a rail walks
const DM_CONV_MAX = Number(Deno.env.get("DM_CONV_MAX") || 80);   // conversations one account may OPEN
const DM_HOUR_MAX = Number(Deno.env.get("DM_HOUR_MAX") || 400);  // lines one account may send in an hour
const DM_DUMP = 1000;                       // most lines one admin dump of a conversation returns

// How many conversations this account is already in — counted no further than
// it has to be, because the answer is only ever compared against a cap. The
// list stops at `n`, so this is n reads at the very worst and usually far
// fewer. Only ever called on the one path that needs it: opening a NEW
// conversation, which is rare for a person and constant for a script.
async function dmConvCount(uid: string, n: number): Promise<number> {
  let c = 0;
  for await (const _e of kv.list({ prefix: ["dmconv", uid] }, { limit: n })) c++;
  return c;
}
// `del` marks a retraction rather than a line: "the line at this seq is gone".
// It rides the conversation's own stream so that a window already showing
// that line drops it on its next poll, at no cost to any poll — see
// dmRetract(). It is never drawn and never counted as something said.
// `deleted` is on the line that was taken back: it stays where it was, for the
// admin dump, and no member's read ever serves it again.
type DmMsg = { seq: number; from: string; text: string; ts: number; del?: number; deleted?: boolean; deletedAt?: number };
// `hid` is the seqs above `read` that are not something to read — a line its
// author took back, and the marker that says so. Unread is everything past the
// read mark less those; reading past them drops them. Almost always absent.
// `dels` counts the retraction markers in the stream, so seq less dels is how
// many lines were written — what the admin dump's picker says. Usually absent.
type DmConv = { name: string; last: string; ts: number; seq: number; read: number; hid?: number[]; dels?: number };
function dmUnread(v: DmConv): number {
  const read = Number(v.read) || 0;
  const hid = (v.hid || []).filter((s) => s > read).length;
  return Math.max(0, (Number(v.seq) || 0) - read - hid);
}

// The pair IS the key, sorted so both sides name the same conversation. That is
// what makes access a matter of arithmetic rather than a check somebody can
// forget to write: the only conversation ids you can build are ones you are in.
function convOf(a: string, b: string): string {
  return a < b ? a + "~" + b : b + "~" + a;
}
// Tung has no account, and a direct message still needs two sides. This id is
// not hex — rid() only ever emits hex — so it cannot collide with a member or
// be approved into one. The name is the one the room already refuses to anyone
// else. The client keys off from:"tung" and paints his portrait and gold name
// on an ordinary DM line — not the room's "the shrine" mark, which on a private
// conversation read as the public room.
const TUNG_DM_ID = "tung!voice";
function tungVoice(): { id: string; username: string; status: "approved" } {
  return { id: TUNG_DM_ID, username: WISDOM_NAME, status: "approved" };
}
function dmPeerView(other: { id: string; username: string }) {
  return {
    id: other.id,
    name: other.username,
    ...(other.id === TUNG_DM_ID ? { tung: true } : {}),
  };
}
// Who the other end is, by username or by id. Usernames are what the client
// has — it reads them off the room — so both are accepted. He is named here
// too, by the id the rail stores or by the name the room already knows, so a
// reply has somewhere to go. Checked before the account lookup on purpose: he
// is not an account, and nothing that reduces to his name is allowed to be.
// deno-lint-ignore no-explicit-any
async function dmOther(who: unknown): Promise<any | null> {
  const s = clip(who, 32);
  if (!s) return null;
  if (s === TUNG_DM_ID || impersonatesTung(s)) return tungVoice();
  // deno-lint-ignore no-explicit-any
  const byId = await kv.get<any>(["app", s]);
  if (byId.value && byId.value.status === "approved") return byId.value;
  const byName = await kv.get<string>(["name", s.toLowerCase()]);
  if (!byName.value) return null;
  // deno-lint-ignore no-explicit-any
  const app = await kv.get<any>(["app", byName.value]);
  return app.value && app.value.status === "approved" ? app.value : null;
}
// ---- blocking ----------------------------------------------------------
// A block is a fact about the PAIR, not about one person's list, so it lives
// under the same sorted key the conversation does and costs the one read the
// conversation was already going to make. Two flags rather than one "blockedBy"
// because both ends can block at once, and one of them lifting theirs must not
// quietly lift the other's.
//
// It shuts the conversation in both directions. A block that only stopped them
// writing would leave you able to write at somebody who cannot answer, which is
// not what anybody means by the word — and it would let the pair's history keep
// growing out of one side. So: neither writes, neither reads, and the rail says
// so rather than pretending the conversation was never there.
//
// And the end that was blocked is TOLD, by name: "you have been blocked by X".
// It used to read only "closed", which left somebody writing into a door that
// would never open with no way to know why. A block is a DM matter and nothing
// more — both of them still see each other in the room exactly as before.
type DmBlock = { lo: boolean; hi: boolean };
// which flag is whose, decided the same way convOf() decides the key
function dmSide(me: string, them: string): "lo" | "hi" { return me < them ? "lo" : "hi"; }
async function dmBlockOf(a: string, b: string): Promise<DmBlock> {
  // tung is not somebody a member can shut the door on: no block holds against
  // his conversation, including any set before this rule was, so his DMs and
  // the panel's replies always go through
  if (a === TUNG_DM_ID || b === TUNG_DM_ID) return { lo: false, hi: false };
  const e = await kv.get<DmBlock>(["dmblock", convOf(a, b)]);
  return { lo: !!e.value?.lo, hi: !!e.value?.hi };
}
function dmBlocked(bl: DmBlock): boolean { return bl.lo || bl.hi; }
async function dmSetBlock(me: string, them: string, on: boolean): Promise<DmBlock> {
  const key = ["dmblock", convOf(me, them)];
  const side = dmSide(me, them);
  for (let i = 0; i < 4; i++) {
    const e = await kv.get<DmBlock>(key);
    const cur: DmBlock = { lo: !!e.value?.lo, hi: !!e.value?.hi };
    const next: DmBlock = { ...cur, [side]: on };
    if (cur.lo === next.lo && cur.hi === next.hi) return cur;
    // nobody blocking anybody is the absence of a record, not a record of two
    // falses — otherwise every pair that ever fell out keeps a row for a month
    const op = kv.atomic().check(e);
    const res = await (next.lo || next.hi
      ? op.set(key, next, { expireIn: DM_TTL })
      : op.delete(key)).commit();
    if (res.ok) return next;
  }
  return await dmBlockOf(me, them);
}

async function dmMarkRead(uid: string, other: string, upto: number): Promise<void> {
  for (let i = 0; i < 4; i++) {
    const e = await kv.get<DmConv>(["dmconv", uid, other]);
    const v = e.value;
    if (!v || (Number(v.read) || 0) >= upto) return;
    const hid = (v.hid || []).filter((s) => s > upto);
    const next: DmConv = { ...v, read: upto };
    if (hid.length) next.hid = hid;
    else delete next.hid;
    const res = await kv.atomic().check(e)
      .set(["dmconv", uid, other], next, { expireIn: DM_TTL })
      .commit();
    if (res.ok) return;
  }
}
// One line, and both sides' view of the conversation, in a single commit —
// so a message can never exist without showing up in the list that points at
// it, and the list can never promise a line that was never written.
// deno-lint-ignore no-explicit-any
async function dmAppend(from: any, to: any, text: string): Promise<DmMsg | null> {
  const conv = convOf(from.id, to.id);
  const preview = text.slice(0, 120);
  for (let attempt = 0; attempt < 8; attempt++) {
    const seqE = await kv.get<number>(["dmseq", conv]);
    const mineE = await kv.get<DmConv>(["dmconv", from.id, to.id]);
    const theirsE = await kv.get<DmConv>(["dmconv", to.id, from.id]);
    const seq = (Number(seqE.value) || 0) + 1;
    const msg: DmMsg = { seq, from: from.id, text, ts: Date.now() };
    const res = await kv.atomic()
      .check(seqE).check(mineE).check(theirsE)
      .set(["dmseq", conv], seq, { expireIn: DM_TTL })
      .set(["dmev", conv, seq], msg, { expireIn: DM_TTL })
      // the sender has by definition read their own line
      .set(["dmconv", from.id, to.id], {
        name: to.username, last: preview, ts: msg.ts, seq, read: seq,
        ...(mineE.value?.dels ? { dels: mineE.value.dels } : {}),
      }, { expireIn: DM_TTL })
      // the recipient's read mark is left exactly where it was, which is what
      // turns into their unread count
      .set(["dmconv", to.id, from.id], {
        name: from.username, last: preview, ts: msg.ts, seq,
        read: Number(theirsE.value?.read) || 0,
        ...(theirsE.value?.hid?.length ? { hid: theirsE.value.hid } : {}),
        ...(theirsE.value?.dels ? { dels: theirsE.value.dels } : {}),
      }, { expireIn: DM_TTL })
      .commit();
    if (res.ok) return msg;
  }
  return null;
}

// Take back one of your own lines. The line itself is marked deleted (kept for
// the admin dump, never served to a member again), and a marker takes the next
// seq in its place, so the other end's open window — which
// only ever asks for what is past the seq it has — learns about it on its next
// ordinary poll. Keeping a separate list of deletions instead would put one
// more read on every poll of every open conversation, forever.
//
// Both rails are moved in the same commit. The preview becomes the newest
// line still standing, and neither the marker nor the line it names is left
// counting as unread: both go on the reader's `hid`, which the badge
// subtracts, so taking a line back cannot leave a badge counting nothing.
// deno-lint-ignore no-explicit-any
async function dmRetract(me: any, other: any, target: number): Promise<"ok" | "gone" | "forbidden" | "busy"> {
  const conv = convOf(me.id, other.id);
  for (let attempt = 0; attempt < 8; attempt++) {
    const line = await kv.get<DmMsg>(["dmev", conv, target]);
    if (!line.value || line.value.del || line.value.deleted) return "gone";
    if (line.value.from !== me.id) return "forbidden";
    const seqE = await kv.get<number>(["dmseq", conv]);
    const mineE = await kv.get<DmConv>(["dmconv", me.id, other.id]);
    const theirsE = await kv.get<DmConv>(["dmconv", other.id, me.id]);
    const seq = (Number(seqE.value) || 0) + 1;
    // the newest line that will still be standing, for the preview
    let last = "";
    for await (
      const e of kv.list<DmMsg>({ prefix: ["dmev", conv] }, { reverse: true, limit: 25 })
    ) {
      const v = e.value;
      if (!v || v.del || v.deleted || v.seq === target) continue;
      last = String(v.text || "").slice(0, 120);
      break;
    }
    const mark: DmMsg = { seq, from: me.id, text: "", ts: Date.now(), del: target };
    // the line keeps the clock it had, and is marked rather than removed: the
    // admin dump still shows it, as deleted, and nothing a member reads does
    const left = DM_TTL - (Date.now() - (Number(line.value.ts) || Date.now()));
    const op = kv.atomic()
      .check(line).check(seqE).check(mineE).check(theirsE)
      .set(["dmev", conv, target], { ...line.value, deleted: true, deletedAt: Date.now() }, { expireIn: Math.max(60_000, left) })
      .set(["dmseq", conv], seq, { expireIn: DM_TTL })
      .set(["dmev", conv, seq], mark, { expireIn: DM_TTL });
    if (mineE.value) {
      const mine: DmConv = { ...mineE.value, last, seq, read: seq, dels: (Number(mineE.value.dels) || 0) + 1 };
      delete mine.hid; // everything up to here is read on this side
      op.set(["dmconv", me.id, other.id], mine, { expireIn: DM_TTL });
    }
    if (theirsE.value) {
      const was = Number(theirsE.value.read) || 0;
      // bounded: a long run of deletions they never opened only ever makes
      // the badge read a little high, never grows the row without end
      const hid = (theirsE.value.hid || []).filter((s) => s > was)
        .concat(target > was ? [target, seq] : [seq]).slice(-200);
      op.set(["dmconv", other.id, me.id], {
        ...theirsE.value, last, seq, hid, dels: (Number(theirsE.value.dels) || 0) + 1,
      }, { expireIn: DM_TTL });
    }
    if ((await op.commit()).ok) return "ok";
  }
  return "busy";
}

// ---- what is left of an account that no longer exists ----------------------
//
// Deleting an account used to take the account and its money and leave every
// word it had written: its lines in the room, its reactions, and both halves
// of every conversation it was in, which the panel then listed as "(gone)".
// These take all of that with it.
//
// None of it runs on a poll. It runs when an account is deleted, when every
// application is cleared, from the panel's one-off clean-up, and — for a
// single conversation — at the moments something is already looking at a
// "(gone)" row and has paid for the read that noticed.

// Deletes in small commits, so no single one can run into a size limit.
async function kvDeleteAll(keys: Deno.KvKey[]): Promise<void> {
  for (let i = 0; i < keys.length; i += 10) {
    const op = kv.atomic();
    for (const k of keys.slice(i, i + 10)) op.delete(k);
    await op.commit();
  }
}

// One conversation, both sides of it: every line, its counter, its block and
// the row on each rail.
async function purgeConversation(a: string, b: string): Promise<void> {
  const conv = convOf(a, b);
  const keys: Deno.KvKey[] = [];
  for await (const e of kv.list({ prefix: ["dmev", conv] })) keys.push(e.key);
  keys.push(["dmseq", conv], ["dmblock", conv], ["dmconv", a, b], ["dmconv", b, a]);
  await kvDeleteAll(keys);
}

// Every conversation with an end in `dead`, found from the rails rather than
// from the dead account's own: a reader's row outlives the writer's, because
// reading refreshes its clock, so the dead end's rail can be missing rows the
// living ends still show.
async function purgeDmsOf(dead: Set<string>): Promise<number> {
  const pairs = new Map<string, [string, string]>();
  for await (const e of kv.list({ prefix: ["dmconv"] })) {
    const owner = String(e.key[1]), other = String(e.key[2]);
    if (dead.has(owner) || dead.has(other)) pairs.set(convOf(owner, other), [owner, other]);
  }
  for (const [a, b] of pairs.values()) await purgeConversation(a, b);
  return pairs.size;
}

// Their lines in the room, the quote index behind them, their reactions, and
// quotes of their words inside other people's replies. A line knows its
// author's id through the quote index (`uid`); one written before that was
// recorded is matched by name, and only against names given here, which are
// names no living account holds.
async function purgeRoomOf(dead: Set<string>, deadNames: Set<string>): Promise<number> {
  const ownedBy = (ref: { uid?: string; name?: unknown; from?: unknown }) =>
    ref.uid ? dead.has(ref.uid) : !ref.from && deadNames.has(String(ref.name ?? "").toLowerCase());
  const uidOf = new Map<string, string>();
  const gone = new Set<string>();
  const shown: string[] = []; // the ones in the window, which a client can be showing
  const drop: Deno.KvKey[] = [];
  for await (const e of kv.list<MsgRef>({ prefix: ["msg"] })) {
    const v = e.value;
    if (!v) continue;
    if (v.uid) uidOf.set(String(e.key[1]), v.uid);
    if (ownedBy(v)) {
      gone.add(String(e.key[1]));
      drop.push(e.key);
    }
  }
  // deno-lint-ignore no-explicit-any
  const rewrite: { key: Deno.KvKey; value: any; ts: number }[] = [];
  // deno-lint-ignore no-explicit-any
  for await (const e of kv.list<any>({ prefix: ["ev"] })) {
    const v = e.value;
    if (!v) continue;
    if (v.type === "msg") {
      const uid = uidOf.get(String(v.id));
      if (gone.has(String(v.id)) || ownedBy({ uid, name: v.name, from: v.from })) {
        gone.add(String(v.id));
        if (!deletedLine(v)) shown.push(String(v.id));
        drop.push(e.key);
        continue;
      }
      if (v.reply && (gone.has(String(v.reply.id)) || deadNames.has(String(v.reply.name ?? "").toLowerCase()))) {
        rewrite.push({ key: e.key, value: { ...v, reply: null }, ts: Number(v.ts) || Date.now() });
      }
    } else if (v.type === "react" && deadNames.has(String(v.name ?? "").toLowerCase())) {
      drop.push(e.key);
    }
  }
  for (const id of dead) {
    for await (const e of kv.list({ prefix: ["rx", id] })) drop.push(e.key);
  }
  await kvDeleteAll(drop);
  // a reply keeps its own words and loses the quote, and keeps the clock it
  // already had rather than starting a fresh two weeks
  for (const r of rewrite) {
    const left = TTL_MS - (Date.now() - r.ts);
    if (left > 60_000) await kv.set(r.key, r.value, { expireIn: left });
  }
  // one event for all of it, so every open window drops the lines at once
  // without the log filling up with a delete per line. Only lines still in the
  // log can be on anybody's screen, and the log is capped, so this is too.
  if (shown.length) await appendEvent({ type: "del", id: shown[0], ids: shown });
  return gone.size;
}

// Everything left behind by accounts that are already gone. The ids come off
// the rails and the reaction rows, the only places a dead id is still written
// down; each distinct one is looked up once. Names for the older room lines
// come off the rails too — the name a conversation last knew them by — and
// only when no living account holds that name now.
async function purgeGone(): Promise<{ accounts: number; conversations: number; lines: number }> {
  const seen = new Map<string, string>(); // id -> last name the rails knew
  for await (const e of kv.list<DmConv>({ prefix: ["dmconv"] })) {
    const owner = String(e.key[1]), other = String(e.key[2]);
    if (owner !== TUNG_DM_ID && !seen.has(owner)) seen.set(owner, "");
    if (other !== TUNG_DM_ID) seen.set(other, String(e.value?.name || seen.get(other) || ""));
  }
  for await (const e of kv.list({ prefix: ["rx"] })) {
    const id = String(e.key[1]);
    if (!seen.has(id)) seen.set(id, "");
  }
  for await (const e of kv.list<MsgRef>({ prefix: ["msg"] })) {
    const id = e.value?.uid;
    if (id && !seen.has(id)) seen.set(id, "");
  }
  const ids = [...seen.keys()];
  const dead = new Set<string>();
  for (let i = 0; i < ids.length; i += 10) {
    const batch = ids.slice(i, i + 10);
    const got = await kv.getMany(batch.map((id) => ["app", id]));
    got.forEach((g, k) => { if (!g.value) dead.add(batch[k]); });
  }
  const deadNames = new Set<string>();
  for (const id of dead) {
    const n = (seen.get(id) || "").toLowerCase();
    if (n && !(await kv.get(["name", n])).value) deadNames.add(n);
  }
  if (!dead.size) return { accounts: 0, conversations: 0, lines: 0 };
  const conversations = await purgeDmsOf(dead);
  const lines = await purgeRoomOf(dead, deadNames);
  return { accounts: dead.size, conversations, lines };
}

// ---- sahur watch: catching autoclaimers -------------------------------------
//
// The faucet pays FAUCET_AMOUNT every FAUCET_INTERVAL, and tung's giveaways pay
// whoever clicks first. A script can do both forever: claim the second the
// cooldown ends, around the clock, and win every giveaway before a person has
// read it. So every claim of either kind is written down — when, how long
// after it became available, from which network (a salted hash, never the
// address), and what the page could say about the click — and a set of rules
// reads that log each time the member claims again.
//
// The rules are in this file, which is public. What they are set TO is not:
// every number, and whether each rule is on at all, lives in KV and is changed
// from the panel. Knowing that a rule exists does not tell anybody where its
// line is, and getting under all of them at once means claiming like a person
// — irregularly, not instantly, and not while asleep — which is the point.
//
// Nothing here runs on a poll. It runs when somebody claims (twelve times a
// day at most for the faucet) and when the panel asks.
//
// KV:
//   ["claimlog", uid, ts, rid]  -> ClaimLog   one claim, kept keepDays
//   ["claimnet", net, ts, uid]  -> 1          which accounts claimed from a network
//   ["watch", "config"]         -> WatchConfig
//   ["watch", "flag", uid]      -> WatchFlag  the review queue
//   ["claimpen", uid]           -> ClaimPenalty
type ClaimCli = { tr?: number; vis?: number; foc?: number; idle?: number };
type ClaimLog = {
  ts: number; kind: "faucet" | "gift"; amt: number;
  lag?: number;          // ms between becoming claimable and being claimed
  net?: string; cli?: ClaimCli; gid?: string;
};
type WatchRules = {
  volume: { on: boolean; count: number; hours: number };
  quick: { on: boolean; count: number; of: number; seconds: number };
  regular: { on: boolean; of: number; seconds: number };
  nosleep: { on: boolean; hours: number; count: number; gapHours: number };
  streak: { on: boolean; perDay: number; days: number };
  noclick: { on: boolean; count: number; of: number };
  hidden: { on: boolean; count: number; of: number };
  still: { on: boolean; count: number; of: number; seconds: number };
  giftfast: { on: boolean; count: number; of: number; ms: number };
  giftmany: { on: boolean; count: number; hours: number };
  sharednet: { on: boolean; accounts: number; hours: number };
};
type WatchConfig = { on: boolean; minRules: number; quietDays: number; keepDays: number; rules: WatchRules };
type WatchHit = { rule: string; detail: string };
type WatchFlag = {
  uid: string; name: string; at: number; lastAt: number; hits: WatchHit[];
  status: "open" | "closed"; closedAt?: number; verdict?: string; quietUntil?: number;
};
type ClaimPenalty = {
  banUntil?: number; banGifts?: boolean;
  reduceUntil?: number; reducePct?: number;
  slowUntil?: number; slowX?: number;
  at: number; note?: string;
};
// Only the starting point. The panel's saved config replaces all of it.
const WATCH_DEFAULTS: WatchConfig = {
  on: true, minRules: 1, quietDays: 3, keepDays: 30,
  rules: {
    volume: { on: true, count: 10, hours: 24 },
    quick: { on: true, count: 8, of: 10, seconds: 90 },
    regular: { on: true, of: 8, seconds: 180 },
    nosleep: { on: true, hours: 30, count: 11, gapHours: 5 },
    streak: { on: true, perDay: 9, days: 3 },
    noclick: { on: true, count: 3, of: 5 },
    hidden: { on: true, count: 4, of: 10 },
    still: { on: true, count: 3, of: 5, seconds: 600 },
    giftfast: { on: true, count: 3, of: 5, ms: 1500 },
    giftmany: { on: true, count: 6, hours: 24 },
    sharednet: { on: false, accounts: 3, hours: 24 },
  },
};
// what each rule is called on the panel and in a flag
const WATCH_NAMES: Record<keyof WatchRules, string> = {
  volume: "too many claims", quick: "claims the instant it is ready", regular: "clockwork timing",
  nosleep: "never sleeps", streak: "day after day", noclick: "no real click",
  hidden: "claims from a hidden tab", still: "hands never move", giftfast: "snipes giveaways", giftmany: "wins too many giveaways",
  sharednet: "shared network",
};
function watchNum(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
}
// Whatever the panel sends is clamped into shape; anything missing keeps its default.
// deno-lint-ignore no-explicit-any
function watchClean(raw: any): WatchConfig {
  const d = WATCH_DEFAULTS, r = raw && typeof raw === "object" ? raw : {};
  const rr = r.rules && typeof r.rules === "object" ? r.rules : {};
  // deno-lint-ignore no-explicit-any
  const rule = (k: keyof WatchRules, spec: Record<string, [number, number]>): any => {
    const src = rr[k] && typeof rr[k] === "object" ? rr[k] : {};
    // deno-lint-ignore no-explicit-any
    const out: any = { on: src.on === undefined ? d.rules[k].on : src.on === true };
    // deno-lint-ignore no-explicit-any
    for (const [f, [lo, hi]] of Object.entries(spec)) out[f] = watchNum(src[f], lo, hi, (d.rules[k] as any)[f]);
    return out;
  };
  return {
    on: r.on === undefined ? d.on : r.on === true,
    minRules: Math.round(watchNum(r.minRules, 1, 10, d.minRules)),
    quietDays: watchNum(r.quietDays, 0, 90, d.quietDays),
    keepDays: Math.round(watchNum(r.keepDays, 3, 90, d.keepDays)),
    rules: {
      volume: rule("volume", { count: [1, 500], hours: [1, 24 * 14] }),
      quick: rule("quick", { count: [1, 100], of: [1, 100], seconds: [1, 7200] }),
      regular: rule("regular", { of: [3, 100], seconds: [1, 7200] }),
      nosleep: rule("nosleep", { hours: [6, 24 * 7], count: [2, 500], gapHours: [0.5, 48] }),
      streak: rule("streak", { perDay: [1, 100], days: [1, 30] }),
      noclick: rule("noclick", { count: [1, 100], of: [1, 100] }),
      hidden: rule("hidden", { count: [1, 100], of: [1, 100] }),
      still: rule("still", { count: [1, 100], of: [1, 100], seconds: [5, 86_400] }),
      giftfast: rule("giftfast", { count: [1, 100], of: [1, 100], ms: [50, 60000] }),
      giftmany: rule("giftmany", { count: [1, 500], hours: [1, 24 * 14] }),
      sharednet: rule("sharednet", { accounts: [2, 100], hours: [1, 24 * 14] }),
    },
  };
}
// Read on every claim, so it is kept for half a minute per isolate; a save from
// the panel lands in this isolate at once and in the others within that.
let watchCache: { cfg: WatchConfig; at: number } | null = null;
async function watchConfig(): Promise<WatchConfig> {
  if (watchCache && Date.now() - watchCache.at < 30_000) return watchCache.cfg;
  const e = await kv.get(["watch", "config"]);
  const cfg = watchClean(e.value);
  watchCache = { cfg, at: Date.now() };
  return cfg;
}
async function claimPenalty(uid: string): Promise<ClaimPenalty | null> {
  const e = await kv.get<ClaimPenalty>(["claimpen", uid]);
  return e.value || null;
}
// the penalty as it stands right now: nothing that has run out
function penaltyNow(p: ClaimPenalty | null, now = Date.now()) {
  return {
    banned: !!p && (Number(p.banUntil) || 0) > now,
    banUntil: Number(p?.banUntil) || 0,
    banGifts: p?.banGifts !== false,
    reducePct: p && (Number(p.reduceUntil) || 0) > now ? watchNum(p.reducePct, 0, 100, 100) : 100,
    reduceUntil: Number(p?.reduceUntil) || 0,
    slowX: p && (Number(p.slowUntil) || 0) > now ? watchNum(p.slowX, 1, 50, 1) : 1,
    slowUntil: Number(p?.slowUntil) || 0,
  };
}
// A network, as a tag that can be compared between members and never read
// back into an address.
async function netTag(ip: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("net|" + ADMIN_KEY + "|" + ip));
  return [...new Uint8Array(buf)].slice(0, 5).map((b) => b.toString(16).padStart(2, "0")).join("");
}
// What the page said about the click, clamped: a claim straight from a script
// sends nothing, and says so by that.
// deno-lint-ignore no-explicit-any
function cleanCli(c: any): ClaimCli | undefined {
  if (!c || typeof c !== "object") return undefined;
  return {
    tr: c.tr === 1 ? 1 : 0, vis: c.vis === 1 ? 1 : 0, foc: c.foc === 1 ? 1 : 0,
    idle: Math.round(watchNum(c.idle, 0, 86_400_000, 0)),
  };
}
async function claimLogs(uid: string, limit = 150): Promise<ClaimLog[]> {
  const out: ClaimLog[] = [];
  for await (const e of kv.list<ClaimLog>({ prefix: ["claimlog", uid] }, { limit, reverse: true })) {
    if (e.value) out.push(e.value);
  }
  return out.reverse(); // oldest first
}
// "1 claim", "12 claims"
function many(n: number, word: string): string {
  return n + " " + word + (n === 1 ? "" : "s");
}
function fmtGap(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 90) return s + "s";
  if (s < 5400) return Math.round(s / 60) + "m";
  return (Math.round(s / 360) / 10) + "h";
}
// Every enabled rule against one member's log. Pure: the panel calls it to
// show what trips right now, and the claim routes call it to decide a flag.
function watchEval(cfg: WatchConfig, logs: ClaimLog[], now: number, shared: number): WatchHit[] {
  const R = cfg.rules, hits: WatchHit[] = [];
  const hit = (rule: keyof WatchRules, detail: string) => hits.push({ rule, detail });
  const faucet = logs.filter((l) => l.kind === "faucet");
  const gifts = logs.filter((l) => l.kind === "gift");
  const lastN = <T>(a: T[], n: number) => a.slice(Math.max(0, a.length - n));
  if (R.volume.on) {
    const n = faucet.filter((l) => l.ts > now - R.volume.hours * 3600_000).length;
    if (n >= R.volume.count) hit("volume", many(n, "claim") + " in " + R.volume.hours + "h (flag at " + R.volume.count + ")");
  }
  if (R.quick.on) {
    const seen = lastN(faucet.filter((l) => typeof l.lag === "number"), R.quick.of);
    const n = seen.filter((l) => (l.lag as number) <= R.quick.seconds * 1000).length;
    if (seen.length >= R.quick.count && n >= R.quick.count) {
      hit("quick", n + " of the last " + seen.length + " claims within " + R.quick.seconds + "s of the cooldown ending");
    }
  }
  if (R.regular.on && faucet.length >= R.regular.of + 1) {
    const f = lastN(faucet, R.regular.of + 1);
    const gaps = f.slice(1).map((l, i) => l.ts - f[i].ts);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const sd = Math.sqrt(gaps.reduce((a, b) => a + (b - mean) * (b - mean), 0) / gaps.length);
    if (sd <= R.regular.seconds * 1000) {
      hit("regular", "the last " + gaps.length + " gaps were " + fmtGap(mean) + " give or take " + fmtGap(sd));
    }
  }
  if (R.nosleep.on) {
    const f = faucet.filter((l) => l.ts > now - R.nosleep.hours * 3600_000);
    if (f.length >= R.nosleep.count && f[f.length - 1].ts - f[0].ts >= R.nosleep.hours * 3600_000 * 0.75) {
      let longest = 0;
      for (let i = 1; i < f.length; i++) longest = Math.max(longest, f[i].ts - f[i - 1].ts);
      if (longest < R.nosleep.gapHours * 3600_000) {
        hit("nosleep", "longest break in the last " + R.nosleep.hours + "h was " + fmtGap(longest) +
          " (flag under " + R.nosleep.gapHours + "h)");
      }
    }
  }
  if (R.streak.on) {
    let days = 0;
    for (let d = 0; d < R.streak.days; d++) {
      const hi = now - d * 86_400_000, lo = hi - 86_400_000;
      if (faucet.filter((l) => l.ts > lo && l.ts <= hi).length >= R.streak.perDay) days++;
      else break;
    }
    if (days >= R.streak.days) hit("streak", R.streak.perDay + "+ claims a day for " + many(days, "day") + " running");
  }
  const recent = (n: number) => lastN(logs, n);
  if (R.noclick.on) {
    const seen = recent(R.noclick.of);
    const n = seen.filter((l) => !l.cli || l.cli.tr !== 1).length;
    if (n >= R.noclick.count) hit("noclick", n + " of the last " + seen.length + " claims came without a real click");
  }
  if (R.hidden.on) {
    const seen = recent(R.hidden.of);
    const n = seen.filter((l) => l.cli && l.cli.vis === 0).length;
    if (n >= R.hidden.count) hit("hidden", n + " of the last " + seen.length + " claims were made from a hidden tab");
  }
  if (R.still.on) {
    // a real click, but nothing moved before it: a macro on a mouse nobody holds
    const seen = recent(R.still.of);
    const n = seen.filter((l) => l.cli && l.cli.tr === 1 && (Number(l.cli.idle) || 0) >= R.still.seconds * 1000).length;
    if (n >= R.still.count) {
      hit("still", n + " of the last " + seen.length + " claims were clicked with nothing moved for " +
        fmtGap(R.still.seconds * 1000) + " before");
    }
  }
  if (R.giftfast.on) {
    const seen = lastN(gifts.filter((l) => typeof l.lag === "number"), R.giftfast.of);
    const n = seen.filter((l) => (l.lag as number) <= R.giftfast.ms).length;
    if (n >= R.giftfast.count) hit("giftfast", n + " of the last " + seen.length + " giveaways taken within " + R.giftfast.ms + "ms");
  }
  if (R.giftmany.on) {
    const n = gifts.filter((l) => l.ts > now - R.giftmany.hours * 3600_000).length;
    if (n >= R.giftmany.count) hit("giftmany", many(n, "giveaway") + " won in " + R.giftmany.hours + "h (flag at " + R.giftmany.count + ")");
  }
  if (R.sharednet.on && shared >= R.sharednet.accounts) {
    hit("sharednet", shared + " accounts claimed from the same network in " + R.sharednet.hours + "h");
  }
  return hits;
}
// Who claimed from a network in the last so many hours, most recent first.
async function sharedOn(net: string | undefined, hours: number, now: number): Promise<string[]> {
  if (!net) return [];
  const ids = new Set<string>();
  for await (
    const e of kv.list({ prefix: ["claimnet", net], start: ["claimnet", net, now - hours * 3600_000] }, { limit: 500, reverse: true })
  ) ids.add(String(e.key[3]));
  return [...ids];
}
// One member's log against the rules, and the review queue updated to match.
// A verdict — punished or dismissed — starts the evidence again from that
// moment, so what they were already judged for does not flag them a second
// time; a dismissal also keeps them off the queue for quietDays.
// Returns whether they are (now) flagged.
async function watchJudge(u: { id: string; username: string }, cfg: WatchConfig, net?: string): Promise<boolean> {
  const flagE = await kv.get<WatchFlag>(["watch", "flag", u.id]);
  const f = flagE.value;
  const now = Date.now();
  if (f && f.status === "closed" && (Number(f.quietUntil) || 0) > now) return false;
  let logs = await claimLogs(u.id);
  if (f && f.status === "closed") logs = logs.filter((l) => l.ts > (Number(f.closedAt) || 0));
  if (!logs.length) return !!f && f.status === "open";
  const lastNet = net || logs[logs.length - 1].net;
  const shared = cfg.rules.sharednet.on ? (await sharedOn(lastNet, cfg.rules.sharednet.hours, now)).length : 0;
  const hits = watchEval(cfg, logs, now, shared);
  if (hits.length < cfg.minRules) return !!f && f.status === "open";
  const next: WatchFlag = f && f.status === "open"
    ? { ...f, name: u.username, lastAt: now, hits }
    : { uid: u.id, name: u.username, at: now, lastAt: now, hits, status: "open" };
  await kv.set(["watch", "flag", u.id], next);
  return true;
}
// One claim: write it down, then judge. Never allowed to break the claim it
// follows.
async function watchClaim(
  u: { id: string; username: string }, entry: ClaimLog, ip: string,
): Promise<void> {
  try {
    const cfg = await watchConfig();
    const keep = cfg.keepDays * 86_400_000;
    entry.net = await netTag(ip);
    await kv.atomic()
      .set(["claimlog", u.id, entry.ts, rid(4)], entry, { expireIn: keep })
      .set(["claimnet", entry.net, entry.ts, u.id], 1, { expireIn: keep })
      .commit();
    if (cfg.on) await watchJudge(u, cfg, entry.net);
  } catch (_e) { /* a claim is never refused because the watch could not look */ }
}

// Rate limits: 90 req/min per IP for *anonymous* traffic, plus per-token
// caps on /events. A school NAT is fine because approved shrine/casino
// tabs send a token and skip the IP bucket. Scrapers with no token hit
// the 90/min wall. Isolates do not share this map. This process never
// serveDir()s the repo and never fetch()es game files for a client.
type Bucket = { n: number; reset: number };
const buckets = new Map<string, Bucket>();
let sweepN = 0;
// The client-facing edge appends the real peer to x-forwarded-for, so the
// address we can trust is the LAST hop, not the first. Reading the first entry
// (as this used to) trusts a header the client writes: anyone can send
// "x-forwarded-for: <anything>" and mint a fresh rate-limit identity per
// request, which is the whole "rotate the header in Burp and the IP cap is
// gone" bypass. The real connecting address from Deno is the ground truth when
// there is no proxy in front, so fall back to it.
function clientIp(req: Request, info?: { remoteAddr?: { hostname?: string } }): string {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) {
    const hops = xf.split(",").map((h) => h.trim()).filter(Boolean);
    const last = hops[hops.length - 1];
    if (last) return last.slice(0, 80);
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real.slice(0, 80);
  return (info?.remoteAddr?.hostname || "unknown").slice(0, 80);
}
// Any issued token (pending or approved) skips the anonymous IP cap.
async function hasSessionToken(token: string): Promise<boolean> {
  if (!token) return false;
  const t = await kv.get<string>(["tok", token]);
  return !!t.value;
}
async function requestIsAuthed(req: Request, url: URL): Promise<boolean> {
  const qTok = clip(url.searchParams.get("token"), 64);
  if (qTok && await hasSessionToken(qTok)) return true;
  if (adminOk(req, url)) return true;
  if (req.method === "POST") {
    const peek = await req.clone().json().catch(() => null) as Record<string, unknown> | null;
    if (peek && typeof peek === "object") {
      const t = clip(peek.token, 64);
      if (t && await hasSessionToken(t)) return true;
      if (ADMIN_KEY && String(peek.key ?? "") === ADMIN_KEY) return true;
    }
  }
  return false;
}
function allow(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  if (++sweepN > 2000) {
    sweepN = 0;
    for (const [k, b] of buckets) if (now >= b.reset) buckets.delete(k);
  }
  const b = buckets.get(key);
  if (!b || now >= b.reset) {
    buckets.set(key, { n: 1, reset: now + windowMs });
    return true;
  }
  if (b.n >= limit) return false;
  b.n++;
  return true;
}
function tooMany(retrySec = 30): Response {
  return new Response(JSON.stringify({ error: "slow down" }), {
    status: 429,
    headers: { "content-type": "application/json", "retry-after": String(retrySec), ...CORS },
  });
}

// The door. It is deliberately tiny — the full panel is ~37KB and serving that
// to every scanner that finds /admin was free egress — and it is also the only
// place the key is ever typed.
//
// It does NOT navigate anywhere with the key on it. It posts the key, gets the
// panel back as a document, and writes it into the page it is already on. The
// address bar says /admin the whole way through, so the key never reaches
// history, a bookmark, a screenshot of the URL, or any access log in between.
//
// Kept under 800 bytes on the wire, which scripts/test-egress-guard.ts holds it
// to — that is the whole reason there is a door rather than just the panel. It
// is written tight for that reason and not out of taste; if it needs to grow,
// grow the budget in that test deliberately rather than by accident.
const ADMIN_GATE = `<!doctype html><meta charset="utf-8"><title>admin</title>
<body style="font:16px system-ui;background:#1d1206;color:#f5efe0;padding:24px">
<form><input name=key type=password placeholder="admin key" style="padding:8px"><button>open</button></form>
<p id=m style="color:#e0908a"></p>
<script>onsubmit=function(e){e.preventDefault();var k=e.target.key.value.trim(),m=document.getElementById("m");if(!k)return;m.textContent="opening\u2026";fetch("/admin",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({key:k})}).then(function(r){return r.ok?r.text():null}).then(function(h){if(!h){m.textContent="that key is not his.";return}window.__ADMIN_KEY=k;document.open();document.write(h);document.close()}).catch(function(){m.textContent="the shrine did not answer."})}</script>`;

// A rate limit that holds across isolates. The in-memory buckets above are
// per-isolate, so a global backstop for the few genuinely expensive operations
// lives in KV instead. Coarse per-window counter, CAS so parallel increments
// do not lose count, fail-open on contention so a legit user is never wrongly
// blocked. Reserved for rare, costly calls (a full history pull), never the
// live poll path.
async function allowGlobal(key: string, limit: number, windowMs: number): Promise<boolean> {
  const slot = Math.floor(Date.now() / windowMs);
  const k = ["rl", key, slot];
  for (let attempt = 0; attempt < 2; attempt++) {
    const cur = await kv.get<number>(k);
    const n = cur.value ?? 0;
    if (n >= limit) return false;
    const res = await kv.atomic().check(cur).set(k, n + 1, { expireIn: windowMs * 3 }).commit();
    if (res.ok) return true;
  }
  return true;
}

// ---------------------------------------------------------------------------
// THE PIT — player-versus-player tables.
//
// Everything here is built around one rule: a duel's escrow is paid in exactly
// once and paid out exactly once. Both stakes are debited the moment a player
// commits to a table, and from then on the sahurs live in the duel record, not
// in anybody's balance. Every exit — a win, a cancel, a timeout, a forfeit —
// goes through commitDuel(), which writes the settled record and the credits it
// implies in ONE atomic commit guarded by a check on the duel AND on every
// balance it touches. So the record can never read "done" without the money
// having moved, and it can never pay twice: the second attempt's check on the
// duel entry fails, it re-reads, sees `settled`, and does nothing.
//
// Nothing here mints or destroys sahurs. Whatever went in comes back out, to
// one player or split between both. scripts/test-duel.ts counts it.
// The three clocks. Env-overridable only so the tests can watch a ten-minute
// table expire in a second; the defaults are the real game.
const DUEL_OPEN_MS = Number(Deno.env.get("DUEL_OPEN_MS") || 10 * 60 * 1000);   // an open table nobody joins refunds itself
const DUEL_CONFIRM_MS = Number(Deno.env.get("DUEL_CONFIRM_MS") || 10 * 1000);  // both players must confirm within this of the join
const DUEL_MOVE_MS = Number(Deno.env.get("DUEL_MOVE_MS") || 30 * 1000);        // a player who does not move inside this forfeits the duel
const DUEL_COMP_MS = Number(Deno.env.get("DUEL_COMP_MS") || 3 * 60 * 1000);    // how long a round of Competitive Gambling runs
const DUEL_COMP_STACK = Number(Deno.env.get("DUEL_COMP_STACK") || 1000);       // wood each player is handed for it
const DUEL_TTL = 24 * 60 * 60 * 1000;  // a finished record lingers a day so both sides can read it

// KV:
//   ["duel", id]    -> Duel
//   ["duelof", uid] -> the id of the one duel that player is in (one at a time)

type DuelSide = {
  id: string; name: string; confirmed: boolean; move: string | null; wins: number; chips: number;
  bot?: boolean;   // tung himself, called to the table instead of a player
};
type CutCards = { host: string; guest: string; extra?: string[] };
type Duel = {
  id: string;
  game: string;
  bet: number;
  seats: number;         // 2, 3 or 4. The Cut and Competitive Gambling can wait for more than one guest.
  host: DuelSide;
  guest: DuelSide | null;
  extra: DuelSide[];     // third and fourth players, in sit-down order
  state: "open" | "confirm" | "live" | "done";
  ts: number;
  deadline: number;      // what the current state is waiting for, as an epoch ms
  round: number;
  settled: boolean;      // the escrow has been released. set once, never unset.
  winner: string | null; // the SOLE winner's username; null for a void duel or a split pot
  // Who took from the pot and how much. Empty when nobody won and every stake
  // simply went home. One entry is an outright win; two or more is a dead heat
  // at the top, sharing what was on the table. `winner` is only ever set when
  // this holds exactly one name, so the two can never disagree.
  paid: { name: string; amount: number }[];
  // which chess clock this table plays with, chosen by whoever put it up so
  // that joining tells you what you are sitting down to
  tc?: string;
  reason: string;        // why it ended: cancelled | expired | unconfirmed | forfeit | play | clock | bust | draw
  rounds: { host: string; guest: string; won: string | null }[];
  cards?: CutCards;
  // the whole poker tournament, carried on the duel record so that a hand and
  // the escrow that pays for it move in the same atomic commit
  poker?: PokerState;
  // and the whole chess game, for the same reason
  chess?: ChessState;
  // How many lines have been said at this table, ever. Not the number kept —
  // it only ever goes up. It lives HERE, on a record every poll is already
  // reading, so a client can be told whether there is anything new without
  // anybody paying a read for the conversation itself. A table where nobody is
  // talking, which is most of them most of the time, costs nothing at all.
  talkN?: number;
};

// ---- the index of tables still filling --------------------------------------
// The pit lobby used to find them by walking every duel record there is and
// throwing away the ones that were over — and a finished duel lingers a day so
// both players can read the result, so nearly everything it walked was history.
// Two hundred reads, every 1.5 seconds, for a handful of rows.
//
// A table that is OPEN now has a key of its own, written and deleted by the
// same commits that move it in and out of that state. The lobby lists those and
// reads only the tables they name.
//
// The index is a HINT. The duel record is the truth, and the lobby checks it
// against one: an entry naming a table that is no longer open is deleted on
// sight, so a commit that somehow missed one costs a single wasted read, once.
// The direction that would actually matter — an open table with no entry, and
// so invisible to everybody — cannot happen, because the only commit that ever
// creates an open table is the one that creates its entry.
function duelIndex(op: Deno.AtomicOperation, d: Duel): Deno.AtomicOperation {
  return d.state === "open" && !d.settled
    ? op.set(["duelopen", d.id], d.ts, { expireIn: DUEL_TTL })
    : op.delete(["duelopen", d.id]);
}

function extraOf(d: Duel): DuelSide[] {
  return Array.isArray(d.extra) ? d.extra : [];
}
function duelSeats(d: Duel): number {
  const n = Number(d.seats);
  const max = SEAT_MAX[d.game] ?? 2;
  return n >= 3 && n <= max ? n : 2;
}
function seatedPlayers(d: Duel): DuelSide[] {
  return d.guest ? [d.host, d.guest, ...extraOf(d)] : [d.host];
}
function findSide(d: Duel, uid: string): DuelSide | null {
  return seatedPlayers(d).find((p) => p.id === uid) ?? null;
}
// A side dealt before Competitive Gambling existed has no stack at all, and a
// missing stack must read as nothing rather than as NaN — which would compare
// false against every number and quietly make a player unbeatable.
function chipsOf(p: DuelSide | null): number {
  return p && Number.isFinite(p.chips) ? p.chips : 0;
}
// The three tables that can be holding a stake of this player's after the
// request that placed it has gone home: a hand, a board, a walk. An empty stack
// does not mean an empty player while any of them is still live, because a game
// that has not been read yet can still pay.
//
// This is read off the records rather than counted on the duel, so it cannot
// drift: two starts racing, a game replaced by another, a record that expired —
// none of them can leave a phantom stake behind that makes a player unbustable.
// The entries come back with it so the commit can check them, and a game that
// appears between the reading and the committing takes the bust with it.
const STAKE_KEYS = ["bj", "mines", "beef"] as const;
async function stakesOpen(uid: string, duelId: string, skip?: Deno.KvKey): Promise<{
  any: boolean;
  guard: Deno.KvEntryMaybe<unknown>[];
}> {
  const guard: Deno.KvEntryMaybe<unknown>[] = [];
  let any = false;
  for (const name of STAKE_KEYS) {
    if (skip && skip[0] === name) continue;   // that one is being retired by this very commit
    const e = await kv.get<{ w?: unknown }>([name, uid]);
    if (e.value && typeof e.value.w === "string" && e.value.w === duelId) any = true;
    guard.push(e);
  }
  return { any, guard };
}
function cutCardOf(d: Duel, i: number): string | null {
  if (!d.cards) return null;
  if (i === 0) return d.cards.host;
  if (i === 1) return d.cards.guest;
  return d.cards.extra?.[i - 2] ?? null;
}

// Tung, Wood, Fire: the same three-way cycle as the old game, wearing the
// shrine's own nouns. `beats` is read in one direction only — a[x] === y means
// x takes y — so the cycle cannot be made inconsistent by editing one entry.
const TUNG_BEATS: Record<string, string> = { tung: "wood", wood: "fire", fire: "tung" };
const DUEL_GAMES: Record<string, { name: string; moves: string[]; target: number }> = {
  // first to two rounds; a tie is not a round and is simply replayed
  tung: { name: "Tung, Wood, Fire", moves: ["tung", "wood", "fire"], target: 2 },
  // no moves at all: the server cuts the deck the moment both players confirm
  cut: { name: "The Cut", moves: [], target: 1 },
  // no moves either: for three minutes the floor IS the game, and the stacks
  // are the scoreboard. See the wood block further down.
  comp: { name: "Competitive Gambling", moves: [], target: 1 },
  // no moves in the duel sense either: poker has its own turn order, its own
  // clock and its own endpoint, and it runs for as long as it takes
  poker: { name: "Poker", moves: [], target: 1 },
  // same again: chess keeps its whole position on the duel record and takes
  // its moves through /duel/chess
  chess: { name: "Chess", moves: [], target: 1 },
};
// Chess is the one table that can be played for nothing. Everything else in
// the pit is a wager with a floor under it; a game of chess is a game of chess
// whether or not there is anything on it, and refusing the friendly version
// would just mean two people agreeing to bet the minimum and hand it back.
const FREE_OK = new Set(["chess"]);
// The games that can wait for a third and a fourth chair. Tung, Wood, Fire is
// a hand against ONE opponent — its rounds, its score and its forfeit rule are
// all written for two — so it stays two however many a client asks for.
const MULTI_SEAT = new Set(["cut", "comp", "poker"]);
// How wide each of them goes. The Cut and Competitive Gambling were built for
// four; poker takes a fifth because a five-handed table is the one everybody
// means by a home game.
const SEAT_MAX: Record<string, number> = { cut: 4, comp: 4, poker: 5 };
// And the tables that are closed by a DECISION rather than by the last chair
// filling. A cut or a round of Competitive Gambling is a fixed-size thing: you
// say how many are playing when you put it up and it waits for exactly that
// many. Poker is not — two is a game, five is a game, and which one you get
// depends on who happens to be about. Asking the host to name the number in
// advance meant guessing: guess high and a table nobody else found sat there
// for ten minutes and refunded itself, guess low and the fourth person to
// arrive could not sit down.
//
// So a poker table opens with every chair it could ever have, anybody may take
// one, and the host deals when they are ready. The seat count stops being
// something to choose and goes back to being what it is: a ceiling.
const HOST_STARTS = new Set(["poker"]);
// Tung cuts a card. He does not throw a hand of Tung, Wood, Fire and he does
// not spend three minutes on the floor, so The Cut is the one table he sits at.
const CAN_CALL_TUNG = new Set(["cut"]);

function duelSide(u: { id: string; username: string }): DuelSide {
  return { id: u.id, name: u.username, confirmed: false, move: null, wins: 0, chips: 0 };
}

// ---------------------------------------------------------------------------
// CALLING TUNG. A cut wants a body in the other chair and there is not always
// one about, so the host may call tung into it. He cuts a card like anyone
// else, and he says yes before he sits, because he is always ready.
//
// What he is NOT is a member. He has no account, no balance, and no lock, so a
// table with him at it is not the pit any more — it is a house table wearing
// the pit's clothes. That changes exactly one thing and it is the money: his
// stake is the house's, so the pot pays the house's edge, the same 0.1% every
// other table in the casino runs. Between players there is no rake and never
// will be; against tung there is the same edge as the wheel.
//
// He can fill more than one chair — a four-seat cut called with nobody around
// is you against three of him — so each seat he takes gets its own id. They
// cannot collide with an account: rid() is pure lowercase hex, and these are
// not. The NAME cannot either — /apply refuses anything that reads as "tung" —
// so neither half of him can be impersonated or mistaken for a member.
const BOT_ID = "tung!bot";
function isBot(p: DuelSide | null | undefined): boolean {
  return !!p && (p.bot === true || String(p.id).indexOf(BOT_ID) === 0);
}
function botCount(d: Duel): number { return seatedPlayers(d).filter(isBot).length; }
function tungSide(n: number): DuelSide {
  return { id: BOT_ID + "#" + n, name: WISDOM_NAME, confirmed: true, move: null, wins: 0, chips: 0, bot: true };
}
// the people at the table who actually staked something of their own
function stakers(d: Duel): DuelSide[] { return seatedPlayers(d).filter((p) => !isBot(p)); }
function hasBot(d: Duel): boolean { return seatedPlayers(d).some(isBot); }

// What a player is allowed to see of a duel. Crucially it never ships the
// opponent's move while the round is still open — that is the whole game.
function duelView(d: Duel, uid: string | null) {
  const youAreHost = !!uid && d.host.id === uid;
  const people = seatedPlayers(d);
  const you = uid ? findSide(d, uid) : null;
  const them = youAreHost ? d.guest : (you ? d.host : null);
  const open = d.state === "live";
  const seats = duelSeats(d);
  // who took from the pot, and what each of them actually got. a split is the
  // only way this holds more than one name, and the client reads its result
  // wording off the length rather than guessing from `winner` being null —
  // which it also is for a table that nobody won.
  const paid = Array.isArray(d.paid) ? d.paid : [];
  return {
    id: d.id,
    game: d.game,
    gameName: DUEL_GAMES[d.game]?.name || d.game,
    bet: d.bet,
    seats,
    filled: people.length,
    pot: round2(d.bet * people.length),
    state: d.state,
    round: d.round,
    target: DUEL_GAMES[d.game]?.target ?? 1,
    deadline: d.deadline,
    now: Date.now(),
    host: d.host.name,
    guest: d.guest ? d.guest.name : null,
    you: you ? you.name : null,
    youAreHost,
    // your own pick is yours to see; theirs is only ever "have they moved yet"
    yourMove: you ? you.move : null,
    yourWins: you ? you.wins : 0,
    theirWins: them ? them.wins : 0,
    theirName: them ? them.name : null,
    youConfirmed: you ? you.confirmed : false,
    theyConfirmed: them ? them.confirmed : false,
    theyMoved: them ? (open ? them.move !== null : false) : false,
    // A move is hidden until the round resolves; a wood stack is the opposite —
    // watching the other one climb or fall IS Competitive Gambling, so every
    // stack at the table is public the whole way through.
    stack: DUEL_COMP_STACK,
    yourChips: chipsOf(you),
    theirChips: chipsOf(them),
    players: people.map((p) => ({
      name: p.name,
      you: !!uid && p.id === uid,
      bot: isBot(p),
      confirmed: p.confirmed,
      chips: chipsOf(p),
    })),
    // a table tung is sitting at is a house table, and says so: the pot it
    // quotes above is what would actually be paid out, edge and all
    tung: hasBot(d),
    tungs: people.filter(isBot).length,
    // he can be called for as long as there is a chair, so this stays true
    // until the table is full and the deal starts
    canCall: d.state === "open" && CAN_CALL_TUNG.has(d.game) &&
      people.length < seats && youAreHost,
    // This table waits for a decision rather than for a chair — which changes
    // what every screen about it should say, so it is a fact about the table
    // and not something the client works out from the game's name.
    hostStarts: HOST_STARTS.has(d.game),
    // and whether that decision can be taken yet. Two is the floor, because
    // one player is not a game.
    canStart: d.state === "open" && HOST_STARTS.has(d.game) && youAreHost &&
      people.length >= 2,
    winner: d.winner,
    paid,
    // what this player took out of the pot: the lot, a share of it, or nothing
    yourTake: you ? round2(paid.find((x) => x.name === you.name)?.amount ?? 0) : 0,
    reason: d.reason,
    rounds: d.rounds,
    cards: d.state === "done" ? d.cards ?? null : null,
    hands: d.state === "done" && d.cards
      ? people.map((p, i) => ({
        name: p.name,
        card: cutCardOf(d, i),
        you: !!uid && p.id === uid,
      }))
      : null,
    settled: d.settled,
    // the whole tournament, already redacted for this player
    poker: d.game === "poker" ? pokerView(d, uid) : null,
    // the board. Nothing here is secret — both players are looking at the same
    // position, and the only thing either of them does not know is what the
    // other is going to do about it.
    chess: d.game === "chess" && d.chess ? chessView(d, uid) : null,
    // the clock this table was opened at, which is worth knowing while it is
    // still waiting for somebody — before there is a board to read it off
    tcName: d.game === "chess"
      ? (CHESS_TC[d.tc || CHESS_TC_DEFAULT] || CHESS_TC[CHESS_TC_DEFAULT]).name
      : null,
  };
}

function chessView(d: Duel, uid?: string | null) {
  const cs = d.chess!;
  const people = seatedPlayers(d);
  const seat = uid ? people.findIndex((p) => p.id === uid) : -1;
  const toAct = chessSeatToAct(cs);
  const pos = chessParse(cs.fen);
  return {
    fen: cs.fen,
    san: cs.san,
    // the legal moves for whoever is to move, so the client can light up a
    // square without owning a copy of the rules. Sent only to the player whose
    // move it is: it is their own position, and nobody else needs it.
    legal: pos && seat >= 0 && seat === toAct ? chessMoves(pos).map(chessUci) : [],
    youAre: seat < 0 ? null : (seat === cs.white ? "w" : "b"),
    toAct: toAct < 0 ? null : (toAct === cs.white ? "w" : "b"),
    yourTurn: seat >= 0 && seat === toAct && !cs.result,
    check: pos ? chessInCheck(pos, pos.w) : false,
    // both clocks, as milliseconds, plus when the running one started — the
    // client ticks it down itself rather than asking, so a countdown costs
    // nothing and does not stutter between polls
    clock: cs.clock,
    since: cs.since,
    inc: cs.inc,
    tc: cs.tc,
    tcName: (CHESS_TC[cs.tc] || CHESS_TC[CHESS_TC_DEFAULT]).name,
    running: cs.result ? -1 : chessSeatToAct(cs),
    yourSeat: seat,
    // the two squares the last move used, so both boards can keep it lit
    lastFrom: cs.last ? cs.last.slice(0, 2) : null,
    lastTo: cs.last ? cs.last.slice(2, 4) : null,
    // whose offer is standing, as a colour, so it reads the same on both screens
    drawFrom: cs.draw < 0 ? null : (cs.draw === cs.white ? "w" : "b"),
    result: cs.result,
    reason: cs.reason,
    white: people[cs.white]?.name || "",
    black: people[1 - cs.white]?.name || "",
  };
}

// The single door the escrow leaves by. `credits` is what each side is owed;
// the checks make the whole thing all-or-nothing against concurrent writers.
// `retire` is a game record (a hand, a board, a walk) whose stake was wood:
// settling it moves wood and deletes the record, and those cannot be two
// commits or the same hand could be cashed out twice for two payouts. It rides
// the same all-or-nothing commit as the stack it pays into.
async function commitDuel(
  entry: Deno.KvEntryMaybe<Duel>,
  next: Duel,
  credits: { id: string; amount: number }[],
  // deno-lint-ignore no-explicit-any
  retire?: { key: Deno.KvKey; entry: Deno.KvEntryMaybe<any> },
  // records that must still be exactly as they were read for `next` to be true
  // — see stakesOpen(): a game started in the meantime unmakes a bust
  guard?: Deno.KvEntryMaybe<unknown>[],
): Promise<boolean> {
  if (entry.value?.settled) return false;   // already paid; never pay again
  if (retire && !retire.entry.value) return false;  // that game is already gone
  let op = kv.atomic().check(entry);
  if (retire) op = op.check(retire.entry).delete(retire.key);
  if (guard) for (const g of guard) op = op.check(g);
  const seen = new Set<string>();
  for (const c of credits) {
    if (seen.has(c.id) || !(c.amount > 0)) continue;
    seen.add(c.id);
    const cur = await kv.get<{ bal: number; lastClaim: number }>(["cas", c.id]);
    const rec = cur.value ?? { bal: 0, lastClaim: 0 };
    const base = Number.isFinite(rec.bal) ? rec.bal : 0;
    const nb = round2(base + c.amount);
    if (!Number.isFinite(nb) || nb < 0) return false;
    op = op.check(cur).set(["cas", c.id], { ...rec, bal: nb }, { expireIn: CAS_TTL });
  }
  op = op.set(["duel", next.id], next, { expireIn: DUEL_TTL });
  // and the lobby's index of it, in the same commit that decided its state
  op = duelIndex(op, next);
  // the players are free again the moment the record is final
  if (next.settled) {
    for (const p of seatedPlayers(next)) if (!isBot(p)) op = op.delete(["duelof", p.id]);
    // and the table talk goes with it, in the same commit that ends the round.
    // Not swept later and not left to expire: the moment there is no round,
    // there is nothing of what was said in it.
    op = op.delete(["dtalk", next.id]);
  }
  return (await op.commit()).ok;
}

// Share a pot out between however many players are owed it, without minting a
// sahur or leaving one on the table. Each share is the gap between two floored
// running totals, so no share is ever rounded up, the shares differ by at most
// a penny, and they add back to exactly the pot — which is what every
// conservation check in scripts/test-duel.ts is counting.
function splitPot(pot: number, ways: number): number[] {
  if (!(ways > 0)) return [];
  const shares: number[] = [];
  let paid = 0;
  for (let i = 1; i <= ways; i++) {
    const upto = floor2(pot * i / ways);
    shares.push(round2(upto - paid));
    paid = upto;
  }
  return shares;
}

// ---------------------------------------------------------------------------
// TABLE TALK — the little chat inside a round of Competitive Gambling.
//
// It is not the shrine's chat and shares nothing with it: no history, no
// reactions, no retention, no webhook. The whole conversation is ONE KV value
// under the round, which is what lets commitDuel() delete it in the very commit
// that settles the round — when the round is over the talk is already gone,
// rather than being swept afterwards or left to age out. The expireIn is only a
// backstop for a round whose record vanished without settling.
//
// Because it is one value, a line is appended by read-modify-commit against the
// version we read, so two players talking at once cannot lose each other's line.
// The back-and-forth on an application, which lives on the account record as
// one growing array. It had no ceiling: /respond appended and wrote, and the
// applicant holds a token, so they skip the anonymous IP cap and could grow one
// KV value for as long as they liked. Every /status poll reads that value back,
// /admin/pending reads every one of them at once, and a KV value has a hard
// size limit it would eventually hit — at which point the account stops being
// writable at all. A conversation about an application is a dozen lines.
// The most shelf entries any one read of the shop will walk. There are a dozen
// of them in practice and the panel is the only thing that can make more, so
// this is not a policy — it is the difference between "small" and "unbounded",
// which is the only thing a read that runs on a poll needs to be.
const SHOP_MAX = 120;
// ---- how big the pile of unanswered applications may get ----
// /apply is the one route that MAKES an account, and it is anonymous, so the
// only thing in front of it was the 90-a-minute IP cap. Ninety accounts a
// minute is three KV writes each and ninety more rows in a list tung reads
// whole every time he opens the panel — a morning of that and the panel is
// useless and the door still works.
//
// A rate cap per address is the obvious answer and the wrong one here: this
// repo's own suite applies dozens of times from one address, and a guard that
// turns the tests red is a guard nobody will keep. So the cap is on the thing
// that actually does the harm — the size of the PILE, not the speed it arrives
// at. Tung answering applications is what makes room for more, which is how it
// should work anyway; a flood fills it to the ceiling and then stops writing,
// and the tests never come near it because they approve what they apply for.
const PENDING_MAX = Number(Deno.env.get("PENDING_MAX") || 200);

// The pile's size, kept as a number so /apply does not have to count it.
//
// It is allowed to drift. It is only ever incremented — nothing decrements it
// when tung answers one — so it climbs past the truth and eventually trips.
// That is the design: a counter that trips is never believed, it is CHECKED,
// against a walk bounded by the ceiling itself, and then put right. So the
// worst drift can do is spend one bounded walk on one application, and the
// failure it can never produce is the one that would matter — the door shut on
// somebody real because a number was wrong.
//
// The walk is over ["pendq"], an index of the applications still waiting: the
// commit that makes one writes its row, and every verdict, delete and wipe
// takes it out. It used to walk ["app"] — every account, of every status —
// and stop after PENDING_MAX + 1 of them, which only counted the pile while
// the pile was most of the accounts. Once enough members had been let in,
// those first rows were nearly all approved, the count came back near zero
// however big the pile was, and the ceiling never shut. Each row is still
// checked against the account it names, and a row whose account is not
// pending is dropped rather than counted: a stale row may cost one walk, but it
// can never be what turns somebody away.
async function pendingRoom(): Promise<boolean> {
  const cur = await kv.get<number>(["pendn"]);
  if ((Number(cur.value) || 0) < PENDING_MAX) return true;
  const ids: string[] = [];
  for await (const e of kv.list({ prefix: ["pendq"] }, { limit: PENDING_MAX + 1 })) {
    ids.push(String(e.key[1]));
  }
  let n = 0;
  for (let i = 0; i < ids.length; i += 10) {
    const batch = ids.slice(i, i + 10);
    // deno-lint-ignore no-explicit-any
    const got = await kv.getMany<any[]>(batch.map((id) => ["app", id]));
    for (let k = 0; k < got.length; k++) {
      if (got[k].value?.status === "pending") n++;
      else await kv.delete(["pendq", batch[k]]);
    }
  }
  await kv.set(["pendn"], n);
  return n < PENDING_MAX;
}
// ---- how fast one account may play the house ----
// Every wager is a KV read and a KV write, and every one of these routes
// carries a session token — which means none of them was ever behind the
// anonymous 90-a-minute IP cap. There was no other ceiling at all, and a
// balance that random-walks never runs out, so one approved account could hold
// the tables down at whatever rate it could open sockets, forever.
//
// Twelve a second is far above anything a hand can do — the fastest table in
// here animates for the best part of a second, and plinko, the one that lets
// you drop several balls at once, is still a click each. What it is NOT is
// generous to a socket: it turns "as fast as you can ask" into a fixed
// ceiling, which is the whole difference being bought here.
//
// The number is set where it is because the repo's own tests drop, step and
// deal in tight loops — the point of a cap is to stop a script, not to turn
// the suite red — and it is env-overridable for the one test that goes far
// past any sane ceiling on purpose: scripts/test-limbo-rtp.ts fires sixty
// thousand spins through /cas/limbo at a concurrency of sixty-four to measure
// the house edge to three decimal places. That test says so in its own header.
const CAS_BURST = Number(Deno.env.get("CAS_BURST") || 120);
const CAS_BURST_MS = Number(Deno.env.get("CAS_BURST_MS") || 10_000);
// And the pit's own ceiling, which has to be a much looser one: a table is
// polled every 1.2 seconds by every player at it, a clash and a runout are
// answered as fast as the client can ask, and scripts/test-poker.ts plays
// whole tournaments out at a rate no person could. So this is not a pace — it
// is the difference between "fast" and "unbounded", which is the only thing
// these routes were missing. Thirty a second is roughly forty times what a
// client does and a fortieth of what a socket can.
const PIT_BURST = 300, PIT_BURST_MS = 10_000;
const THREAD_MAX = 30;      // lines kept on an application; the oldest fall off
// That thread is the conversation BEFORE a verdict. Once there is one — let in,
// turned away, or sent to tung — it has nothing left to say, and a thread left
// on the record would greet a later re-review with the old questions as if they
// had just been asked. So every verdict takes it off, and so does sending
// somebody back to review, for a record decided before this rule existed.
// deno-lint-ignore no-explicit-any
function dropThread(app: any): any {
  const next = { ...app };
  delete next.thread;
  return next;
}
const TALK_MAX = 40;        // lines kept; the oldest fall off the top
const TALK_LEN = 200;       // characters one line may carry
const TALK_TTL = 6 * 60 * 60 * 1000;
// Which tables carry one. Competitive Gambling has always had it. Poker is the
// other table where the same people sit together long enough to want to say
// something — and unlike a three-minute round it can run for an hour, which is
// exactly why the count on the duel record above is worth having.
const TALK_AT = new Set(["comp", "poker"]);
type TalkLine = { name: string; text: string; ts: number };

async function readTalk(duelId: string): Promise<TalkLine[]> {
  const e = await kv.get<{ lines: TalkLine[] }>(["dtalk", duelId]);
  return Array.isArray(e.value?.lines) ? e.value!.lines : [];
}
// Append one line. Returns the new list, or null if the round is not one that
// can be talked at any more — the caller has already proved the speaker is
// sitting at it.
async function sayAtTable(duelId: string, name: string, text: string): Promise<TalkLine[] | null> {
  for (let attempt = 0; attempt < 6; attempt++) {
    // re-read the table each pass: one that ended under us must not be talked
    // into, or the line would outlive the commit that wiped the rest
    const entry = await loadDuel(duelId);
    const d = entry.value;
    if (!d || d.settled || !TALK_AT.has(d.game) || d.state !== "live") return null;
    const cur = await kv.get<{ lines: TalkLine[] }>(["dtalk", duelId]);
    const lines = (Array.isArray(cur.value?.lines) ? cur.value!.lines : [])
      .concat([{ name, text, ts: Date.now() }])
      .slice(-TALK_MAX);
    // The line and the count of it go in ONE commit, guarded on both records.
    // Apart, a counter that moved without its line would have every client at
    // the table fetch a conversation that had not changed, and a line without
    // its counter would sit there unread until somebody else spoke.
    const res = await kv.atomic()
      .check(cur).check(entry)
      .set(["dtalk", duelId], { lines }, { expireIn: TALK_TTL })
      .set(["duel", duelId], { ...d, talkN: (Number(d.talkN) || 0) + 1 }, { expireIn: DUEL_TTL })
      .commit();
    if (res.ok) return lines;
  }
  return null;
}

// End a duel and release the escrow. No winners refunds every seated player
// their own stake; one winner takes the whole pot; several share it. No rake —
// the pit is between players, and the pot that goes out is the pot that came
// in whichever of those three it is.
function finishDuel(d: Duel, winnerIds: string[] | string | null, reason: string): {
  next: Duel;
  credits: { id: string; amount: number }[];
} {
  const next: Duel = { ...d, state: "done", settled: true, reason, winner: null, paid: [], deadline: 0 };
  const credits: { id: string; amount: number }[] = [];
  const people = seatedPlayers(d);
  if (people.length === 1) {
    // never joined: only the host ever staked anything
    credits.push({ id: d.host.id, amount: d.bet });
    return { next, credits };
  }
  // filtering the table by the ids rather than looking each id up keeps the
  // winners in seat order and cannot list anybody twice, so a repeated id
  // cannot turn into a second share
  const want = winnerIds === null ? [] : (Array.isArray(winnerIds) ? winnerIds : [winnerIds]);
  const winners = people.filter((p) => want.indexOf(p.id) >= 0);
  if (!winners.length) {
    // a void table hands every stake back — and tung never put one in
    for (const p of people) if (!isBot(p)) credits.push({ id: p.id, amount: d.bet });
    return { next, credits };
  }
  // The pot is every chair, tung's included: his stake is the house's, which is
  // what makes a table with him at it a house table. So it pays the house edge,
  // exactly like the wheel — and between players it still pays none at all.
  const pot = hasBot(d) ? floor2(round2(d.bet * people.length) * HOUSE) : round2(d.bet * people.length);
  const shares = splitPot(pot, winners.length);
  next.paid = winners.map((w, i) => ({ name: w.name, amount: shares[i] }));
  // `winner` is the sole-winner name and nothing else, so a split can never be
  // read by anything downstream as one player having taken the lot
  if (winners.length === 1) next.winner = winners[0].name;
  // tung takes the pot the same way he takes everything: it goes to the house
  // and there is no balance of his to put it in
  winners.forEach((w, i) => { if (!isBot(w)) credits.push({ id: w.id, amount: shares[i] }); });
  return { next, credits };
}

// Everybody on the biggest stack. One of them is a winner; more than one is a
// dead heat, and a dead heat shares the pot rather than voiding the table —
// at equal stakes an all-round tie pays each of them their own stake back,
// which is the same thing a refund would have done.
function topStacks(people: DuelSide[]): DuelSide[] {
  if (!people.length) return [];
  let best = -Infinity;
  for (const p of people) best = Math.max(best, chipsOf(p));
  return people.filter((p) => chipsOf(p) === best);
}
// How a round of Competitive Gambling ends. `among` narrows the field to the
// players still standing — on a bust the player who ran out is not a candidate
// for the pot even if everyone else is sitting on nothing. An empty field means
// nobody is left holding anything, which is as level as a table gets, so it
// falls back to sharing between everyone who sat.
function compResult(d: Duel, reason: string, among?: DuelSide[]): {
  next: Duel;
  credits: { id: string; amount: number }[];
} {
  const people = seatedPlayers(d);
  if (people.length < 2) return finishDuel(d, null, reason);
  const field = among && among.length ? among : people;
  const top = topStacks(field);
  if (!top.length) return finishDuel(d, null, reason);
  return finishDuel(d, top.map((p) => p.id), top.length > 1 ? "draw" : reason);
}

// Deadlines are enforced lazily: nothing here runs on a timer, so every read of
// a duel passes through this first and an overdue one settles on the spot. The
// lobby sweeps open tables too, so an abandoned stake always finds its way home
// even if the host never comes back.
async function sweepDuel(entry: Deno.KvEntryMaybe<Duel>): Promise<Deno.KvEntryMaybe<Duel>> {
  let cur = entry;
  for (let attempt = 0; attempt < 4; attempt++) {
    const d = cur.value;
    if (!d || d.state === "done" || Date.now() <= d.deadline) return cur;
    let out: { next: Duel; credits: { id: string; amount: number }[] };
    if (d.state === "open") {
      out = finishDuel(d, null, "expired");
    } else if (d.state === "confirm") {
      // one side sat on their hands: nobody plays and nobody loses anything
      out = finishDuel(d, null, "unconfirmed");
    } else if (d.game === "comp") {
      // the buzzer. nothing to play out — the stacks have been the score all
      // along, and the clock stopping is simply when they are read.
      out = compResult(d, "clock");
    } else if (d.game === "chess" && d.chess) {
      // somebody's clock ran out. Their own reaches zero and stays there; the
      // other player's is untouched, because it was never running.
      const cs: ChessState = JSON.parse(JSON.stringify(d.chess)) as ChessState;
      const people = seatedPlayers(d);
      const late = chessSeatToAct(cs);
      cs.clock[late] = 0;
      cs.since = Date.now();
      // Flagging only LOSES if the other player could have mated. Against a
      // bare king it is a draw — the rule every chess clock implements and
      // nobody remembers until it costs them a pot.
      const pos = chessParse(cs.fen);
      const other = 1 - late;
      const otherIsWhite = other === cs.white;
      const canMate = pos ? chessMatingMaterial(pos, otherIsWhite) : true;
      if (canMate) {
        cs.result = late === cs.white ? "b" : "w";
        cs.reason = "out of time";
        const winner = people[other];
        out = finishDuel({ ...d, chess: cs }, winner ? winner.id : null, "clock");
      } else {
        cs.result = "d";
        cs.reason = "out of time \u2014 no mating material";
        out = finishDuel({ ...d, chess: cs }, null, "draw");
      }
      out.next.chess = cs;
    } else if (d.game === "poker") {
      // Not an ending: a tournament does not expire, one player runs out of
      // time to act. They check or fold, the hand carries on, and the clock is
      // wound again for whoever is next. Only a table that has come down to one
      // player with chips is finished.
      const ps: PokerState = JSON.parse(JSON.stringify(d.poker)) as PokerState;
      const people = seatedPlayers(d);
      // A tournament that is already over is not dealt another hand: its last
      // one is sitting on the table being looked at, and this tick is what
      // takes the table down once it has been up long enough.
      if (!pokerOver(ps)) {
        // either the finished hand has been up long enough and the next one is
        // dealt, or the player to act has run their clock down
        if (ps.next > 0) pokerDealNext(ps, people.map((p) => p.name));
        else if (ps.runout > 0) pokerRunout(ps, people.map((p) => p.name));
        else pokerAutoAct(ps, people.map((p) => p.name));
      }
      if (pokerOver(ps)) {
        // …and if it only just ended, in this very tick, the hand it ended on
        // goes up first. The board that did it is the whole point of having
        // watched; finishing here would replace it with a result screen before
        // either of them had read it. pokerDeadline() is already ps.next, so
        // the tick that takes it down is the next one along.
        if (ps.next > Date.now()) {
          const held: Duel = { ...d, poker: ps, deadline: ps.next };
          if (await commitDuel(cur, held, [])) return await kv.get<Duel>(["duel", d.id]);
          cur = await kv.get<Duel>(["duel", d.id]);
          continue;
        }
        const left = pokerAlive(ps);
        const winner = left.length === 1 ? people[left[0]] : null;
        out = finishDuel({ ...d, poker: ps }, winner ? winner.id : null, "play");
        out.next.poker = ps;
      } else {
        const next: Duel = { ...d, poker: ps, deadline: pokerDeadline(ps) };
        if (await commitDuel(cur, next, [])) return await kv.get<Duel>(["duel", d.id]);
        cur = await kv.get<Duel>(["duel", d.id]);
        continue;
      }
    } else {
      // live: whoever failed to move forfeits. both asleep and it is a wash.
      const hostMoved = d.host.move !== null;
      const guestMoved = !!d.guest && d.guest.move !== null;
      if (hostMoved === guestMoved) out = finishDuel(d, null, "forfeit");
      else out = finishDuel(d, hostMoved ? d.host.id : d.guest!.id, "forfeit");
    }
    if (await commitDuel(cur, out.next, out.credits)) {
      return await kv.get<Duel>(["duel", d.id]);
    }
    cur = await kv.get<Duel>(["duel", d.id]);
  }
  return cur;
}

async function loadDuel(id: string): Promise<Deno.KvEntryMaybe<Duel>> {
  return await sweepDuel(await kv.get<Duel>(["duel", id]));
}

// The Cut: one card each, high card takes it. Ties for the high card are
// re-cut rather than pushed or split, at two seats or four, so the pot
// always goes to one player and nobody can farm a free push.
const CUT_ORDER = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
function cutRank(c: string): number { return CUT_ORDER.indexOf(rankOf(c)); }
function cutDealFor(people: DuelSide[]): { cards: CutCards; winnerId: string } {
  for (;;) {
    const dealt = people.map(() => drawCard());
    const ranks = dealt.map(cutRank);
    const hi = Math.max(...ranks);
    if (ranks.filter((r) => r === hi).length !== 1) continue;
    return {
      cards: { host: dealt[0], guest: dealt[1] ?? dealt[0], extra: dealt.slice(2) },
      winnerId: people[ranks.indexOf(hi)].id,
    };
  }
}

// ---------------------------------------------------------------------------
// ===========================================================================
// CHESS
//
// The board a player sees is a picture. Every question about whether a move
// was legal is answered here, because a table can be played for sahurs and a
// client that can invent moves is a client that can invent wins. The whole
// rulebook lives in this block and nowhere else.
//
// It is verified by perft: counting every leaf of the move tree from the six
// standard test positions and comparing against the published totals. That is
// the only test worth having for a move generator — castling into check, an
// en-passant capture that exposes a rank, a pinned knight, a promotion that
// gives mate, all of them show up as a number that does not match.
// scripts/test-chess.ts runs it over about sixteen million positions.
// ===========================================================================

// ---------------------------------------------------------------------------
// Chess — the rules, and nothing else
//
// Sahurs can ride on a game of this, so the rules are the server's: the client
// draws a board and sends "e2e4", and every question about whether that was
// allowed is answered here. There is no second copy of the rules anywhere.
//
// Squares are 0 = a1 to 63 = h8, so a white pawn pushes +8 and a rank is a
// row of eight. FEN lists rank 8 first, which is the one place that order is
// reversed, and it is reversed in exactly two functions.
// ---------------------------------------------------------------------------
type ChessPos = {
  b: Int8Array; // piece codes: + white, - black, 0 empty
  w: boolean; // white to move
  cs: number; // castling rights: 1 K, 2 Q, 4 k, 8 q
  ep: number; // en-passant target square, or -1
  half: number; // halfmove clock, for the fifty-move rule
  full: number; // fullmove number
};
type ChessMove = { from: number; to: number; promo: number };

const P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6;
const LETTER = ".PNBRQK";
const FILE = (i: number) => i & 7;
const RANK = (i: number) => i >> 3;

// ---- FEN ------------------------------------------------------------------
function chessParse(fen: string): ChessPos | null {
  const parts = String(fen).trim().split(/\s+/);
  if (parts.length < 4) return null;
  const b = new Int8Array(64);
  const rows = parts[0].split("/");
  if (rows.length !== 8) return null;
  for (let r = 0; r < 8; r++) {
    // FEN's first row is rank 8, which is the top of the board and the high
    // end of the index
    let f = 0;
    for (const ch of rows[r]) {
      if (ch >= "1" && ch <= "8") { f += Number(ch); continue; }
      const up = ch.toUpperCase();
      const k = LETTER.indexOf(up);
      if (k <= 0 || f > 7) return null;
      b[(7 - r) * 8 + f] = ch === up ? k : -k;
      f++;
    }
    if (f !== 8) return null;
  }
  const w = parts[1] === "w";
  let cs = 0;
  if (parts[2] !== "-") {
    for (const ch of parts[2]) {
      const k = "KQkq".indexOf(ch);
      if (k < 0) return null;
      cs |= 1 << k;
    }
  }
  let ep = -1;
  if (parts[3] !== "-") {
    const f = parts[3].charCodeAt(0) - 97, r = Number(parts[3][1]) - 1;
    if (f < 0 || f > 7 || r < 0 || r > 7) return null;
    ep = r * 8 + f;
  }
  const half = parts.length > 4 ? Number(parts[4]) : 0;
  const full = parts.length > 5 ? Number(parts[5]) : 1;
  if (!Number.isFinite(half) || !Number.isFinite(full)) return null;
  return { b, w, cs, ep, half: Math.max(0, half | 0), full: Math.max(1, full | 0) };
}

function chessFen(p: ChessPos): string {
  const rows: string[] = [];
  for (let r = 7; r >= 0; r--) {
    let s = "", gap = 0;
    for (let f = 0; f < 8; f++) {
      const v = p.b[r * 8 + f];
      if (!v) { gap++; continue; }
      if (gap) { s += gap; gap = 0; }
      const ch = LETTER[Math.abs(v)];
      s += v > 0 ? ch : ch.toLowerCase();
    }
    if (gap) s += gap;
    rows.push(s);
  }
  let cs = "";
  for (let i = 0; i < 4; i++) if (p.cs & (1 << i)) cs += "KQkq"[i];
  const ep = p.ep < 0 ? "-" : String.fromCharCode(97 + FILE(p.ep)) + (RANK(p.ep) + 1);
  return `${rows.join("/")} ${p.w ? "w" : "b"} ${cs || "-"} ${ep} ${p.half} ${p.full}`;
}

const CHESS_START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// ---- attacks ---------------------------------------------------------------
const KN = [17, 15, 10, 6, -17, -15, -10, -6];
const KD = [8, -8, 1, -1, 9, 7, -9, -7];
const BD = [9, 7, -9, -7];
const RD = [8, -8, 1, -1];

// A step is on the board if it did not fall off the end AND did not wrap to
// the other side, which is the whole trick with a flat 64-square array.
function step(from: number, d: number): number {
  const to = from + d;
  if (to < 0 || to > 63) return -1;
  const df = Math.abs(FILE(to) - FILE(from));
  // every offset in use moves at most two files; a wrap shows up as a jump of
  // six or seven
  if (df > 2) return -1;
  return to;
}

/** Is `sq` attacked by the side `byWhite`? */
function chessAttacked(p: ChessPos, sq: number, byWhite: boolean): boolean {
  const sign = byWhite ? 1 : -1;
  // pawns: a white pawn on sq-9/sq-7 attacks sq
  for (const d of byWhite ? [-9, -7] : [9, 7]) {
    const s = step(sq, d);
    if (s >= 0 && p.b[s] === sign * P) return true;
  }
  for (const d of KN) {
    const s = step(sq, d);
    if (s >= 0 && p.b[s] === sign * N) return true;
  }
  for (const d of KD) {
    const s = step(sq, d);
    if (s >= 0 && p.b[s] === sign * K) return true;
  }
  for (const d of BD) {
    let s = step(sq, d);
    while (s >= 0) {
      const v = p.b[s];
      if (v) { if (v === sign * B || v === sign * Q) return true; break; }
      s = step(s, d);
    }
  }
  for (const d of RD) {
    let s = step(sq, d);
    while (s >= 0) {
      const v = p.b[s];
      if (v) { if (v === sign * R || v === sign * Q) return true; break; }
      s = step(s, d);
    }
  }
  return false;
}

function kingOf(p: ChessPos, white: boolean): number {
  const want = white ? K : -K;
  for (let i = 0; i < 64; i++) if (p.b[i] === want) return i;
  return -1;
}

function chessInCheck(p: ChessPos, white: boolean): boolean {
  const k = kingOf(p, white);
  return k >= 0 && chessAttacked(p, k, !white);
}

// ---- moves -----------------------------------------------------------------
function pushPromos(out: ChessMove[], from: number, to: number) {
  for (const promo of [Q, R, B, N]) out.push({ from, to, promo });
}

/** Every move the side to move could make, before king safety is considered. */
function pseudo(p: ChessPos): ChessMove[] {
  const out: ChessMove[] = [];
  const me = p.w ? 1 : -1;
  const last = p.w ? 7 : 0;
  for (let i = 0; i < 64; i++) {
    const v = p.b[i];
    if (!v || Math.sign(v) !== me) continue;
    const t = Math.abs(v);
    if (t === P) {
      const fwd = p.w ? 8 : -8;
      const one = i + fwd;
      if (one >= 0 && one < 64 && !p.b[one]) {
        if (RANK(one) === last) pushPromos(out, i, one);
        else {
          out.push({ from: i, to: one, promo: 0 });
          const home = p.w ? 1 : 6;
          const two = i + fwd * 2;
          if (RANK(i) === home && !p.b[two]) out.push({ from: i, to: two, promo: 0 });
        }
      }
      for (const d of p.w ? [7, 9] : [-7, -9]) {
        const s = step(i, d);
        if (s < 0) continue;
        const tv = p.b[s];
        // a capture, or the en-passant square, which is empty by definition
        if ((tv && Math.sign(tv) !== me) || s === p.ep) {
          if (RANK(s) === last) pushPromos(out, i, s);
          else out.push({ from: i, to: s, promo: 0 });
        }
      }
    } else if (t === N || t === K) {
      for (const d of t === N ? KN : KD) {
        const s = step(i, d);
        if (s < 0) continue;
        const tv = p.b[s];
        if (!tv || Math.sign(tv) !== me) out.push({ from: i, to: s, promo: 0 });
      }
    } else {
      const dirs = t === B ? BD : t === R ? RD : KD;
      for (const d of dirs) {
        let s = step(i, d);
        while (s >= 0) {
          const tv = p.b[s];
          if (!tv) out.push({ from: i, to: s, promo: 0 });
          else {
            if (Math.sign(tv) !== me) out.push({ from: i, to: s, promo: 0 });
            break;
          }
          s = step(s, d);
        }
      }
    }
  }
  // Castling. The king may not start in check, pass through an attacked square,
  // or land on one — and every square between must be empty, which for the
  // queen's side is three of them, not two.
  const home = p.w ? 4 : 60;
  if (p.b[home] === me * K) {
    const kSide = p.w ? 1 : 4, qSide = p.w ? 2 : 8;
    const rk = p.w ? 7 : 63, rq = p.w ? 0 : 56;
    if ((p.cs & kSide) && p.b[rk] === me * R && !p.b[home + 1] && !p.b[home + 2]) {
      if (
        !chessAttacked(p, home, !p.w) && !chessAttacked(p, home + 1, !p.w) &&
        !chessAttacked(p, home + 2, !p.w)
      ) out.push({ from: home, to: home + 2, promo: 0 });
    }
    if (
      (p.cs & qSide) && p.b[rq] === me * R &&
      !p.b[home - 1] && !p.b[home - 2] && !p.b[home - 3]
    ) {
      if (
        !chessAttacked(p, home, !p.w) && !chessAttacked(p, home - 1, !p.w) &&
        !chessAttacked(p, home - 2, !p.w)
      ) out.push({ from: home, to: home - 2, promo: 0 });
    }
  }
  return out;
}

/** Apply a move with no checking whatsoever. The caller has already vetted it. */
function chessApply(p: ChessPos, m: ChessMove): ChessPos {
  const b = Int8Array.from(p.b);
  const me = p.w ? 1 : -1;
  const piece = b[m.from];
  const t = Math.abs(piece);
  const captured = b[m.to];
  b[m.to] = piece;
  b[m.from] = 0;
  // en passant takes a pawn that is not on the square being moved to
  if (t === P && m.to === p.ep && !captured) b[m.to - (p.w ? 8 : -8)] = 0;
  if (t === P && m.promo) b[m.to] = me * m.promo;
  // the rook comes with the king
  if (t === K && Math.abs(m.to - m.from) === 2) {
    const mid = (m.from + m.to) >> 1;
    const rookFrom = m.to > m.from ? m.from + 3 : m.from - 4;
    b[mid] = b[rookFrom];
    b[rookFrom] = 0;
  }
  let cs = p.cs;
  if (t === K) cs &= p.w ? ~3 : ~12;
  // a rook that moves, and a rook that is taken where it stood, both end the
  // right that belonged to that corner
  for (const [sq, bit] of [[0, 2], [7, 1], [56, 8], [63, 4]] as const) {
    if (m.from === sq || m.to === sq) cs &= ~bit;
  }
  const ep = t === P && Math.abs(m.to - m.from) === 16 ? (m.from + m.to) >> 1 : -1;
  return {
    b,
    w: !p.w,
    cs,
    ep,
    half: (t === P || captured) ? 0 : p.half + 1,
    full: p.full + (p.w ? 0 : 1),
  };
}

/** Every LEGAL move: the pseudo-legal ones that do not leave the king attacked. */
function chessMoves(p: ChessPos): ChessMove[] {
  const out: ChessMove[] = [];
  for (const m of pseudo(p)) {
    const n = chessApply(p, m);
    if (!chessInCheck(n, p.w)) out.push(m);
  }
  return out;
}

// ---- notation --------------------------------------------------------------
function chessSq(i: number): string {
  return String.fromCharCode(97 + FILE(i)) + (RANK(i) + 1);
}
function chessUci(m: ChessMove): string {
  return chessSq(m.from) + chessSq(m.to) + (m.promo ? LETTER[m.promo].toLowerCase() : "");
}
function chessFromUci(s: string): ChessMove | null {
  const t = String(s).trim().toLowerCase();
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(t)) return null;
  const sq = (a: string, b: string) => (Number(b) - 1) * 8 + (a.charCodeAt(0) - 97);
  return {
    from: sq(t[0], t[1]),
    to: sq(t[2], t[3]),
    promo: t[4] ? LETTER.indexOf(t[4].toUpperCase()) : 0,
  };
}

/** How the move reads on a scoresheet. Needs the position it was made from. */
function chessSan(p: ChessPos, m: ChessMove): string {
  const piece = Math.abs(p.b[m.from]);
  const after = chessApply(p, m);
  const check = chessInCheck(after, after.w);
  const mate = check && chessMoves(after).length === 0;
  const suffix = mate ? "#" : check ? "+" : "";
  if (piece === K && Math.abs(m.to - m.from) === 2) {
    return (m.to > m.from ? "O-O" : "O-O-O") + suffix;
  }
  const capture = !!p.b[m.to] || (piece === P && m.to === p.ep);
  if (piece === P) {
    const body = capture ? String.fromCharCode(97 + FILE(m.from)) + "x" + chessSq(m.to) : chessSq(m.to);
    return body + (m.promo ? "=" + LETTER[m.promo] : "") + suffix;
  }
  // only disambiguate when another piece of the same kind could also go there
  const rivals = chessMoves(p).filter((o) =>
    o.to === m.to && o.from !== m.from && Math.abs(p.b[o.from]) === piece
  );
  let dis = "";
  if (rivals.length) {
    const sameFile = rivals.some((o) => FILE(o.from) === FILE(m.from));
    const sameRank = rivals.some((o) => RANK(o.from) === RANK(m.from));
    if (!sameFile) dis = String.fromCharCode(97 + FILE(m.from));
    else if (!sameRank) dis = String(RANK(m.from) + 1);
    else dis = chessSq(m.from);
  }
  return LETTER[piece] + dis + (capture ? "x" : "") + chessSq(m.to) + suffix;
}

// ---- how a game ends -------------------------------------------------------
/** Neither side could deliver mate with what is left, so nobody can win. */
function chessDeadMaterial(p: ChessPos): boolean {
  const minor: number[] = [];
  for (let i = 0; i < 64; i++) {
    const t = Math.abs(p.b[i]);
    if (!t || t === K) continue;
    if (t === P || t === R || t === Q) return false;
    minor.push(p.b[i] > 0 ? i : -i - 1);
  }
  if (minor.length <= 1) return true; // bare kings, or one minor piece
  if (minor.length === 2) {
    // two bishops on the same colour square cannot mate either
    const sq = minor.map((v) => (v >= 0 ? v : -v - 1));
    const isB = (i: number) => Math.abs(p.b[i]) === B;
    if (isB(sq[0]) && isB(sq[1])) {
      const dark = (i: number) => (FILE(i) + RANK(i)) & 1;
      return dark(sq[0]) === dark(sq[1]);
    }
  }
  return false;
}

type ChessEnd =
  | { over: false }
  | { over: true; winner: "w" | "b" | null; reason: string };

/**
 * `reps` is every position seen since the last irreversible move, which is the
 * only window a repetition can happen in: a pawn push or a capture can never be
 * undone, so a position from before one can never come back.
 */
function chessEnd(p: ChessPos, reps: string[]): ChessEnd {
  if (chessMoves(p).length === 0) {
    if (chessInCheck(p, p.w)) return { over: true, winner: p.w ? "b" : "w", reason: "checkmate" };
    return { over: true, winner: null, reason: "stalemate" };
  }
  if (chessDeadMaterial(p)) return { over: true, winner: null, reason: "dead position" };
  if (p.half >= 100) return { over: true, winner: null, reason: "fifty-move rule" };
  const key = chessKey(p);
  let seen = 0;
  for (const r of reps) if (r === key) seen++;
  if (seen >= 3) return { over: true, winner: null, reason: "threefold repetition" };
  return { over: false };
}

/** What makes two positions "the same" for repetition: everything but the clocks. */
function chessKey(p: ChessPos): string {
  return chessFen(p).split(" ").slice(0, 4).join(" ");
}

// A real chess clock: each player has their own, it runs only while it is their
// move, and when it reaches zero they have lost. A per-move allowance was the
// wrong shape for chess — it let somebody take ninety seconds over every move
// of a hundred-move game, which is not a time control, it is a nap. It also
// happens to be what the pit needs anyway: a table holds an escrow, and a clock
// that only ever runs down is a game somebody wandered away from clearing
// itself without anybody having to come back for it.
//
// `inc` is added to a player's clock after they move, so a 3|2 game does not
// end in a scramble nobody can play. The id is what the client sends and is
// stored on the table, so joining tells you what you are sitting down to.
const CHESS_TC: Record<string, { base: number; inc: number; name: string }> = {
  "3+0": { base: 3 * 60_000, inc: 0, name: "3 min" },
  "3+2": { base: 3 * 60_000, inc: 2_000, name: "3 | 2" },
  "5+0": { base: 5 * 60_000, inc: 0, name: "5 min" },
  "10+0": { base: 10 * 60_000, inc: 0, name: "10 min" },
  "15+0": { base: 15 * 60_000, inc: 0, name: "15 min" },
  "60+0": { base: 60 * 60_000, inc: 0, name: "1 hour" },
};
const CHESS_TC_DEFAULT = "10+0";
function chessTc(id: unknown): string {
  const k = clip(id, 8);
  return k && CHESS_TC[k] ? k : CHESS_TC_DEFAULT;
}

type ChessState = {
  fen: string;
  // Every position since the last irreversible move, which is the only window
  // a repetition can happen in — a pawn push or a capture can never be undone,
  // so a position from before one can never come back. Resetting it there is
  // what keeps this array short enough to live on a KV record.
  reps: string[];
  san: string[];         // the move list as it reads on a scoresheet
  last: string;          // the move just played, so the board can light it
  white: number;         // which seat has white: 0 is the host
  // milliseconds left, BY SEAT rather than by colour, so it does not have to be
  // re-read every time the colours are looked up
  clock: [number, number];
  inc: number;           // added to a clock after that player moves
  since: number;         // when the running clock was last started
  tc: string;            // which control this is, for the client to name
  draw: number;          // seat that has a draw offer standing, or -1
  result: "" | "w" | "b" | "d";
  reason: string;
};

function chessStart(tcId: string): ChessState {
  const p = chessParse(CHESS_START)!;
  const tc = CHESS_TC[tcId] || CHESS_TC[CHESS_TC_DEFAULT];
  return {
    fen: CHESS_START,
    reps: [chessKey(p)],
    san: [],
    last: "",
    white: rndInt(2),
    clock: [tc.base, tc.base],
    inc: tc.inc,
    since: Date.now(),
    tc: tcId,
    draw: -1,
    result: "",
    reason: "",
  };
}

// What is left on the clock of whoever is to move, right now. Everything else
// reads from this rather than from `clock` directly, because `clock` is only
// brought up to date when a move is actually made.
function chessLeft(cs: ChessState, at = Date.now()): number {
  const seat = chessSeatToAct(cs);
  if (seat < 0 || cs.result) return 0;
  return Math.max(0, cs.clock[seat] - Math.max(0, at - cs.since));
}
// When the running clock hits zero, which is what the duel's deadline is set to.
function chessDeadline(cs: ChessState): number {
  return cs.since + Math.max(0, cs.clock[chessSeatToAct(cs)] || 0);
}

// Can this side still deliver mate with what it has? Flagging is only a LOSS if
// the other player could have mated; against a bare king it is a draw, which is
// the rule every clock in the world implements and the one nobody remembers.
function chessMatingMaterial(p: ChessPos, white: boolean): boolean {
  let minors = 0, bishops = 0, knights = 0;
  for (let i = 0; i < 64; i++) {
    const v = p.b[i];
    if (!v || (v > 0) !== white) continue;
    const t = Math.abs(v);
    if (t === P || t === R || t === Q) return true;
    if (t === B) { bishops++; minors++; }
    if (t === N) { knights++; minors++; }
  }
  // a lone minor cannot; two of anything can at least be helpmated into it
  return minors >= 2 || (bishops >= 1 && knights >= 1);
}

// Which seat is to move: white's seat before an even number of moves have been
// played, black's after an odd one. The position is the source of truth for
// whose turn it is, and the seat is read off it rather than tracked alongside.
function chessSeatToAct(cs: ChessState): number {
  const p = chessParse(cs.fen);
  if (!p) return -1;
  return p.w ? cs.white : 1 - cs.white;
}

// POKER — the pit's tournament.
//
// Every other table in the pit resolves in one stroke: a hand thrown, a card
// cut, a clock run down. This one does not. Everybody buys in for the same
// stake, is handed the same stack of chips, and plays until one of them has
// the lot — so the table has to survive dozens of hands, players busting out
// of it, and a blind that climbs until it forces the issue.
//
// The chips are not sahurs and never become sahurs, exactly like the wood in
// Competitive Gambling. They are dealt by the tournament, moved around inside
// it, and swept when it ends; the only thing that crosses back out is the pot,
// which is the buy-ins, escrowed by /duel/create and /duel/join before a card
// was dealt and released by the same commitDuel() every other table pays
// through. So a player who finds a way to print chips has printed something
// that buys nothing and expires with the table.
//
// It ends because the blinds make it end. They step up every few minutes and
// do not stop at 250/500 — by the time they are 1000/2000 a starting stack is
// half a big blind and the hands play themselves. That is what stops a
// tournament nobody is winning from sitting in the pit forever holding two
// people's sahurs.
//
// Hole cards are the one thing here that must never be shipped early, the same
// rule that hides a move in Tung, Wood, Fire: pokerView() gives you your own
// two and nobody else's until a showdown puts them face up.
const POKER_STACK = Number(Deno.env.get("POKER_STACK") || 1000);
const POKER_ACT_MS = Number(Deno.env.get("POKER_ACT_MS") || 15 * 1000);
// How long the finished hand stays on the table before the next one is dealt.
// Not a flourish: the hand pays out, busts whoever it emptied and is replaced
// in one pass, so without somewhere to stop, the cards that won would be
// cleared before any client could ask what happened — every showdown in the
// tournament would resolve to a stack that changed size for no visible reason.
const POKER_SHOW_MS = Number(Deno.env.get("POKER_SHOW_MS") || 6 * 1000);
// How long each street of an all-in runout sits before the next one lands.
const POKER_RUNOUT_MS = Number(Deno.env.get("POKER_RUNOUT_MS") || 1400);
// And how long the hand that ENDS the tournament stays up before the table is
// taken down. The duel used to be finished in the same beat that paid the last
// pot, so the result screen replaced the board before either player had read
// the river that put somebody out — on the one hand of the whole game most
// worth looking at. Shorter than an ordinary showdown because there is no next
// hand waiting behind it, only the walk to the result.
const POKER_END_MS = Number(Deno.env.get("POKER_END_MS") || 3 * 1000);
const POKER_LEVEL_MS = Number(Deno.env.get("POKER_LEVEL_MS") || 3 * 60 * 1000);
// Small and big, one row per level. Level 7 is 250/500 and starts at eighteen
// minutes; the rows past it exist so a stubborn heads-up cannot outlast the
// structure. Deep enough early to play, steep enough late to finish.
const POKER_LEVELS: [number, number][] = [
  [10, 20], [15, 30], [25, 50], [50, 100], [100, 200],
  [150, 300], [250, 500], [400, 800], [600, 1200], [1000, 2000],
];

type PokerSeat = {
  chips: number;      // the stack behind, which is what a player can still lose
  inStreet: number;   // put in on THIS street — what a call is measured against
  inHand: number;     // put in across the whole hand — what side pots are cut from
  cards: string[];
  folded: boolean;
  allIn: boolean;
  out: boolean;       // busted; keeps its seat so names and order never shift
  acted: boolean;     // since the last raise, which is what closes a street
};
type PokerShow = { name: string; cards: string[]; hand: string; won: number };
type PokerState = {
  startedAt: number;  // the blind clock runs from here, not from each hand
  button: number;
  hand: number;
  street: number;     // 0 pre, 1 flop, 2 turn, 3 river
  deck: string[];
  board: string[];
  seats: PokerSeat[];
  toAct: number;      // seat index, or -1 between hands
  // Where the search for the next player to act begins, inclusive. Kept as its
  // own field rather than derived from toAct: after a deal the first to speak
  // is a specific seat and must not be stepped over, while after an action it
  // is the seat along — one rule, two very different starting points.
  from: number;
  call: number;       // the amount to match this street
  minRaise: number;   // smallest legal raise on top of it
  log: string[];
  show: PokerShow[] | null;   // set for the hand just finished, cleared on the next deal
  note: string;               // one line describing how the last hand ended
  next: number;               // when the next hand deals; 0 unless a hand is being shown
  runout: number;             // when the next street of an all-in runout lands; 0 otherwise
  reveal: boolean;            // every live hand is face up — set once a runout starts
};

const PK_ORDER = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
function pkVal(c: string): number { return PK_ORDER.indexOf(rankOf(c)) + 2; }
function pkSuit(c: string): string { return c.slice(-1); }

// A real deck, shuffled and dealt from — not drawCard(), which draws with
// replacement. That is fine for blackjack's infinite shoe and would be a
// disaster here, where two players holding the same ace decides pots.
function pokerDeck(): string[] {
  const d: string[] = [];
  for (const r of RANKS) for (const s of SUITS) d.push(r + s);
  for (let i = d.length - 1; i > 0; i--) {
    const j = rndInt(i + 1);
    const t = d[i]; d[i] = d[j]; d[j] = t;
  }
  return d;
}

// Named without the article. These are read as a label on the cards — "FLUSH"
// under a hand, "flush — takes 120" on a showdown row — and "a flush" reads as
// a sentence with its beginning cut off in both places.
const POKER_NAMES = [
  "high card", "pair", "two pair", "three of a kind", "straight",
  "flush", "full house", "four of a kind", "straight flush",
];

// The best five of seven, as a list compared left to right: category first,
// then whatever breaks a tie inside it. Two equal lists are a genuine chop.
function pokerScore(cards: string[]): number[] {
  const bySuit: Record<string, number[]> = {};
  const count: Record<number, number> = {};
  const vals: number[] = [];
  for (const c of cards) {
    const v = pkVal(c), s = pkSuit(c);
    vals.push(v);
    (bySuit[s] = bySuit[s] || []).push(v);
    count[v] = (count[v] || 0) + 1;
  }
  const uniq = Array.from(new Set(vals)).sort((a, b) => b - a);
  // the top of the best run of five, or 0. The ace is added back as a 1 so the
  // wheel (5-4-3-2-A) is found without it also inventing Q-K-A-2-3.
  const runTop = (list: number[]): number => {
    const u = Array.from(new Set(list)).sort((a, b) => b - a);
    const w = u.indexOf(14) >= 0 ? u.concat([1]) : u;
    let run = 1;
    for (let i = 1; i < w.length; i++) {
      if (w[i] === w[i - 1] - 1) { run++; if (run >= 5) return w[i] + 4; }
      else run = 1;
    }
    return 0;
  };
  const flush = Object.keys(bySuit).find((s) => bySuit[s].length >= 5);
  if (flush) {
    const sf = runTop(bySuit[flush]);
    if (sf) return [8, sf];
  }
  // ranks by how many of them there are, then by rank: quads first, then the
  // trips of a full house, and so on down
  const groups = uniq.slice().sort((a, b) => (count[b] - count[a]) || (b - a));
  const top = groups[0], n = count[top];
  if (n === 4) return [7, top, uniq.filter((v) => v !== top)[0]];
  if (n === 3) {
    // a second three of a kind counts as the pair, which is why this looks for
    // two of them rather than exactly two
    const pair = groups.slice(1).find((v) => count[v] >= 2);
    if (pair !== undefined) return [6, top, pair];
  }
  if (flush) return [5, ...bySuit[flush].slice().sort((a, b) => b - a).slice(0, 5)];
  const st = runTop(uniq);
  if (st) return [4, st];
  if (n === 3) return [3, top, ...uniq.filter((v) => v !== top).slice(0, 2)];
  if (n === 2) {
    const pairs = groups.filter((v) => count[v] === 2).sort((a, b) => b - a);
    if (pairs.length >= 2) {
      return [2, pairs[0], pairs[1], uniq.filter((v) => v !== pairs[0] && v !== pairs[1])[0]];
    }
    return [1, top, ...uniq.filter((v) => v !== top).slice(0, 3)];
  }
  return [0, ...uniq.slice(0, 5)];
}
function pokerCmp(a: number[], b: number[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0, y = b[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

// Chips are whole things, so a split pot is divided by the same flooring the
// sahur pots use: shares differ by at most one and add back to exactly the pot.
// The odd chip goes to the earliest seat, which is the one first left of the
// button — the ordinary rule, and the one the client can explain.
function splitChips(pot: number, ways: number): number[] {
  if (!(ways > 0)) return [];
  const out: number[] = [];
  let paid = 0;
  for (let i = 1; i <= ways; i++) {
    const upto = Math.floor(pot * i / ways);
    out.push(upto - paid);
    paid = upto;
  }
  // the flooring leaves the remainder at the end; move it to the front
  const left = pot - out.reduce((a, b) => a + b, 0);
  if (left > 0) out[0] += left;
  return out;
}

function pokerLevel(ps: PokerState): number {
  const n = Math.floor((Date.now() - ps.startedAt) / POKER_LEVEL_MS);
  return Math.max(0, Math.min(POKER_LEVELS.length - 1, n));
}
function pokerBlinds(ps: PokerState): [number, number] { return POKER_LEVELS[pokerLevel(ps)]; }
function pokerPot(ps: PokerState): number {
  return ps.seats.reduce((a, s) => a + s.inHand, 0);
}
function pokerAlive(ps: PokerState): number[] {
  return ps.seats.map((s, i) => (s.out ? -1 : i)).filter((i) => i >= 0);
}
// seat indices in playing order starting the seat after `from`, skipping the
// busted. Used for the button, the blinds and whose turn it is.
function pokerFrom(ps: PokerState, from: number): number[] {
  const out: number[] = [];
  const n = ps.seats.length;
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n;
    if (!ps.seats[i].out) out.push(i);
  }
  return out;
}
// Players who can still be asked for a decision: in the hand and with chips.
function pokerActive(ps: PokerState): number[] {
  return pokerAlive(ps).filter((i) => !ps.seats[i].folded && !ps.seats[i].allIn);
}
function pokerLive(ps: PokerState): number[] {
  return pokerAlive(ps).filter((i) => !ps.seats[i].folded);
}

// Move chips from a stack onto the table. Never more than the player has —
// a short stack calling a bigger bet is simply all in for what it holds.
function pokerPut(s: PokerSeat, want: number): number {
  const amt = Math.max(0, Math.min(want, s.chips));
  s.chips -= amt;
  s.inStreet += amt;
  s.inHand += amt;
  if (s.chips === 0) s.allIn = true;
  return amt;
}

function pokerNewHand(ps: PokerState, names: string[]): void {
  const alive = pokerAlive(ps);
  ps.hand += 1;
  ps.street = 0;
  ps.board = [];
  ps.deck = pokerDeck();
  ps.show = null;
  ps.reveal = false;
  ps.runout = 0;
  for (const s of ps.seats) {
    s.inStreet = 0; s.inHand = 0; s.cards = []; s.acted = false;
    s.folded = s.out; s.allIn = false;
  }
  // the button moves one live seat on, every hand
  ps.button = pokerFrom(ps, ps.button)[0] ?? ps.button;
  for (const i of alive) ps.seats[i].cards = [ps.deck.pop()!, ps.deck.pop()!];

  const [sb, bb] = pokerBlinds(ps);
  const after = pokerFrom(ps, ps.button);
  // Heads-up is the exception every poker engine has to special-case: the
  // button IS the small blind and acts first before the flop, then last after
  // it. With three or more the blinds are simply the next two seats along.
  const heads = alive.length === 2;
  const sbSeat = heads ? ps.button : after[0];
  const bbSeat = heads ? after[0] : after[1];
  pokerPut(ps.seats[sbSeat], sb);
  pokerPut(ps.seats[bbSeat], bb);
  ps.call = bb;
  ps.minRaise = bb;
  // First to speak is the seat after the big blind, which heads-up wraps back
  // round to the button — so the button is the small blind AND acts first
  // before the flop, then last after it. pokerStep() picks the actual player
  // up from here, skipping anyone the blinds already put all in.
  ps.toAct = -1;
  ps.from = (bbSeat + 1) % ps.seats.length;
  ps.note = "hand " + ps.hand + " — blinds " + sb + "/" + bb;
  ps.log = (ps.log || []).concat([
    "hand " + ps.hand + ": " + names[sbSeat] + " posts " + sb + ", " + names[bbSeat] + " posts " + bb,
  ]).slice(-12);
}

// Has the betting on this street finished? Everyone still able to act has had
// their turn since the last raise and has matched it. One player left able to
// act closes it too — there is nobody to raise into.
function pokerStreetClosed(ps: PokerState): boolean {
  if (pokerLive(ps).length <= 1) return true;
  const act = pokerActive(ps);
  if (!act.length) return true;
  // One player with chips against nothing but all-ins has nobody to bet into.
  // They still have to cover what is already out — until they have, the street
  // is open and they are the one being asked — but once they match it there is
  // no betting left to do and the rest of the board simply runs out.
  if (act.length === 1) return ps.seats[act[0]].inStreet === ps.call;
  return act.every((i) => ps.seats[i].acted && ps.seats[i].inStreet === ps.call);
}

function pokerCollect(ps: PokerState): void {
  for (const s of ps.seats) s.inStreet = 0;
  ps.call = 0;
  const [, bb] = pokerBlinds(ps);
  ps.minRaise = bb;
  for (const s of ps.seats) s.acted = false;
}

// Chips nobody matched were never part of the pot, so they go straight back to
// whoever put them out — before anything is compared, the way a dealer pushes
// an uncalled bet back before the cards are turned over.
//
// Without this they come back out of pokerAwards() instead, as a side pot only
// their owner is eligible for. The money lands in the right stack either way,
// but it arrives looking like something that was WON: the loser of the hand
// shows up in the list of winners, the showdown highlights their row, and a pot
// that was taken outright is announced as a split. That is what a player sees
// when they hold the best hand and are told they chopped it.
//
// The uncalled part is whatever the biggest contributor put in above the next
// biggest — folded players included, because the chips they left behind were
// matched and are genuinely won. Idempotent: run it twice and the second call
// finds nothing above the second-place contribution.
function pokerReturnUncalled(ps: PokerState, names: string[]): void {
  const put = ps.seats.map((s) => s.inHand);
  let top = 0;
  for (let i = 1; i < put.length; i++) if (put[i] > put[top]) top = i;
  // only a live player can have money out that nobody had to match
  if (ps.seats[top].folded || ps.seats[top].out) return;
  let second = 0;
  for (let i = 0; i < put.length; i++) if (i !== top && put[i] > second) second = put[i];
  const back = put[top] - second;
  if (back <= 0) return;
  ps.seats[top].inHand -= back;
  ps.seats[top].inStreet = Math.max(0, ps.seats[top].inStreet - back);
  ps.seats[top].chips += back;
  ps.log = ps.log.concat([names[top] + " takes back " + back + " uncalled"]).slice(-12);
}

export type PokerAward = { seat: number; amount: number };
// Cut the pot into a main pot and however many side pots the all-ins made, and
// give each one to the best hand among the players who paid into it. This is
// the piece that has to conserve: every chip that went in comes back out, and
// the test counts them.
function pokerAwards(ps: PokerState): { awards: PokerAward[]; scores: Record<number, number[]> } {
  const seats = ps.seats;
  const put = seats.map((s) => s.inHand);
  const levels = Array.from(new Set(put.filter((p) => p > 0))).sort((a, b) => a - b);
  const totals: number[] = seats.map(() => 0);
  const live = pokerLive(ps);
  const scores: Record<number, number[]> = {};
  for (const i of live) scores[i] = pokerScore(seats[i].cards.concat(ps.board));
  let prev = 0;
  for (const lv of levels) {
    let amount = 0;
    for (let i = 0; i < seats.length; i++) amount += Math.max(0, Math.min(put[i], lv) - prev);
    prev = lv;
    if (amount <= 0) continue;
    // only players who were still in the hand AND paid up to this level can win it
    const elig = live.filter((i) => put[i] >= lv);
    if (!elig.length) continue;
    let best: number[] | null = null;
    for (const i of elig) if (!best || pokerCmp(scores[i], best) > 0) best = scores[i];
    // ordered from the button so the odd chip lands where the rule says
    const order = pokerFrom(ps, ps.button);
    const winners = order.filter((i) => elig.indexOf(i) >= 0 && pokerCmp(scores[i], best!) === 0);
    const shares = splitChips(amount, winners.length);
    winners.forEach((i, k) => { totals[i] += shares[k]; });
  }
  const awards: PokerAward[] = [];
  totals.forEach((amount, seat) => { if (amount > 0) awards.push({ seat, amount }); });
  return { awards, scores };
}

// Deal what this street shows. A card goes face down before each one, which
// changes no odds a player can compute but is how the game is dealt.
function pokerBoard(ps: PokerState): void {
  ps.deck.pop();
  const n = ps.street === 1 ? 3 : 1;
  for (let k = 0; k < n; k++) ps.board.push(ps.deck.pop()!);
}

// Pay the hand out, bust whoever it emptied, and leave behind the record of
// what happened that the client paints.
function pokerFinishHand(ps: PokerState, names: string[]): void {
  const live = pokerLive(ps);
  if (live.length <= 1) {
    // everyone else folded. The pot is taken without a showdown, and a hand
    // that was never called is never shown — that is the player's to keep.
    // Nothing is pushed back here: with one player left the whole pot, their
    // own chips included, goes to them anyway.
    const pot = pokerPot(ps);
    const w = live[0];
    if (w !== undefined) ps.seats[w].chips += pot;
    ps.show = null;
    ps.note = (w !== undefined ? names[w] : "nobody") + " takes " + pot +
      (ps.hand > 0 ? "" : "") + " — no showdown";
    ps.log = ps.log.concat([ps.note]).slice(-12);
  } else {
    // an uncalled bet is not a pot and is not won, so it leaves first
    pokerReturnUncalled(ps, names);
    const pot = pokerPot(ps);
    const { awards, scores } = pokerAwards(ps);
    const won: number[] = ps.seats.map(() => 0);
    for (const a of awards) { ps.seats[a.seat].chips += a.amount; won[a.seat] = a.amount; }
    ps.show = live.map((i) => ({
      name: names[i],
      cards: ps.seats[i].cards.slice(),
      hand: POKER_NAMES[scores[i][0]] || "a hand",
      won: won[i],
    }));
    const best = ps.show.filter((x) => x.won > 0).map((x) => x.name);
    ps.note = (best.join(" and ") || "nobody") + " " +
      (best.length > 1 ? "split" : "takes") + " " + pot;
    ps.log = ps.log.concat([ps.note]).slice(-12);
  }
  for (const s of ps.seats) { s.inStreet = 0; s.inHand = 0; }
  // busting is read off the stack, after the pot has been paid, so an all-in
  // that got there first is not buried by the hand it just won
  for (const s of ps.seats) if (!s.out && s.chips <= 0) { s.out = true; s.folded = true; }
  ps.toAct = -1;
  // the hand stays up until this passes, so what just happened can be read —
  // the last one included, which is what stops the table being swapped for a
  // result screen the instant the pot is paid
  // (pokerAlive() rather than pokerOver(), which says the same thing one line
  // lower down: scripts/test-poker.ts lifts this function and everything above
  // pokerDealNext() out of here and runs it on its own, and pokerOver() is
  // written below that cut.)
  ps.next = Date.now() + (pokerAlive(ps).length <= 1 ? POKER_END_MS : POKER_SHOW_MS);
}

// Clear the finished hand away and deal the next one. Kept apart from
// pokerStep() so that nothing deals a hand as a side effect of somebody
// acting — the table pauses on a result and moves on from a clock instead.
function pokerDealNext(ps: PokerState, names: string[]): void {
  ps.next = 0;
  pokerNewHand(ps, names);
  pokerStep(ps, names);
}

function pokerOver(ps: PokerState): boolean { return pokerAlive(ps).length <= 1; }
// What the duel's own deadline should be: either the hand on the table clearing
// itself away, or the player whose turn it is running out of time.
function pokerDeadline(ps: PokerState): number {
  if (ps.next > 0) return ps.next;
  if (ps.runout > 0) return ps.runout;
  return Date.now() + POKER_ACT_MS;
}

// Whose turn it is, searching from whoever went last. A player still owing
// chips is asked again even if they have already spoken this street, which is
// what makes a raise come back round.
function pokerNextActor(ps: PokerState, from: number): number {
  const n = ps.seats.length;
  for (let k = 0; k < n; k++) {
    const i = ((from % n) + n + k) % n;
    const s = ps.seats[i];
    if (s.out || s.folded || s.allIn) continue;
    if (!s.acted || s.inStreet !== ps.call) return i;
  }
  return -1;
}

// Carry the hand as far as it can go without asking anybody anything: close
// streets, pay the pot, and stop. Returns with toAct set to a player, with a
// board left to run out, or with the hand finished.
function pokerStep(ps: PokerState, names: string[]): void {
  for (let guard = 0; guard < 64; guard++) {
    if (ps.next > 0 || ps.runout > 0) return;   // the table is mid-beat; it moves on its own clock
    if (!pokerStreetClosed(ps)) {
      const nxt = pokerNextActor(ps, ps.from);
      if (nxt >= 0) { ps.toAct = nxt; return; }
    }
    ps.toAct = -1;
    if (pokerLive(ps).length <= 1 || ps.street >= 3) {
      pokerFinishHand(ps, names);
      return;
    }
    // Everybody left is all in and there is still board to come. The hand is
    // decided but it has not been SEEN yet, and watching it is most of what
    // the hand was for — so the cards go face up and the rest of the board is
    // dealt a street at a time on a clock, rather than the whole thing
    // resolving inside the request that called the last bet.
    if (pokerActive(ps).length <= 1) {
      // Betting is over, so anything nobody matched goes back now rather than
      // riding along as pot. This is the shape an uncalled bet usually turns
      // up in — a shove that got called for less — and pushing it back here
      // means the pot on screen through the runout is the pot being played for.
      pokerReturnUncalled(ps, names);
      ps.reveal = true;
      ps.runout = Date.now() + POKER_RUNOUT_MS;
      ps.note = "all in — running it out";
      return;
    }
    pokerCollect(ps);
    ps.street += 1;
    pokerBoard(ps);
    // after the flop the first to speak is the seat left of the button, every
    // street, heads-up included — which is the reverse of before it
    ps.from = (ps.button + 1) % ps.seats.length;
  }
}

// One more street of an all-in runout, then back to pokerStep to decide
// whether that was the last of them.
function pokerRunout(ps: PokerState, names: string[]): void {
  ps.runout = 0;
  pokerCollect(ps);
  ps.street += 1;
  pokerBoard(ps);
  ps.from = (ps.button + 1) % ps.seats.length;
  pokerStep(ps, names);
}

// One action from one seat. Returns an error for the player, or null.
function pokerApply(ps: PokerState, i: number, action: string, amount: number, names: string[]): string | null {
  const s = ps.seats[i];
  if (ps.toAct !== i) return "not your turn";
  if (s.out || s.folded || s.allIn) return "you are not in this hand";
  const owe = ps.call - s.inStreet;
  const say = (t: string) => { ps.log = ps.log.concat([names[i] + " " + t]).slice(-12); };
  if (action === "fold") {
    s.folded = true; s.acted = true; say("folds");
  } else if (action === "check") {
    if (owe > 0) return "there is " + owe + " to call";
    s.acted = true; say("checks");
  } else if (action === "call") {
    if (owe <= 0) return "there is nothing to call";
    const paid = pokerPut(s, owe);
    s.acted = true; say(s.allIn ? "calls " + paid + " and is all in" : "calls " + paid);
  } else if (action === "bet" || action === "raise" || action === "allin") {
    const maxTo = s.inStreet + s.chips;
    let target = action === "allin" ? maxTo : Math.floor(Number(amount));
    if (!Number.isFinite(target)) return "that is not an amount";
    if (target > maxTo) target = maxTo;
    if (target < maxTo) {
      // a raise that is not all in has to be a real one
      const least = ps.call + ps.minRaise;
      if (target < least) return "raise to at least " + least;
    }
    if (target <= s.inStreet) return "that is not a raise";
    pokerPut(s, target - s.inStreet);
    if (s.inStreet > ps.call) {
      const inc = s.inStreet - ps.call;
      const full = inc >= ps.minRaise;
      ps.call = s.inStreet;
      // A short all-in — one that cannot cover a full raise — does not reopen
      // the betting to players who have already spoken. They still have to
      // match it, which pokerNextActor asks of them, but they cannot re-raise
      // off the back of it.
      if (full) {
        ps.minRaise = inc;
        for (let k = 0; k < ps.seats.length; k++) if (k !== i) ps.seats[k].acted = false;
      }
    }
    s.acted = true;
    say(s.allIn ? "is all in for " + s.inStreet : "raises to " + s.inStreet);
  } else {
    return "no such move";
  }
  // they have spoken, so the search moves along one
  ps.from = (i + 1) % ps.seats.length;
  pokerStep(ps, names);
  return null;
}

// The clock. A player who says nothing checks when it is free and folds when it
// is not — never a call, which would spend their chips for them.
function pokerAutoAct(ps: PokerState, names: string[]): void {
  const i = ps.toAct;
  if (i < 0 || !ps.seats[i]) return;
  const free = ps.seats[i].inStreet === ps.call;
  pokerApply(ps, i, free ? "check" : "fold", 0, names);
}

function pokerStart(people: DuelSide[]): PokerState {
  const now = Date.now();
  const ps: PokerState = {
    startedAt: now, button: people.length - 1, hand: 0, street: 0,
    deck: [], board: [],
    seats: people.map(() => ({
      chips: POKER_STACK, inStreet: 0, inHand: 0, cards: [],
      folded: false, allIn: false, out: false, acted: false,
    })),
    toAct: -1, from: 0, call: 0, minRaise: 0, log: [], show: null, note: "", next: 0,
    runout: 0, reveal: false,
  };
  pokerNewHand(ps, people.map((p) => p.name));
  pokerStep(ps, people.map((p) => p.name));
  return ps;
}

// What one player is allowed to see. Their own two cards, everybody's stack and
// everything already face up — and nobody else's hole cards until the hand is
// shown down, which is the same rule that hides a move in Tung, Wood, Fire.
function pokerView(d: Duel, uid: string | null) {
  const ps = d.poker;
  if (!ps) return null;
  const people = seatedPlayers(d);
  const me = people.findIndex((p) => p.id === uid);
  const [sb, bb] = pokerBlinds(ps);
  const lvl = pokerLevel(ps);
  const mySeat = me >= 0 ? ps.seats[me] : null;
  const owe = mySeat ? Math.max(0, ps.call - mySeat.inStreet) : 0;
  return {
    hand: ps.hand,
    street: ps.street,
    board: ps.board,
    pot: pokerPot(ps),
    // What the MIDDLE of the table shows, which is not the same number. The
    // chips going in on this street are already drawn where they are — in
    // front of the people who pushed them out — so counting them in the middle
    // as well is the same money on screen twice, and a total that twitches on
    // every call is not something anybody can read a decision off. This moves
    // when a street closes and the chips are actually swept in: after the flop,
    // the turn, the river. That is what "the pot" means at a real table.
    //
    // `pot` above stays the true running total, because the maths still wants
    // it: a pot-sized raise is a pot-sized raise, and the shortcut buttons
    // count what is out there rather than what has been swept up.
    potMid: Math.max(0, pokerPot(ps) - ps.seats.reduce((a, s) => a + s.inStreet, 0)),
    call: ps.call,
    minRaise: ps.minRaise,
    button: ps.button,
    blinds: [sb, bb],
    level: lvl + 1,
    levels: POKER_LEVELS.length,
    // when the blinds go up next, so the client can run the clock down
    nextLevel: lvl + 1 < POKER_LEVELS.length ? ps.startedAt + (lvl + 1) * POKER_LEVEL_MS : 0,
    stack: POKER_STACK,
    toAct: ps.toAct,
    yourSeat: me,
    yourTurn: me >= 0 && ps.toAct === me,
    yourCards: mySeat && !mySeat.out ? mySeat.cards : [],
    toCall: owe,
    // what a raise has to reach, and the most this player could put out
    raiseTo: mySeat ? Math.min(ps.call + ps.minRaise, mySeat.inStreet + mySeat.chips) : 0,
    maxTo: mySeat ? mySeat.inStreet + mySeat.chips : 0,
    canCheck: !!mySeat && owe === 0,
    // What this player is currently holding, named. It tells them nothing they
    // could not work out from the cards they were already sent — their own two
    // and the board — so it gives away nothing, and it saves reading a flush
    // wrong at the one moment that costs money.
    yourHand: mySeat && !mySeat.out && mySeat.cards.length
      ? POKER_NAMES[pokerScore(mySeat.cards.concat(ps.board))[0]]
      : null,
    seats: people.map((p, i) => ({
      name: p.name,
      you: !!uid && p.id === uid,
      chips: ps.seats[i].chips,
      inStreet: ps.seats[i].inStreet,
      folded: ps.seats[i].folded,
      allIn: ps.seats[i].allIn,
      out: ps.seats[i].out,
      // Face up at a showdown, and face up once a runout has started — at
      // that point every chip is already in and there is nothing left to
      // decide, so a hand kept hidden would only be hidden from the people
      // watching it win. Otherwise the client is told how many cards are
      // there and nothing whatever about them.
      cards: (ps.show || []).find((x) => x.name === p.name)?.cards ??
        ((ps.reveal && !ps.seats[i].folded && !ps.seats[i].out) ||
            (i === me && !ps.seats[i].out)
          ? ps.seats[i].cards
          : []),
      held: ps.seats[i].cards.length,
    })),
    show: ps.show,
    note: ps.note,
    log: ps.log,
    // set while the finished hand is still on the table, so the client can show
    // the result rather than blink straight into the next deal
    showing: ps.next > 0,
    next: ps.next,
    // the board is being dealt out over all-ins; hands are face up and nobody
    // is being asked for anything
    runout: ps.runout > 0,
    reveal: !!ps.reveal,
    deadline: d.deadline,
    now: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// WOOD — the money inside a round of Competitive Gambling.
//
// A round hands both players an identical stack of wood chips and, until the clock
// stops, every wager on the floor comes out of that stack instead of their
// sahurs. Wood is not sahurs and never becomes sahurs. It is handed out by the
// round, spent against the house inside it, and swept when the round ends; the
// only thing that crosses back is the pot, which is the two real stakes,
// escrowed before the round began and released by the same commitDuel() every
// other table in the pit pays through. So three minutes of this cannot move a
// sahur in either direction, and a player who finds a way to print wood has
// printed something that expires in under three minutes and buys nothing.
//
// WHICH purse a wager rides on is the server's to decide and is read off the
// player's own duel lock on every bet — there is no "demo mode" flag a client
// could send, so a wager cannot be aimed at the cheap money, and one cannot be
// aimed at somebody's sahurs from inside a round either.
// A round cannot deal a table that is already holding real sahurs: starting a
// game replaces whatever was on that table, and a round must never be the thing
// that throws a sahur stake away.
const WOOD_HELD = "you left a game open with sahurs on it. finish that one and the round will deal you another.";
const WOOD_OVER = "the clock stopped. that round is over.";

// The live round this player is inside, or null. loadDuel() sweeps first, so a
// round whose three minutes are up settles HERE — before the wager that would
// otherwise have landed inside it.
async function liveComp(uid: string): Promise<Duel | null> {
  const lock = await kv.get<string>(["duelof", uid]);
  if (!lock.value) return null;
  const d = (await loadDuel(lock.value)).value;
  if (!d || d.settled || d.game !== "comp" || d.state !== "live") return null;
  return d;
}

// One movement of wood in a live round, and the only one there is.
//
//   delta   what the stack does. negative is a wager going onto a table.
//   last    the wager is finished with, so an empty stack may now be believed
//   retire  the game record to delete in the same commit as the wood it pays
//
// `last` is the subtle one. A bet leaves the stack before it pays, so every
// winning bet passes through zero on the way; only the move that closes a
// wager out can be read as the player being done. The same idea reaches across
// requests through stakesOpen(): while a hand, a board or a walk of theirs is
// still unread, an empty stack is not an empty player.
type WoodMove = { chips: number; over: boolean };
async function woodMove(duelId: string, uid: string, delta: number, opt: {
  last?: boolean;
  // deno-lint-ignore no-explicit-any
  retire?: { key: Deno.KvKey; entry: Deno.KvEntryMaybe<any> };
} = {}): Promise<WoodMove | "insufficient" | "over"> {
  if (!Number.isFinite(delta)) return "over";
  for (let attempt = 0; attempt < 8; attempt++) {
    const entry = await loadDuel(duelId);
    const d = entry.value;
    if (!d || d.settled || d.game !== "comp" || d.state !== "live") return "over";
    const next: Duel = {
      ...d,
      host: { ...d.host },
      guest: d.guest ? { ...d.guest } : null,
      extra: extraOf(d).map((x) => ({ ...x })),
    };
    const me = findSide(next, uid);
    if (!me) return "over";
    const nb = round2(chipsOf(me) + delta);
    if (!Number.isFinite(nb)) return "over";
    if (nb < -1e-9) return "insufficient";
    me.chips = Math.max(0, nb);
    // Nothing on the stack and nothing on a table: this player has no way back.
    // A stake still sitting on a table is the one thing that holds them in —
    // the hand has not been read yet, and an unread hand can still pay.
    //
    // What that does to the ROUND depends on how many chairs it has. At two it
    // ends it: there is no reason to make the other one sit out the clock. At
    // three or four it usually does not — the rest of the table still has its
    // three minutes, and one player going broke must not cut that short. The
    // round ends only once the field is down to a single player still holding
    // something, or to nobody at all.
    let out: { next: Duel; credits: { id: string; amount: number }[] } | null = null;
    let guard: Deno.KvEntryMaybe<unknown>[] | undefined;
    if (opt.last && me.chips <= 0) {
      const own = await stakesOpen(uid, duelId, opt.retire?.key);
      if (!own.any) {
        guard = own.guard.slice();
        // Who else is still in it: wood on the stack, or a stake of theirs
        // still out on a table. Reading the others' tables is what makes this
        // honest at three and four seats, and every entry read joins the guard
        // — so a hand dealt anywhere on the floor between this decision and the
        // commit makes the commit fail and the call is taken again.
        const standing: DuelSide[] = [];
        for (const other of seatedPlayers(next)) {
          if (other.id === uid) continue;
          if (chipsOf(other) > 0) { standing.push(other); continue; }
          const theirs = await stakesOpen(other.id, duelId);
          guard.push(...theirs.guard);
          if (theirs.any) standing.push(other);
        }
        // one player left holding anything takes the pot; nobody left holding
        // anything is a level table and it is shared out
        if (standing.length <= 1) out = compResult(next, "bust", standing);
      }
    }
    let credits: { id: string; amount: number }[] = [];
    if (out) {
      credits = out.credits;
      Object.assign(next, out.next);
    } else {
      // nothing was decided off those reads, so nothing has to still be true
      // for this commit to be right — holding the guard would only cost retries
      guard = undefined;
    }
    if (await commitDuel(entry, next, credits, opt.retire, guard)) {
      return { chips: me.chips, over: !!out };
    }
    // the commit can only fail because something moved under us — unless what
    // moved was the game record itself, in which case another request has
    // already settled this hand and we must not settle it again
    if (opt.retire) {
      const again = await kv.get(opt.retire.key);
      if (again.versionstamp !== opt.retire.entry.versionstamp) return "over";
    }
  }
  return "over";
}

// ---------------------------------------------------------------------------
// THE PURSE — where a wager on the casino floor comes out of.
//
// Outside a round that is the player's sahurs; inside one it is that round's
// wood, and their sahurs are left exactly where they are. Every table in the
// casino asks the purse the same handful of things, so the games are written
// once and never learn which one answered.
//
// Wood is not sahurs and never becomes sahurs. It is handed out by the round,
// spent against the house inside it, and swept when the round ends; the only
// thing that crosses back is the pot, which is the two real stakes, escrowed
// before the round began and released by the same commitDuel() every other
// table in the pit pays through. So three minutes of this cannot move a sahur
// in either direction, and a player who finds a way to print wood has printed
// something that expires in under three minutes and buys nothing.
//
// WHICH purse a wager rides on is the server's to decide: for a new wager it is
// read off the player's own duel lock, and for a game already on the table it
// is read off the stake stamped on that game. There is no "demo mode" flag a
// client could send, so a wager cannot be aimed at the cheap money, and one
// cannot be aimed at somebody's sahurs from inside a round either.
type Purse = {
  wood: boolean;   // this is a round's wood rather than the player's sahurs
  tag: string;     // stamp this on a game staked from here, so it settles home
  dead: boolean;   // wood whose round has ended: it may be swept, never spent
  bal: number;     // the player's sahurs. a round never moves this.
  left: number;    // wood on the stack, as of the last move
  over: boolean;   // that move was the last one — the round has settled
  /** stake a wager: an instant one, a new game, or more on a game already open. */
  take(amount: number): Promise<string>;
  /** pay a wager out and read the stack back. 0 is a legal payout. */
  give(payout: number): Promise<void>;
  /** retire a game record and pay what it owes, in one commit. false if somebody got there first. */
  // deno-lint-ignore no-explicit-any
  settle(key: Deno.KvKey, entry: Deno.KvEntryMaybe<any>, payout: number): Promise<boolean>;
};

// `meant` is the round the CLIENT believes it is betting into. A wager somebody
// meant as wood must never quietly land on their sahurs because the buzzer went
// while they were reaching for the button, so naming a round that is no longer
// live refuses the bet instead of re-aiming it. Note which way this points: it
// can only ever stop a wager. Which purse a wager rides on is still the
// server's, so naming a round cannot send a bet to the cheap money, and naming
// none cannot send one to somebody's sahurs from inside a round.
function purseOn(uid: string, id: string, dead: boolean, left: number, meant: string): Purse {
  const wood = !!id;
  async function sahurs(delta: number): Promise<string> {
    return (await adjustBalance(uid, -delta)) === null ? "insufficient" : "";
  }
  async function stake(amount: number): Promise<string> {
    if (meant && meant !== id) { p.over = true; return WOOD_OVER; }
    if (!wood) return await sahurs(amount);
    if (dead) { p.over = true; return WOOD_OVER; }
    const r = await woodMove(id, uid, -amount);
    if (r === "insufficient") return "insufficient";
    if (r === "over") { p.over = true; return WOOD_OVER; }
    p.left = r.chips;
    return "";
  }
  async function pay(payout: number): Promise<void> {
    if (!wood) {
      const nb = payout > 0 ? await adjustBalance(uid, payout) : null;
      p.bal = round2(nb ?? (await getCas(uid)).bal);
      return;
    }
    // the buzzer can go while a bet is in the air. the wood it would have paid
    // is swept with the rest of it; the sahurs were never in play.
    if (!dead) {
      const r = await woodMove(id, uid, payout, { last: true });
      if (r === "over") p.over = true;
      else if (r !== "insufficient") { p.left = r.chips; p.over = r.over; }
    } else p.over = true;
    p.bal = round2((await getCas(uid)).bal);
  }
  const p: Purse = {
    wood, tag: id, dead, bal: 0, left, over: false,
    take: stake,
    give: pay,
    async settle(key, entry, payout) {
      if (!wood) {
        if (payout > 0) {
          const nb = await settleGame(key, entry, uid, payout);
          if (nb === null) return false;
          p.bal = round2(nb);
          return true;
        }
        if (!await claimGame(key, entry)) return false;
        p.bal = round2((await getCas(uid)).bal);
        return true;
      }
      // a game staked in a round that has since ended: the record still has to
      // go, but there is no stack left for it to pay into
      if (dead) {
        if (!await claimGame(key, entry)) return false;
        p.over = true;
        p.bal = round2((await getCas(uid)).bal);
        return true;
      }
      const r = await woodMove(id, uid, payout, { last: true, retire: { key, entry } });
      if (r === "over") {
        // the buzzer went while this game was being read. its wood is swept
        // with the rest, but the record still has to go, or the table stays
        // laid out and every later click is told there is no game.
        if (!await claimGame(key, entry)) return false;
        p.over = true;
        p.bal = round2((await getCas(uid)).bal);
        return true;
      }
      if (r === "insufficient") return false;
      p.left = r.chips;
      p.over = r.over;
      p.bal = round2((await getCas(uid)).bal);
      return true;
    },
  };
  return p;
}

// The purse a NEW wager comes out of: the round the player is in, or sahurs.
async function purseFor(uid: string, want?: unknown): Promise<Purse> {
  const round = await liveComp(uid);
  const meant = typeof want === "string" ? clip(want, 32) : "";
  if (!round) return purseOn(uid, "", false, 0, meant);
  return purseOn(uid, round.id, false, chipsOf(findSide(round, uid)), meant);
}
// The purse a game ALREADY on the table was staked from, read off the stamp it
// carries. A hand dealt in sahurs settles in sahurs even if a round has started
// on top of it, and a hand dealt in a round that has since ended settles into
// nothing — its wood was swept with the rest.
async function purseOfStake(uid: string, w: unknown): Promise<Purse> {
  const tag = typeof w === "string" ? clip(w, 32) : "";
  if (!tag) return purseOn(uid, "", false, 0, "");
  const round = await liveComp(uid);
  if (round && round.id === tag) return purseOn(uid, tag, false, chipsOf(findSide(round, uid)), "");
  return purseOn(uid, tag, true, 0, "");
}
// Starting a game replaces whatever was on that table. That is fine when both
// were staked from the same purse, and fine when the old one is wood from a
// round that is over (it is worth nothing now) — but a round must never
// overwrite a game that is holding real sahurs.
function stakeClash(rec: { w?: unknown } | null, purse: Purse): string {
  if (!rec) return "";
  const was = typeof rec.w === "string" ? rec.w : "";
  return !was && purse.wood ? WOOD_HELD : "";
}
// What a table says about the purse it just played out of. `balance` stays the
// player's sahurs on every reply in the casino, round or no round, so the
// number in the header is never once a lie.
function purseJson(p: Purse) {
  return p.wood ? { wood: round2(p.left), roundOver: p.over } : {};
}

const listenPort = Number(Deno.env.get("PORT") || "8000") || 8000;

// Answers of a kilobyte or more go out gzipped when the client says it can take
// that. A fresh room is 17 KB of JSON and 3.5 KB gzipped; a pit table's state is
// 2.4 KB, polled every 1.2 s while seated, and 0.8 KB gzipped; the panel is
// 118 KB and 31 KB. Nothing about what is sent, or how often, changes — only
// how many bytes it takes on the wire, which is what the host bills. Small
// answers (every idle poll is a few dozen bytes) are left as they are: gzip
// would make them bigger.
const GZIP_MIN = 1024;
async function gzipped(req: Request, res: Response): Promise<Response> {
  if (!res.body || req.method === "HEAD" || res.headers.has("content-encoding")) return res;
  if (!/\bgzip\b/i.test(req.headers.get("accept-encoding") || "")) return res;
  if (!/^(application\/json|text\/)/i.test(res.headers.get("content-type") || "")) return res;
  const raw = new Uint8Array(await res.arrayBuffer());
  const headers = new Headers(res.headers);
  if (raw.byteLength < GZIP_MIN) return new Response(raw, { status: res.status, statusText: res.statusText, headers });
  const gz = await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
  headers.set("content-encoding", "gzip");
  headers.append("vary", "accept-encoding");
  headers.delete("content-length");
  return new Response(gz, { status: res.status, statusText: res.statusText, headers });
}

Deno.serve({ port: listenPort }, async (req, info) => gzipped(req, await handle(req, info)));

async function handle(req: Request, info: Deno.ServeHandlerInfo<Deno.NetAddr>): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  // ---------- maintenance ----------
  // Ahead of everything that could read the database, the IP cap's token lookup
  // included, so a shut shrine costs nothing per request. The panel stays open
  // (it is where the switch is turned back off), and so does /version, which
  // reads nothing and is what the embed asks before it loads.
  if (path !== "/version" && path !== "/admin" && !path.startsWith("/admin/")) {
    const m = await maintState();
    if (m.on) return maintReply(m);
  }

  const ip = clientIp(req, info);
  if (!(await requestIsAuthed(req, url)) && !allow("ip:" + ip, 90, 60_000)) return tooMany(60);

  // One token cannot dump HISTORY every few ms. Shared-IP classrooms each
  // have their own token, so they do not share this bucket.
  //
  // The two halves of /events are not the same expense, so they are not the
  // same bucket. A fresh open (since=0) replays the whole public window and
  // stays at six a minute. An incremental poll only reads whatever landed past
  // the cursor, which is usually nothing — a visible tab does one every four
  // seconds, so fifteen a minute is the steady state and the cap sits well
  // above it, with room for the extra catch-up poll each return to the tab
  // fires. Anything above that is not a chat client.
  if (path === "/events") {
    const since = Number(url.searchParams.get("since") || "0") || 0;
    const tok = clip(url.searchParams.get("token"), 64);
    if (tok) {
      if (since <= 0) {
        if (!allow("hist:" + tok, 6, 60_000)) return tooMany(60);
      } else if (!allow("ev:" + tok, 40, 60_000)) return tooMany(30);
    }
  }

  // ---------- apply ----------
  if (req.method === "POST" && path === "/apply") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    const username = clip(b.username, 24);
    const application = clip(b.application, 500);
    if (!username || !application) return json({ error: "missing" }, 400);
    if (impersonatesTung(username)) return json({ error: "that name is his. pick another." }, 409);
    if (!await pendingRoom()) {
      return json({
        error: "tung has more applications than he has read. try again later.",
      }, 503);
    }
    const lower = username.toLowerCase();
    const id = rid(8), token = rid(24);
    const app = { id, username, application, status: "pending", ts: Date.now() };
    const pend = Number((await kv.get<number>(["pendn"])).value) || 0;
    const res = await kv.atomic()
      // the name is still the only thing this commit may be refused over, so
      // "username taken" stays the honest answer to a failure. The counter is
      // deliberately NOT checked: two applications racing would both read the
      // same number and one increment would be lost, which is drift, and drift
      // is what pendingRoom() above is built to absorb. Guarding it would buy
      // an exact count at the price of refusing somebody for no reason.
      .check({ key: ["name", lower], versionstamp: null })
      .set(["name", lower], id)
      .set(["app", id], app)
      .set(["tok", token], id)
      .set(["pendn"], pend + 1)
      .set(["pendq", id], app.ts)
      .commit();
    if (!res.ok) return json({ error: "username taken" }, 409);
    postWebhook(
      APPLICATION_WEBHOOK,
      "**new Shrine of Tung application**\nusername: " + username +
        "\napplication: " + application + "\nid: `" + id + "`",
    );
    return json({ token, status: "pending", username });
  }

  // ---------- login (exported token / hash / key) ----------
  // The identity secret is the same rid(24) token issued by /apply and stored
  // client-side as shrine-token-v1. This endpoint exists so an embed (or a
  // second browser) can restore that session from the key alone. Username is
  // not required: the key is the account. Same CORS as the rest of the API.
  // Does not mint a new token and does not bypass approval / ban checks
  // (those still happen on /status, /events, /send).
  if (req.method === "POST" && path === "/login") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    const token = clip(b.token, 64);
    if (!token) return json({ error: "unauthorized" }, 401);
    const t = await kv.get<string>(["tok", token]);
    if (!t.value) return json({ error: "unauthorized" }, 401);
    // deno-lint-ignore no-explicit-any
    const app = await kv.get<any>(["app", t.value]);
    if (!app.value) return json({ error: "unauthorized" }, 401);
    const bs = blockState(app.value);
    // `blocked` stays the shrine-wide answer — the casino client reads it and
    // must not be told the tables are shut when only the room is. The chat ban
    // rides alongside it in its own field.
    return json({
      token,
      status: app.value.status,
      username: app.value.username,
      blocked: bs.blocked,
      reason: bs.reason,
      until: bs.until,
      ...(bs.why ? { why: bs.why } : {}),
      ...(bs.kind ? { kind: bs.kind } : {}),
      chatBanned: !!app.value.chatBanned,
      banished: !!app.value.banished,
      mod: app.value.mod === true,
    });
  }

  // ---------- version ----------
  // What the embed asks before it loads anything, so a push actually reaches
  // the people running the shrine off a script tag.
  //
  // The problem it solves is not ours, it is the CDN's: jsDelivr holds a branch
  // URL like @main at the edge for hours, and a browser that already has the
  // file holds it for longer still. Somebody who opened the shrine yesterday
  // keeps yesterday's shrine, which is how a friend ends up with a copy that
  // has no poker in it. This answers with a token that changes whenever the
  // code does; embed/shrine.js hangs it off every module URL, so a new
  // deployment is a new URL and nothing anywhere can hand back the old one.
  //
  // It has to be the one thing in the whole system that is never cached, or it
  // would go stale and pin everything else to whatever it last said.
  if (req.method === "GET" && path === "/version") {
    return new Response(JSON.stringify({ v: BUILD }), {
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store, no-cache, must-revalidate",
        ...CORS,
      },
    });
  }

  // ---------- status ----------
  // Token-only. Returning shrine clients store shrine-token-v1 from /apply and
  // never send a username. /login is the same secret for embed / a new browser.
  if (req.method === "GET" && path === "/status") {
    const token = url.searchParams.get("token");
    if (!token) return json({ status: "none" });
    const t = await kv.get<string>(["tok", token]);
    if (!t.value) return json({ status: "none" });
    // deno-lint-ignore no-explicit-any
    const app = await kv.get<any>(["app", t.value]);
    if (!app.value) return json({ status: "none" });
    const bs = blockState(app.value);
    // `thread` carries the back-and-forth between tung and the applicant so the
    // pending screen can show questions and the applicant's answers.
    // `blocked` is the shrine-wide verdict (the casino gate reads it too);
    // `chatBanned` is the narrow one, so a client can shut the room without
    // shutting anything else.
    return json({ status: app.value.status, username: app.value.username, blocked: bs.blocked, reason: bs.reason, until: bs.until, ...(bs.why ? { why: bs.why } : {}), ...(bs.kind ? { kind: bs.kind } : {}), chatBanned: !!app.value.chatBanned, banished: !!app.value.banished, mod: app.value.mod === true, thread: app.value.thread || [] });
  }

  // ---------- respond (applicant replies to tung's follow-up question) ----------
  // works for a PENDING applicant, identified by their token — no approval needed.
  if (req.method === "POST" && path === "/respond") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    const token = clip(b.token, 64);
    if (!token) return json({ error: "unauthorized" }, 401);
    const t = await kv.get<string>(["tok", token]);
    if (!t.value) return json({ error: "unauthorized" }, 401);
    // deno-lint-ignore no-explicit-any
    const app = await kv.get<any>(["app", t.value]);
    if (!app.value) return json({ error: "unauthorized" }, 401);
    const text = clip(b.text, 500);
    if (!text) return json({ error: "empty" }, 400);
    // An applicant holds a token, so they are already past the anonymous IP
    // cap. Answering tung about your application is a thing you do a handful of
    // times, not something that needs to go faster than this.
    if (!allow("resp:" + app.value.id, 4, 30_000)) return tooMany(30);
    // Only while the application is open. A verdict takes the thread off the
    // record, and a line written after it would put one back for the next
    // review to find. The check is on the version read, so a verdict landing
    // between that read and this write is not undone by the write — which
    // would otherwise also flip the account back to pending.
    if (app.value.status !== "pending") return json({ error: "not pending" }, 409);
    const thread = (app.value.thread || [])
      .concat([{ from: "applicant", text, ts: Date.now() }])
      .slice(-THREAD_MAX);
    const put = await kv.atomic().check(app).set(["app", app.value.id], { ...app.value, thread }).commit();
    if (!put.ok) return json({ error: "not pending" }, 409);
    return json({ ok: true, thread });
  }

  // ---------- events (poll) ----------
  // Token-only, same as /status /send /react. Username is not part of the query.
  if (req.method === "GET" && path === "/events") {
    const user = await authUser(url.searchParams.get("token"));
    if (!user) return json({ error: "unauthorized" }, 401);
    // a giveaway whose timer has run out is rolled on the room's own traffic;
    // until one is due this is a comparison and nothing else
    await raffleTick();
    // banned / timed-out / chat-banned users get a blocked payload instead of
    // the room, so the client shows the ban screen and stops polling. This is
    // the read half of the chat ban: no events, so no messages, no reactions,
    // no giveaway announcements — nothing of the room reaches them at all.
    const bs = chatBlock(user);
    if (bs.blocked) return json({ blocked: true, reason: bs.reason, until: bs.until, ...(bs.why ? { why: bs.why } : {}), ...(bs.kind ? { kind: bs.kind } : {}), events: [], cursor: Number(url.searchParams.get("since") || "0") || 0 });
    let since = Number(url.searchParams.get("since") || "0") || 0;
    // The admin dashboard (and its exports) may walk the whole retained log;
    // it proves itself with the admin key. Everyone else is held to the public
    // window, however they ask for it.
    const isAdmin = adminOk(req, url);
    const events: unknown[] = [];
    let cursor = since;
    if (since <= 0) {
      // A fresh open gets exactly the public window: the last OPEN_MSGS lines
      // plus the reacts among them. No full-log dump.
      const win = await recentWindow();
      const inWindow = new Set<string>();
      for (const ev of win.events) {
        events.push(ev);
        if (ev?.type === "msg" && typeof ev.id === "string") inWindow.add(ev.id);
        if (typeof ev?.seq === "number") cursor = ev.seq;
      }
      // Which of these reactions are yours. The counts rebuild themselves from
      // the +1/-1 events, but "did I press this" is state only the server has
      // now — without it a reload would leave your own chips unlit, and pressing
      // one again would be a no-op the client could not explain.
      const mine: [string, string][] = [];
      for await (const e of kv.list<number>({ prefix: ["rx", user.id] }, { limit: 2000 })) {
        const mid = e.key[2], emo = e.key[3];
        if (typeof mid === "string" && typeof emo === "string" && inWindow.has(mid)) mine.push([mid, emo]);
      }
      return json({ events, cursor, mine });
    } else {
      // Incremental poll. A live client is only a few events behind newest, so
      // the common case serves straight from `since` with no extra work. Only
      // when a non-admin asks to reach much further back — a reconnect after
      // being away, or someone hand-editing since=1 to scrape the backlog — do
      // we pull it up to the public window's floor. That both enforces "no
      // further than the last OPEN_MSGS messages without admin" and defuses the
      // replay-from-1 read amplification, since the reach-back can no longer
      // return the whole log. The bounded catch-up scan is itself capped in KV
      // so it cannot be spun across isolates.
      if (!isAdmin) {
        const seqTip = await kv.get<number>(["seq"]);
        const newest = seqTip.value ?? 0;
        if (since < newest - 60) {
          if (!await allowGlobal("hist:" + user.id, 10, 60_000)) return tooMany(30);
          const win = await recentWindow();
          if (win.floor > 0 && since < win.floor - 1) {
            since = win.floor - 1;
            cursor = since;
          }
        }
      }
      // deno-lint-ignore no-explicit-any
      for await (const e of kv.list<any>({ prefix: ["ev"], start: ["ev", since + 1] }, { limit: HISTORY })) {
        if (!deletedLine(e.value)) events.push(e.value);
        cursor = e.value.seq;
      }
    }
    return json({ events, cursor });
  }

  // ---------- send ----------
  if (req.method === "POST" && path === "/send") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    const user = await authUser(b.token);
    if (!user) return json({ error: "unauthorized" }, 401);
    const sbs = chatBlock(user);
    if (sbs.blocked) return json({ error: "blocked", reason: sbs.reason, until: sbs.until }, 403);
    const text = clip(b.text, 1000);
    if (!text) return json({ error: "empty" }, 400);
    // Per-account flood cap: MSG_MAX messages per MSG_WINDOW_MS. Keyed on the
    // account, not the IP or connection, so it holds whether someone spams from
    // one tab, several tabs, or a script reusing the token — and a shared
    // classroom IP is unaffected. Checked only after the message proves
    // non-empty, so empty POSTs cannot burn a real message's allowance. The
    // in-memory gate rejects a rapid burst on the spot at zero KV cost; the KV
    // gate, reached only once a send is otherwise allowed, makes the cap hold
    // across isolates so it cannot be sidestepped by fanning out. The admin key
    // posts uncapped, for moderator announcements and for seeding.
    const modPost = ADMIN_KEY !== "" && String(b.key ?? "") === ADMIN_KEY;
    if (!modPost) {
      if (!allow("msg:" + user.id, MSG_MAX, MSG_WINDOW_MS)) return tooMany(Math.ceil(MSG_WINDOW_MS / 1000));
      if (!await allowGlobal("msg:" + user.id, MSG_MAX, MSG_WINDOW_MS)) return tooMany(Math.ceil(MSG_WINDOW_MS / 1000));
    }
    // A reply used to carry the quoted name and text straight from the sender,
    // which meant anyone could post a reply block attributing any words to any
    // member — or to tung. Only the id travels now; the words are read back out
    // of what was actually posted. A quote whose message has aged out of the
    // two week window is dropped rather than invented, so the message still
    // sends, just without the quote.
    let reply: { id: string; name: string; text: string } | null = null;
    const replyId = b.reply && b.reply.id ? clip(b.reply.id, 32) : "";
    if (replyId) {
      const q = await kv.get<MsgRef>(["msg", replyId]);
      if (q.value) {
        reply = { id: replyId, name: String(q.value.name), text: String(q.value.text).slice(0, 140) };
      }
    }
    // The id is the sender's, so their own optimistic bubble matches the one
    // that comes back — but it is claimed exactly once. Without that, picking
    // an id that is already taken would overwrite another message's entry in
    // the quote index and let a reply be pointed at rewritten words.
    const id = clip(b.id, 32) || rid(8);
    const claim = await kv.atomic()
      .check({ key: ["msg", id], versionstamp: null })
      .set(["msg", id], { name: user.username, text, from: null, uid: user.id } as MsgRef, { expireIn: TTL_MS })
      .commit();
    if (!claim.ok) return json({ error: "duplicate" }, 409);
    const posted: Record<string, unknown> = { type: "msg", id, name: user.username, text, reply };
    await appendEvent(posted, user.id);
    // tung occasionally has something to add. only ever after a real message,
    // so the room is never talking to itself.
    await maybeWisdom();
    return json({ ok: true, ts: posted.ts });
  }

  // ---------- react ----------
  // Counts are accumulated by each client from the +1/-1 events it sees, so an
  // unrecorded reaction is an unbounded one: the old route took `op` from the
  // sender and kept no state, which meant a hundred POSTs put a hundred on the
  // chip. Whether a given person has a given reaction on a given message is now
  // a fact the server holds, and the delta is derived from it — so pressing the
  // same reaction twice is a no-op, and the count can never exceed the number
  // of real members who actually pressed it.
  // ---------------------------------------------------------------------------
  // DIRECT MESSAGES
  //
  // A room and a conversation are different shapes and are kept apart rather
  // than being one log with a filter on it. The room is one append-only stream
  // everybody reads; a DM is a stream of its own, and the pair it belongs to is
  // the key, so there is no per-message access check to get wrong later — if
  // you can name the conversation you are in it, and the name is built from
  // both ids, so you can only ever name your own.
  //
  // KV:
  //   ["dmseq", conv]        -> number            the conversation's counter
  //   ["dmev", conv, seq]    -> DmMsg             one line, listed by seq
  //   ["dmconv", uid, other] -> DmConv            one side's view of it
  //
  // The chat ban covers this completely, in both directions: somebody shut out
  // of the room can neither send a DM nor be sent one. A ban that left DMs open
  // would not be a ban, it would be a change of venue — and one that only
  // stopped them sending would leave everyone else able to talk AT them.

  if (req.method === "GET" && path === "/dm/list") {
    const u = await authUser(url.searchParams.get("token"));
    if (!u) return json({ error: "unauthorized" }, 401);
    const bs = chatBlock(u);
    if (bs.blocked) return json({ error: "blocked", reason: bs.reason, until: bs.until }, 403);
    // The rail is the most expensive read in the whole DM story: one KV read
    // per conversation, and then another per conversation for the block below.
    // The client asks for it every twelve seconds; this is roughly twelve times
    // that, and a refused one is simply dropped by the client and asked for
    // again on the next tick, so nobody ever sees it happen.
    if (!allow("dmls:" + u.id, 10, 10_000)) return tooMany(10);
    const convs: {
      id: string; name: string; last: string; ts: number; unread: number;
      closed: boolean; byYou: boolean; byThem: boolean; tung?: boolean;
    }[] = [];
    // Bounded, so that one read of a rail costs what one read of a rail costs
    // however many rows are behind it. DM_CONV_MAX is what stops an account
    // MAKING rows; this is what stops an account having rows made AT it — a
    // hundred members all opening a conversation with the same person is a
    // hundred rows on that person's rail and nothing they agreed to.
    for await (const e of kv.list<DmConv>({ prefix: ["dmconv", u.id] }, { limit: DM_RAIL })) {
      const v = e.value;
      if (!v) continue;
      const id = String(e.key[2]);
      convs.push({
        id, name: v.name, last: v.last, ts: v.ts,
        unread: dmUnread(v),
        closed: false, byYou: false, byThem: false,
        // the id, not the cached name: a rename cannot put his mark on a member,
        // and nothing but this id is him
        ...(id === TUNG_DM_ID ? { tung: true } : {}),
      });
    }
    convs.sort((a, c) => c.ts - a.ts);
    // One read per conversation, and only for the handful the rail shows. A
    // shut conversation stops counting unread: there is nothing waiting in it
    // to be read. Each end is told which of them shut it — both, if both did.
    await Promise.all(convs.map(async (c) => {
      const b = await dmBlockOf(u.id, c.id);
      if (!dmBlocked(b)) return;
      c.closed = true;
      c.byYou = !!b[dmSide(u.id, c.id)];
      c.byThem = !!b[dmSide(c.id, u.id)];
      c.unread = 0;
    }));
    return json({ ok: true, convs });
  }

  // One conversation. `since` is the last seq this client has, so an open
  // window costs one small read; opening it fresh replays what is kept.
  // Reading it is what marks it read — there is no separate call to forget.
  if (req.method === "GET" && path === "/dm/with") {
    const u = await authUser(url.searchParams.get("token"));
    if (!u) return json({ error: "unauthorized" }, 401);
    const bs = chatBlock(u);
    if (bs.blocked) return json({ error: "blocked", reason: bs.reason, until: bs.until }, 403);
    // The poll, before anything is looked up: naming the other end costs up to
    // three reads on its own, so the clock goes in front of it rather than
    // behind. The client asks every 2.5 seconds with a conversation open, which
    // is a quarter of this, and a refused poll retries in four seconds without
    // showing anything — so this is invisible to a person and a wall to a loop.
    if (!allow("dmw:" + u.id, 20, 10_000)) return tooMany(5);
    // Floored, because `since` indexes a KV key and a fractional one is not a
    // seq — it is a way of asking for the same page again under a new name.
    const since = Math.max(0, Math.floor(Number(url.searchParams.get("since")) || 0));
    // A poll that carries a cursor reads the handful of lines past it and is
    // nearly free. A poll that carries NO cursor replays the conversation —
    // up to DM_PAGE reads and a few hundred KB out — and that is the one worth
    // counting. The client does it once, when a conversation is opened; this
    // allows a conversation opened every three seconds for a minute.
    if (since === 0 && !allow("dmcold:" + u.id, 20, 60_000)) return tooMany(20);
    const other = await dmOther(url.searchParams.get("with"));
    if (!other) {
      // Nobody by that name or id. If it is a conversation on this member's
      // rail, its other end was deleted: those reads were the ones paid to
      // find out, and the conversation goes now rather than sitting on the
      // rail as a row that can never be opened.
      const w = clip(url.searchParams.get("with"), 32);
      if (w && w !== TUNG_DM_ID && !(await kv.get(["app", w])).value) {
        if ((await kv.get(["dmconv", u.id, w])).value) await purgeConversation(u.id, w);
      }
      return json({ error: "not_found" }, 404);
    }
    if (other.id === u.id) return json({ error: "yourself" }, 400);
    // A member who has been shut out of the room is not somewhere you can
    // write to, and the conversation reads as closed rather than as missing.
    if (chatBlock(other).blocked) {
      return json({ ok: true, with: dmPeerView(other), msgs: [], seq: 0, closed: true });
    }
    // Blocked reads as closed, and says whose block it is: `byYou` is the
    // difference between a button that says "unblock" and nothing you can do,
    // and `byThem` is what lets the page say "you have been blocked by X"
    // instead of leaving them to wonder. Both can be true at once.
    const bl = await dmBlockOf(u.id, other.id);
    if (dmBlocked(bl)) {
      const mine = !!bl[dmSide(u.id, other.id)];
      const theirs = !!bl[dmSide(other.id, u.id)];
      return json({
        ok: true, with: dmPeerView(other), msgs: [], seq: 0,
        closed: true, ...(mine ? { byYou: true } : {}), ...(theirs ? { byThem: true } : {}),
      });
    }
    // and the cross-isolate half of the same cap. The in-memory buckets above
    // are per isolate, so a caller spread across several of them gets several;
    // one KV read and one KV write is a bargain against the three hundred a
    // replay can cost, which is exactly the trade allowGlobal() exists for.
    // It is spent HERE, past every refusal above, so a 404 or a shut
    // conversation never costs a write.
    if (since === 0 && !await allowGlobal("dmcold:" + u.id, 40, 60_000)) return tooMany(60);
    const conv = convOf(u.id, other.id);
    const msgs: { seq: number; text: string; ts: number; mine: boolean; from?: "tung"; del?: number }[] = [];
    let top = since;
    for await (
      const e of kv.list<DmMsg>(
        { prefix: ["dmev", conv], start: ["dmev", conv, since + 1] },
        { limit: DM_PAGE },
      )
    ) {
      const v = e.value;
      if (!v) continue;
      top = Math.max(top, v.seq);
      // a line its author took back is only ever the admin dump's
      if (v.deleted) continue;
      // a retraction: the window drops that seq, and draws nothing
      if (v.del) {
        msgs.push({ seq: v.seq, text: "", ts: v.ts, mine: v.from === u.id, del: v.del });
        continue;
      }
      // from:"tung" is the same stamp the room puts on his lines, and on
      // nothing else. The client styles that and never the name.
      msgs.push({
        seq: v.seq, text: v.text, ts: v.ts, mine: v.from === u.id,
        ...(v.from === TUNG_DM_ID ? { from: "tung" as const } : {}),
      });
    }
    // reading is what clears the badge, and only ever forward
    if (top > since) await dmMarkRead(u.id, other.id, top);
    return json({ ok: true, with: dmPeerView(other), msgs, seq: top });
  }

  // Block or unblock one member. Yours to set and yours to lift; the other end
  // sees that you blocked them, and sees it lifted when you lift it.
  if (req.method === "POST" && path === "/dm/block") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    const u = await authUser(b.token);
    if (!u) return json({ error: "unauthorized" }, 401);
    const bs = chatBlock(u);
    if (bs.blocked) return json({ error: "blocked", reason: bs.reason, until: bs.until }, 403);
    // Setting a block is a KV WRITE, and flipping one back and forth is a KV
    // write every time — the one DM route where the cost is not reads. Blocking
    // somebody is a thing a person does once and thinks about first, so this is
    // deliberately the tightest clock of the four, and it sits in front of the
    // lookup because naming the other end costs reads of its own.
    if (!allow("dmblk:" + u.id, 10, 60_000)) return tooMany(60);
    if (!await allowGlobal("dmblk:" + u.id, 20, 10 * 60_000)) return tooMany(600);
    const other = await dmOther(b.to);
    if (!other) return json({ error: "not_found" }, 404);
    if (other.id === u.id) return json({ error: "yourself" }, 400);
    if (other.id === TUNG_DM_ID) return json({ error: "tung", blocked: false }, 403);
    const on = b.blocked !== false;
    const next = await dmSetBlock(u.id, other.id, on);
    return json({
      ok: true, blocked: dmBlocked(next),
      byYou: !!next[dmSide(u.id, other.id)], byThem: !!next[dmSide(other.id, u.id)],
    });
  }

  if (req.method === "POST" && path === "/dm/send") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    const u = await authUser(b.token);
    if (!u) return json({ error: "unauthorized" }, 401);
    const bs = chatBlock(u);
    if (bs.blocked) return json({ error: "blocked", reason: bs.reason, until: bs.until }, 403);
    const text = clip(b.text, 1000);
    if (!text) return json({ error: "empty" }, 400);
    if (!allow("dm:" + u.id, MSG_MAX, MSG_WINDOW_MS)) return tooMany(Math.ceil(MSG_WINDOW_MS / 1000));
    if (!await allowGlobal("dm:" + u.id, MSG_MAX, MSG_WINDOW_MS)) return tooMany(Math.ceil(MSG_WINDOW_MS / 1000));
    // The flood cap above is about bursts, and on its own it is also a licence:
    // three lines every six seconds, kept up, is thirty a minute and forty-odd
    // thousand a day — seven KV operations each — from one account, quietly,
    // where nobody in the room would ever see it. This is the long window that
    // burst caps do not have. DM_HOUR_MAX is already far more
    // than anybody writes; it is a quarter of what the burst cap alone allows.
    if (!await allowGlobal("dmhr:" + u.id, DM_HOUR_MAX, 60 * 60_000)) return tooMany(600);
    const other = await dmOther(b.to);
    if (!other) return json({ error: "not_found" }, 404);
    if (other.id === u.id) return json({ error: "yourself" }, 400);
    // the other half of the ban: you cannot write to somebody who has been
    // shut out, any more than they could write to you
    if (chatBlock(other).blocked) return json({ error: "closed" }, 403);
    // and a block shuts it from either side, and says whose it is: your own
    // block comes first, because it is the one you can do something about
    const sbl = await dmBlockOf(u.id, other.id);
    if (dmBlocked(sbl)) {
      return json({
        error: sbl[dmSide(u.id, other.id)] ? "you_blocked" : "blocked_you",
        name: other.username,
      }, 403);
    }
    // ---- opening a NEW conversation ----------------------------------------
    // Replying in a conversation that already exists writes one line and moves
    // two rows that were there anyway. Opening a new one puts two rows on two
    // rails for a month, and every read of either rail pays for them from then
    // on — which is why "hello" to every member of the shrine is not thirty
    // messages, it is thirty rails made permanently more expensive, on top of
    // thirty inboxes nobody asked for. So the expensive case is told apart
    // from the cheap one HERE, by one read, and only it pays:
    //
    //   the clock  — five new conversations a minute, ten in ten minutes
    //                across isolates, against a flood cap that would otherwise
    //                allow thirty fresh ones a minute forever;
    //   the cap    — DM_CONV_MAX of them, ever. Counted only at this point and
    //                only as far as the cap, so it is never paid for by
    //                somebody talking to people they already talk to.
    //
    // A member with a normal number of conversations never meets either. The
    // ceiling is deliberately a refusal rather than a queue: there is nothing
    // sensible to do with the line, and saying so is cheaper than keeping it.
    const opened = await kv.get<DmConv>(["dmconv", u.id, other.id]);
    if (!opened.value) {
      if (!allow("dmnew:" + u.id, 5, 60_000)) return tooMany(60);
      if (!await allowGlobal("dmnew:" + u.id, 10, 10 * 60_000)) return tooMany(600);
      if (await dmConvCount(u.id, DM_CONV_MAX) >= DM_CONV_MAX) {
        return json({ error: "too_many", max: DM_CONV_MAX }, 403);
      }
    }
    const msg = await dmAppend(u, other, text);
    if (!msg) return json({ error: "busy" }, 503);
    return json({ ok: true, msg: { seq: msg.seq, text: msg.text, ts: msg.ts, mine: true } });
  }

  // Take back one of your own lines in a conversation. Only yours, only while
  // the conversation is open — a shut one shows nothing to take back.
  if (req.method === "POST" && path === "/dm/delete") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    const u = await authUser(b.token);
    if (!u) return json({ error: "unauthorized" }, 401);
    const bs = chatBlock(u);
    if (bs.blocked) return json({ error: "blocked", reason: bs.reason, until: bs.until }, 403);
    // a handful of reads and one commit each; a person deletes a line now and
    // then, a script deleting in a loop is the thing being priced
    if (!allow("dmdel:" + u.id, 10, 10_000)) return tooMany(10);
    if (!await allowGlobal("dmdel:" + u.id, 30, 60_000)) return tooMany(60);
    const target = Math.floor(Number(b.seq));
    if (!(target > 0)) return json({ error: "bad" }, 400);
    const other = await dmOther(b.with);
    if (!other) return json({ error: "not_found" }, 404);
    if (other.id === u.id) return json({ error: "yourself" }, 400);
    if (dmBlocked(await dmBlockOf(u.id, other.id))) return json({ error: "closed" }, 403);
    const res = await dmRetract(u, other, target);
    if (res === "gone") return json({ error: "gone" }, 404);
    if (res === "forbidden") return json({ error: "forbidden" }, 403);
    if (res === "busy") return json({ error: "busy" }, 503);
    return json({ ok: true, seq: target });
  }

  if (req.method === "POST" && path === "/react") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    const user = await authUser(b.token);
    if (!user) return json({ error: "unauthorized" }, 401);
    const rbs = chatBlock(user);
    if (rbs.blocked) return json({ error: "blocked", reason: rbs.reason, until: rbs.until }, 403);
    const id = clip(b.id, 32);
    const e = clip(b.e, 16);
    const eid = clip(b.eid, 16) || rid(6);
    if (!id || !e) return json({ error: "bad" }, 400);
    if (!REACTIONS.has(e)) return json({ error: "not a reaction" }, 400);
    // you may only react to something that was actually said
    const target = await kv.get<MsgRef>(["msg", id]);
    if (!target.value) return json({ error: "gone" }, 404);
    if (!allow("rx:" + user.id, 30, 10_000)) return tooMany(10);
    // keyed by person first so a client can be told, on open, which of the
    // chips in front of it are its own — see the `mine` list on /events
    const key = ["rx", user.id, id, e];
    const cur = await kv.get<number>(key);
    const on = cur.value === 1;
    const wants = b.op === -1 ? false : true;
    if (on === wants) return json({ ok: true, state: on ? 1 : 0, noop: true });
    const flip = wants
      ? kv.atomic().check(cur).set(key, 1, { expireIn: TTL_MS })
      : kv.atomic().check(cur).delete(key);
    if (!(await flip.commit()).ok) return json({ ok: true, state: on ? 1 : 0, noop: true });
    await appendEvent({ type: "react", id, e, op: wants ? 1 : -1, eid, name: user.username });
    return json({ ok: true, state: wants ? 1 : 0 });
  }

  // ---------- delete a message (its author, or a moderator) ----------
  // Anybody may take back their own line. Anybody ELSE's is the one power the
  // moderator flag buys. A moderator is an ordinary approved member everywhere
  // it can be seen: the flag never rides on a chat event, a reaction or a
  // profile, so nobody in the room can work out who holds it. The only place
  // it is disclosed is /status and /login, to the account itself, so its own
  // client knows to draw the bin on every line rather than only on its own.
  // Chat bans and timeouts still apply — somebody barred from the room does
  // not get to reach into it, even to tidy up after themselves.
  if (req.method === "POST" && path === "/delete") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    // tung's own key works here too, so the room can be cleaned up without
    // first handing the flag to an account.
    const byKey = ADMIN_KEY !== "" && String(b.key ?? "") === ADMIN_KEY;
    const id = clip(b.id, 32);
    let deleter = "";
    if (!byKey) {
      const user = await authUser(b.token);
      if (!user) return json({ error: "unauthorized" }, 401);
      deleter = String(user.username || "");
      const dbs = chatBlock(user);
      if (dbs.blocked) return json({ error: "blocked", reason: dbs.reason, until: dbs.until }, 403);
      if (!allow("del:" + user.id, 20, 10_000)) return tooMany(10);
      if (!await allowGlobal("del:" + user.id, 20, 10_000)) return tooMany(10);
      if (!id) return json({ error: "bad" }, 400);
      if (user.mod !== true) {
        // one read, and it is the read the delete makes anyway
        const ref = await kv.get<MsgRef>(["msg", id]);
        if (!ref.value) return json({ error: "gone" }, 404);
        if (!ownsMessage(ref.value, user)) return json({ error: "forbidden" }, 403);
      }
    }
    if (!id) return json({ error: "bad" }, 400);
    if (!await deleteMessage(id, byKey ? "tung" : deleter)) return json({ error: "gone" }, 404);
    return json({ ok: true, id });
  }

  // ---------- web veil: is it open, and where does it go? ----------
  // Approved members only, and the URL ships only when the veil is actually
  // open — a closed veil never discloses the destination.
  if (req.method === "GET" && path === "/veil") {
    const user = await authUser(url.searchParams.get("token"));
    if (!user || user.status !== "approved") return json({ error: "unauthorized" }, 401);
    if (blockState(user).blocked) return json({ error: "blocked" }, 403);
    if (!await veilLive()) return json({ live: false, allowed: false });
    // The veil being open is not the same as it being open to you. Membership of
    // the whitelist is per-account and off by default, and the destination
    // travels only to someone who is on it.
    if (user.veil !== true) return json({ live: true, allowed: false });
    return json({ live: true, allowed: true, url: PROXY_URL });
  }

  // ---------- claim a giveaway ----------
  // First one here wins, and wins exactly once. The claim and the payout land
  // in a SINGLE atomic commit guarded by checks on both keys we read: if
  // anyone else took the gift, or this player's balance moved, the commit is
  // refused and we look again. That closes both races at once — two people
  // cannot both be paid, and there is no window where a gift reads as claimed
  // but was never credited.
  if (req.method === "POST" && path === "/gift/claim") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    const user = await authUser(b.token);
    if (!user) return json({ error: "unauthorized" }, 401);
    // a claim announces itself in the room under the claimant's name, so it is
    // a chat write and answers to the chat gate, not the shrine-wide one
    if (chatBlock(user).blocked) return json({ error: "blocked" }, 403);
    const id = clip(b.id, 32);
    if (!id) return json({ error: "missing" }, 400);
    // A gift is claimed once and the losers are told so — but a loser still
    // paid a read to find out, and the eight-attempt race below can pay
    // several. Racing for a giveaway is the point; doing it a thousand times a
    // second is not.
    if (!allow("gift:" + user.id, 20, 10_000)) return tooMany(10);
    // a claim ban from the sahur watch covers giveaways unless it was set not
    // to, and a reduced claim pays a reduced giveaway
    const pen = penaltyNow(await claimPenalty(user.id));
    if (pen.banned && pen.banGifts) return json({ error: "claim_banned", until: pen.banUntil }, 403);

    for (let attempt = 0; attempt < 8; attempt++) {
      const gift = await kv.get<Gift>(["gift", id]);
      if (!gift.value) return json({ error: "gone" }, 404);
      if (gift.value.claimedBy) return json({ error: "claimed", by: gift.value.claimedBy }, 409);
      const full = round2(Number(gift.value.amount) || 0);
      if (!(full > 0)) return json({ error: "gone" }, 404);
      const amount = round2(full * pen.reducePct / 100);
      // cut to nothing, they would only be taking it from somebody else
      if (!(amount > 0)) return json({ error: "claim_banned", until: pen.reduceUntil }, 403);

      const cur = await kv.get<{ bal: number; lastClaim: number }>(["cas", user.id]);
      const rec = cur.value ?? { bal: 0, lastClaim: 0 };
      const base = Number.isFinite(rec.bal) ? rec.bal : 0;
      const nb = round2(base + amount);
      if (!Number.isFinite(nb)) return json({ error: "gone" }, 404);

      const claimedAt = Date.now();
      const res = await kv.atomic()
        .check(gift)
        .check(cur)
        .set(["gift", id], { ...gift.value, claimedBy: user.username, claimedAt }, { expireIn: TTL_MS })
        .set(["cas", user.id], { ...rec, bal: nb }, { expireIn: CAS_TTL })
        .commit();
      if (res.ok) {
        // how fast from the giveaway appearing to being taken is what gives a
        // script away: it read the room before a person could have
        await watchClaim(user, {
          ts: claimedAt, kind: "gift", amt: amount, lag: claimedAt - (Number(gift.value.ts) || claimedAt),
          gid: id, cli: cleanCli(b.cli),
        }, ip);
        // tell the room, so every open client retires the button at once
        await appendEvent({ type: "gift", id, by: user.username, amount });
        return json({ ok: true, amount, balance: nb, by: user.username });
      }
      // lost the check: either someone claimed it, or our own balance moved.
      // the next pass re-reads and finds out which.
    }
    return json({ error: "busy" }, 503);
  }

  // ---------- enter one of tung's giveaways ----------
  // One entry per member, and entering is all it is: nothing is paid here, so
  // there is nothing to race. The commit is checked against the giveaway's own
  // record, which only changes when it is rolled or called off, so an entry can
  // never land in a draw that has already been made.
  if (req.method === "POST" && path === "/raffle/enter") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    const user = await authUser(b.token);
    if (!user) return json({ error: "unauthorized" }, 401);
    // the card lives in the room, so it answers to the room's gate
    if (chatBlock(user).blocked) return json({ error: "blocked" }, 403);
    const id = clip(b.id, 32);
    if (!id) return json({ error: "missing" }, 400);
    if (!allow("raffle:" + user.id, 20, 10_000)) return tooMany(10);
    await raffleTick();
    const pen = penaltyNow(await claimPenalty(user.id));
    if (pen.banned && pen.banGifts) return json({ error: "claim_banned", until: pen.banUntil }, 403);
    const re = await kv.get<Raffle>(["raffle", id]);
    const r = re.value;
    if (!r) return json({ error: "gone" }, 404);
    if (r.status !== "open" || Date.now() >= r.endsAt) return json({ error: "over", status: r.status }, 409);
    const mine = await kv.get(["raffle_in", id, user.id]);
    let already = mine.value !== null;
    if (!already) {
      const res = await kv.atomic().check(re).check(mine)
        .set(["raffle_in", id, user.id], { name: user.username, ts: Date.now() }, { expireIn: RAFFLE_TTL })
        .sum(["rafflen", id], 1n)
        .commit();
      if (!res.ok) {
        // either they entered twice at once, or the draw was made in between
        if ((await kv.get(["raffle_in", id, user.id])).value !== null) already = true;
        else return json({ error: "over" }, 409);
      }
    }
    const n = (await kv.get<Deno.KvU64>(["rafflen", id])).value;
    return json({ ok: true, already, entries: n ? Number(n.value) : 0, endsAt: r.endsAt });
  }

  // ======================= THE PIT (player vs player) =======================
  // Auth is the same casino gate as everywhere else. Every route that touches a
  // duel goes through loadDuel(), so an overdue table settles itself before the
  // request is even considered — you cannot act on a duel whose clock has run.

  // ---------- what is on offer, and what am I already in ----------
  if (req.method === "GET" && path === "/duel/list") {
    const u = await casUser(url.searchParams.get("token"));
    if (!u) return json({ error: "unauthorized" }, 401);
    // The lobby asks for this every 1.5 seconds, and this is several times that;
    // nothing else should be asking at all.
    if (!allow("plist:" + u.id, 20, 10_000)) return tooMany(10);
    const open: unknown[] = [];
    // The index, not the duels. This used to walk every duel record there was
    // and throw away the finished ones — and a finished one lingers a day, so
    // it was reading the day's history to show a handful of rows. It now reads
    // the tables that are actually filling and nothing else.
    for await (const e of kv.list<number>({ prefix: ["duelopen"] }, { limit: 200 })) {
      const id = String(e.key[1]);
      // loadDuel() sweeps an overdue table on the way past, so one that ran out
      // its ten minutes comes back settled and is dropped by the line below —
      // the host still gets their stake home without reopening the page.
      const d = (await loadDuel(id)).value;
      // the record is the truth and the index is a hint, so an entry that has
      // stopped being true is swept here rather than believed
      if (!d || d.settled || d.state !== "open") { await kv.delete(["duelopen", id]); continue; }
      open.push({
        id: d.id, game: d.game, gameName: DUEL_GAMES[d.game]?.name || d.game,
        bet: d.bet, seats: duelSeats(d), filled: seatedPlayers(d).length,
        // worth knowing before you sit down: whether you are waiting for the
        // last chair to fill or for one person to decide
        hostStarts: HOST_STARTS.has(d.game),
        host: d.host.name, mine: d.host.id === u.id, ts: d.ts, deadline: d.deadline,
        // chess only: what you are sitting down to. Two people who agreed on a
        // stake can still want very different games, and "3 | 2" is the whole
        // difference between a quick one and an evening.
        ...(d.game === "chess"
          ? { tcName: (CHESS_TC[d.tc || CHESS_TC_DEFAULT] || CHESS_TC[CHESS_TC_DEFAULT]).name }
          : {}),
      });
    }
    open.sort((a, b) => (b as { ts: number }).ts - (a as { ts: number }).ts);
    const lock = await kv.get<string>(["duelof", u.id]);
    let mine = null;
    if (lock.value) {
      const d = await loadDuel(lock.value);
      // a settled duel is not "mine" any more — commitDuel drops the lock, but a
      // stale one must not pin the player out of starting another
      if (d.value && !d.value.settled) mine = duelView(d.value, u.id);
      else if (!d.value) await kv.delete(["duelof", u.id]);
    }
    const c = await getCas(u.id);
    return json({
      ok: true, balance: round2(c.bal), open, mine, now: Date.now(),
      games: Object.keys(DUEL_GAMES).map((k) => ({ id: k, name: DUEL_GAMES[k].name })),
      openMs: DUEL_OPEN_MS, confirmMs: DUEL_CONFIRM_MS, moveMs: DUEL_MOVE_MS,
      compMs: DUEL_COMP_MS, compStack: DUEL_COMP_STACK,
    });
  }

  // ---------- put a table up ----------
  if (req.method === "POST" && path === "/duel/create") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    const u = await casUser(b.token);
    if (!u) return json({ error: "unauthorized" }, 401);
    // Churn guard only. What actually stops someone flooding the pit is the
    // one-table-at-a-time lock below; this just keeps open/cancel cycling from
    // becoming a write amplifier.
    if (!allow("duel:" + u.id, 20, 60_000)) return tooMany(30);
    const game = DUEL_GAMES[clip(b.game, 16)] ? clip(b.game, 16) : null;
    if (!game) return json({ error: "no such game" }, 400);
    // A friendly table stakes nothing, so it skips the wager floor entirely —
    // and because the debit, the escrow and the payout are all `bet` arithmetic,
    // a bet of zero moves no money anywhere without a single special case
    // further down.
    const free = FREE_OK.has(game) && Number(b.bet) === 0;
    const bet = free ? 0 : parseBet(b.bet);
    if (bet === null) return json({ error: wagerError(b.bet) }, 400);
    // one table at a time. the lock is claimed in the same commit as the debit,
    // so two tabs racing to open a table cannot both stake.
    const lock = await kv.get<string>(["duelof", u.id]);
    if (lock.value) return json({ error: "already in a duel" }, 409);
    const cur = await kv.get<{ bal: number; lastClaim: number }>(["cas", u.id]);
    const rec = cur.value ?? { bal: 0, lastClaim: 0 };
    const base = Number.isFinite(rec.bal) ? rec.bal : 0;
    const nb = round2(base - bet);
    if (nb < -1e-9) return json({ error: "insufficient" }, 402);
    const now = Date.now();
    const id = rid(10);
    const want = Number(b.seats);
    const max = SEAT_MAX[game] ?? 2;
    // A table the host closes is not a table waiting to fill, so the number
    // asked for is not read at all: it opens with every chair it has and the
    // host decides how many of them are playing.
    const seats = HOST_STARTS.has(game)
      ? max
      : (MULTI_SEAT.has(game) && want >= 3 && want <= max ? want : 2);
    const duel: Duel = {
      id, game, bet, seats, host: duelSide(u), guest: null, extra: [], state: "open", ts: now,
      deadline: now + DUEL_OPEN_MS, round: 1, settled: false, winner: null, paid: [], reason: "", rounds: [],
      ...(game === "chess" ? { tc: chessTc(b.tc) } : {}),
    };
    const res = await duelIndex(
      kv.atomic()
        .check(lock).check(cur)
        .set(["duelof", u.id], id, { expireIn: DUEL_TTL })
        .set(["cas", u.id], { ...rec, bal: Math.max(0, nb) }, { expireIn: CAS_TTL })
        .set(["duel", id], duel, { expireIn: DUEL_TTL }),
      duel,
    ).commit();
    if (!res.ok) return json({ error: "busy" }, 409);
    return json({ ok: true, duel: duelView(duel, u.id), balance: Math.max(0, nb) });
  }

  // ---------- take the table back down ----------
  // Only while it is still filling. A 2-seat table stops being open the
  // instant someone sits, so a cancel cannot slip in after the handshake
  // starts. A 3- or 4-seat Cut stays open until the last chair is taken,
  // and taking it down refunds everyone who already sat.
  if (req.method === "POST" && path === "/duel/cancel") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    const u = await casUser(b.token);
    if (!u) return json({ error: "unauthorized" }, 401);
    if (!allow("dact:" + u.id, PIT_BURST, PIT_BURST_MS)) return tooMany(10);
    const entry = await loadDuel(clip(b.id, 32));
    const d = entry.value;
    if (!d) return json({ error: "gone" }, 404);
    if (d.host.id !== u.id) return json({ error: "not yours" }, 403);
    if (d.settled) return json({ error: "over", duel: duelView(d, u.id) }, 409);
    if (d.state !== "open") return json({ error: "someone is at the table", duel: duelView(d, u.id) }, 409);
    const out = finishDuel(d, null, "cancelled");
    if (!await commitDuel(entry, out.next, out.credits)) {
      const again = await loadDuel(d.id);
      return json({ error: "someone is at the table", duel: again.value ? duelView(again.value, u.id) : null }, 409);
    }
    return json({ ok: true, refunded: d.bet, balance: round2((await getCas(u.id)).bal) });
  }

  // ---------- deal with whoever is here ----------
  // The host's own call, on a table that waits for a decision rather than for
  // a chair. A poker table nobody else found used to sit open for ten minutes
  // and then refund itself; now it is a heads-up game the moment the host says
  // so. Two is the floor — one player is not a game — and five is still the
  // ceiling, because that is how many chairs it has.
  //
  // It hands over to exactly the same handshake a full table does: everybody
  // seated has to say yes inside the confirm window or every stake goes home.
  // Starting is choosing WHO is at the table, not skipping the agreeing to it.
  //
  // Retried rather than refused on a lost race, because the thing most likely
  // to have changed underneath is somebody else sitting down — and a table
  // with one more player at it is still a table the host wants to deal.
  if (req.method === "POST" && path === "/duel/start") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    const u = await casUser(b.token);
    if (!u) return json({ error: "unauthorized" }, 401);
    if (!allow("dact:" + u.id, PIT_BURST, PIT_BURST_MS)) return tooMany(10);
    for (let attempt = 0; attempt < 6; attempt++) {
      const entry = await loadDuel(clip(b.id, 32));
      const d = entry.value;
      if (!d) return json({ error: "gone" }, 404);
      if (d.host.id !== u.id) return json({ error: "not yours" }, 403);
      if (d.settled) return json({ error: "over", duel: duelView(d, u.id) }, 409);
      if (!HOST_STARTS.has(d.game)) {
        return json({ error: "that table starts when it fills" }, 400);
      }
      if (d.state !== "open") return json({ error: "not now", duel: duelView(d, u.id) }, 409);
      if (seatedPlayers(d).length < 2) {
        return json({ error: "nobody has sat down yet", duel: duelView(d, u.id) }, 409);
      }
      const next: Duel = { ...d, state: "confirm", deadline: Date.now() + DUEL_CONFIRM_MS };
      const res = await duelIndex(
        kv.atomic()
          .check(entry)
          .set(["duel", d.id], next, { expireIn: DUEL_TTL }),
        next,
      ).commit();
      if (res.ok) return json({ ok: true, duel: duelView(next, u.id) });
    }
    return json({ error: "busy" }, 409);
  }

  // ---------- sit down at someone else's table ----------
  if (req.method === "POST" && path === "/duel/join") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    const u = await casUser(b.token);
    if (!u) return json({ error: "unauthorized" }, 401);
    if (!allow("dact:" + u.id, PIT_BURST, PIT_BURST_MS)) return tooMany(10);
    // a 3- or 4-seat table can take two sit-downs at once, so a lost race
    // against another empty chair is retried rather than called taken
    for (let attempt = 0; attempt < 6; attempt++) {
      const entry = await loadDuel(clip(b.id, 32));
      const d = entry.value;
      if (!d) return json({ error: "gone" }, 404);
      if (d.state !== "open") return json({ error: "taken" }, 409);
      if (d.host.id === u.id) return json({ error: "that is your own table" }, 400);
      if (findSide(d, u.id)) return json({ error: "already in a duel" }, 409);
      if (seatedPlayers(d).length >= duelSeats(d)) return json({ error: "taken" }, 409);
      const lock = await kv.get<string>(["duelof", u.id]);
      if (lock.value) return json({ error: "already in a duel" }, 409);
      const cur = await kv.get<{ bal: number; lastClaim: number }>(["cas", u.id]);
      const rec = cur.value ?? { bal: 0, lastClaim: 0 };
      const bal = Number.isFinite(rec.bal) ? rec.bal : 0;
      const nb = round2(bal - d.bet);
      if (nb < -1e-9) return json({ error: "insufficient" }, 402);
      const extra = extraOf(d).map((s) => ({ ...s }));
      let guest = d.guest ? { ...d.guest } : null;
      if (!guest) guest = duelSide(u);
      else extra.push(duelSide(u));
      const filled = 1 + (guest ? 1 : 0) + extra.length;
      const full = filled >= duelSeats(d);
      const now = Date.now();
      const next: Duel = {
        ...d, guest, extra,
        state: full ? "confirm" : "open",
        deadline: full ? now + DUEL_CONFIRM_MS : d.deadline,
      };
      // seat, stake and lock in one commit: two people racing for the last
      // seat means exactly one debit, and the loser is told the table is taken.
      const res = await duelIndex(
        kv.atomic()
          .check(entry).check(lock).check(cur)
          .set(["duelof", u.id], d.id, { expireIn: DUEL_TTL })
          .set(["cas", u.id], { ...rec, bal: Math.max(0, nb) }, { expireIn: CAS_TTL })
          .set(["duel", d.id], next, { expireIn: DUEL_TTL }),
        next,
      ).commit();
      if (res.ok) return json({ ok: true, duel: duelView(next, u.id), balance: Math.max(0, nb) });
    }
    return json({ error: "taken" }, 409);
  }

  // ---------- call tung into the empty chair ----------
  // The host's table, still filling, at a game tung actually plays. One call is
  // one chair, and he can be called again for as long as a chair is empty — so
  // a four-seat cut with nobody around is you against three of him. He is
  // seated already confirmed, because he is always ready.
  // Nothing is debited for him: his stake is the house's, which is what makes
  // the pot pay the house edge. See finishDuel().
  if (req.method === "POST" && path === "/duel/call") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    const u = await casUser(b.token);
    if (!u) return json({ error: "unauthorized" }, 401);
    if (!allow("dact:" + u.id, PIT_BURST, PIT_BURST_MS)) return tooMany(10);
    for (let attempt = 0; attempt < 6; attempt++) {
      const entry = await loadDuel(clip(b.id, 32));
      const d = entry.value;
      if (!d) return json({ error: "gone" }, 404);
      if (d.host.id !== u.id) return json({ error: "not yours" }, 403);
      if (d.settled || d.state !== "open") return json({ error: "not now", duel: duelView(d, u.id) }, 409);
      if (!CAN_CALL_TUNG.has(d.game)) return json({ error: "tung does not play that one" }, 400);
      const seats = duelSeats(d);
      if (seatedPlayers(d).length >= seats) return json({ error: "taken" }, 409);
      const extra = extraOf(d).map((x) => ({ ...x }));
      let guest = d.guest ? { ...d.guest } : null;
      const nth = botCount(d) + 1;
      if (!guest) guest = tungSide(nth);
      else extra.push(tungSide(nth));
      const filled = 1 + 1 + extra.length;
      const full = filled >= seats;
      const now = Date.now();
      const next: Duel = {
        ...d, guest, extra,
        state: full ? "confirm" : "open",
        deadline: full ? now + DUEL_CONFIRM_MS : d.deadline,
      };
      // no lock and no debit for the chair he is in — there is no account
      // behind it, and the same commit guard still stops a player racing him
      // for the last seat, because it checks the duel we read
      const res = await duelIndex(
        kv.atomic()
          .check(entry)
          .set(["duel", d.id], next, { expireIn: DUEL_TTL }),
        next,
      ).commit();
      if (res.ok) return json({ ok: true, duel: duelView(next, u.id), balance: round2((await getCas(u.id)).bal) });
    }
    return json({ error: "busy" }, 409);
  }

  // ---------- both of you, say yes, within ten seconds ----------
  if (req.method === "POST" && path === "/duel/confirm") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    const u = await casUser(b.token);
    if (!u) return json({ error: "unauthorized" }, 401);
    if (!allow("dact:" + u.id, PIT_BURST, PIT_BURST_MS)) return tooMany(10);
    for (let attempt = 0; attempt < 6; attempt++) {
      const entry = await loadDuel(clip(b.id, 32));
      const d = entry.value;
      if (!d) return json({ error: "gone" }, 404);
      if (d.settled) return json({ error: "over", duel: duelView(d, u.id) }, 409);
      if (d.state !== "confirm") return json({ error: "not now", duel: duelView(d, u.id) }, 409);
      const next: Duel = {
        ...d,
        host: { ...d.host },
        guest: d.guest ? { ...d.guest } : null,
        extra: extraOf(d).map((s) => ({ ...s })),
      };
      const mine = findSide(next, u.id);
      if (!mine) return json({ error: "not your duel" }, 403);
      mine.confirmed = true;
      const people = seatedPlayers(next);
      // Everyone AT the table, rather than every chair the table HAS. A table
      // only reaches this state with its roster already settled — filled to the
      // last chair, or closed by its host at whatever it had — and from here
      // nobody else may sit down, so an empty chair is not somebody to wait
      // for. Counting chairs instead would leave a three-handed poker table
      // that its host dealt sitting in the handshake until it timed out.
      const allIn = people.length >= 2 && people.every((p) => p.confirmed);
      let credits: { id: string; amount: number }[] = [];
      if (allIn && d.game === "cut") {
        // no moves to make: the deck is cut the instant the last yes lands, in
        // the same commit, so there is no unsettled window to time out inside
        const cut = cutDealFor(people);
        const done = finishDuel({ ...next, cards: cut.cards }, cut.winnerId, "play");
        done.next.cards = cut.cards;
        credits = done.credits;
        Object.assign(next, done.next);
      } else if (allIn && d.game === "poker") {
        // chips and the first hand are dealt in the same commit as the last
        // yes, so the blind clock starts when the table does rather than when
        // somebody first gets round to loading it
        next.state = "live";
        next.poker = pokerStart(people);
        next.deadline = Date.now() + POKER_ACT_MS;
      } else if (allIn && d.game === "chess") {
        // the board is set in the same commit as the last yes. Who gets white
        // is decided here and once, because it decides the game and must not be
        // something either client can influence or re-roll.
        next.state = "live";
        next.chess = chessStart(chessTc(d.tc));
        next.deadline = chessDeadline(next.chess);
      } else if (allIn && d.game === "comp") {
        // three minutes on the clock and a stack of wood chips each, dealt in the
        // same commit as the last yes so nobody starts a tick early
        next.state = "live";
        next.deadline = Date.now() + DUEL_COMP_MS;
        for (const pl of seatedPlayers(next)) pl.chips = DUEL_COMP_STACK;
      } else if (allIn) {
        next.state = "live";
        next.deadline = Date.now() + DUEL_MOVE_MS;
      }
      if (await commitDuel(entry, next, credits)) {
        return json({ ok: true, duel: duelView(next, u.id), balance: round2((await getCas(u.id)).bal) });
      }
    }
    return json({ error: "busy" }, 503);
  }

  // ---------- poker: fold, check, call, raise ----------
  //
  // Its own endpoint rather than another move on /duel/move, because a poker
  // decision carries an amount and lands on a turn order that the duel's
  // one-move-each shape has no room for. Everything else about it is the same:
  // the record is re-read, the action is applied to a copy, and the copy is
  // committed against the entry it was read from, so two clicks racing cannot
  // both be taken.
  // ---------- one move ----------
  // Everything a chess client can ask for: a move, a resignation, a draw
  // offered, a draw taken. The move is the interesting one, and the whole of
  // its validation is "is it in the list the engine generated" — there is no
  // second, looser path by which a move can reach the board.
  if (req.method === "POST" && path === "/duel/chess") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    const u = await casUser(b.token);
    if (!u) return json({ error: "unauthorized" }, 401);
    if (!allow("dact:" + u.id, PIT_BURST, PIT_BURST_MS)) return tooMany(10);
    const action = clip(b.action, 8) || "move";
    for (let attempt = 0; attempt < 6; attempt++) {
      const entry = await loadDuel(clip(b.id, 32));
      const d = entry.value;
      if (!d) return json({ error: "gone" }, 404);
      if (d.settled) return json({ error: "over", duel: duelView(d, u.id) }, 409);
      if (d.game !== "chess" || !d.chess) return json({ error: "not a chess table" }, 400);
      if (d.state !== "live") return json({ error: "not now", duel: duelView(d, u.id) }, 409);
      const people = seatedPlayers(d);
      const seat = people.findIndex((pl) => pl.id === u.id);
      if (seat < 0) return json({ error: "not your table" }, 403);
      const cs: ChessState = JSON.parse(JSON.stringify(d.chess)) as ChessState;
      const pos = chessParse(cs.fen);
      if (!pos) return json({ error: "broken board" }, 500);

      let winnerSeat: number | null = null;
      let reason = "";

      if (action === "resign") {
        winnerSeat = 1 - seat;
        reason = "resignation";
        cs.result = seat === cs.white ? "b" : "w";
        cs.reason = reason;
      } else if (action === "draw") {
        // an offer standing from the other side is an agreement, not a second
        // offer — which is why this is one action and not two
        if (cs.draw >= 0 && cs.draw !== seat) {
          cs.result = "d";
          cs.reason = reason = "agreed";
          winnerSeat = null;
        } else {
          cs.draw = seat;
          const next: Duel = { ...d, chess: cs };
          if (await commitDuel(entry, next, [])) {
            return json({ ok: true, duel: duelView(next, u.id), balance: round2((await getCas(u.id)).bal) });
          }
          continue;
        }
      } else if (action === "unoffer") {
        // Both halves of taking an offer off the board: the player who made it
        // withdrawing, and the player it was made to declining. The client only
        // ever sends this as a decline, and gating it on `cs.draw === seat` made
        // that a no-op — the offer stayed standing on both screens until the
        // next move happened to clear it, and "decline" did nothing at all.
        // Either seat may clear it, and a seat is all that reaches here.
        cs.draw = -1;
        const next: Duel = { ...d, chess: cs };
        if (await commitDuel(entry, next, [])) {
          return json({ ok: true, duel: duelView(next, u.id), balance: round2((await getCas(u.id)).bal) });
        }
        continue;
      } else {
        if (chessSeatToAct(cs) !== seat) return json({ error: "not your move", duel: duelView(d, u.id) }, 409);
        const want = chessFromUci(clip(b.move, 6));
        if (!want) return json({ error: "that is not a move" }, 400);
        // the only gate there is: it has to be one the engine generated
        const legal = chessMoves(pos).find((m) =>
          m.from === want.from && m.to === want.to && (m.promo || 0) === (want.promo || 0)
        );
        if (!legal) return json({ error: "illegal move", duel: duelView(d, u.id) }, 400);
        // the clock first: whatever this move took comes off the mover, and the
        // increment goes back on. Reaching zero here is not a move at all —
        // the sweeper below flags them and this branch is never reached.
        // chessLeft() is what this arithmetic is, and it lives in one place so
        // that the countdown, the deadline and the charge can never drift apart
        const now = Date.now();
        cs.clock[seat] = chessLeft(cs, now) + cs.inc;
        cs.since = now;
        cs.san.push(chessSan(pos, legal));
        cs.last = chessUci(legal);
        const after = chessApply(pos, legal);
        cs.fen = chessFen(after);
        // a pawn move or a capture can never be undone, so no position from
        // before one can come back — which is exactly when the repetition
        // window resets, and what keeps this list short
        if (after.half === 0) cs.reps = [];
        cs.reps.push(chessKey(after));
        // an offer does not survive the move it was answered with
        cs.draw = -1;
        const end = chessEnd(after, cs.reps);
        if (end.over) {
          cs.result = end.winner === null ? "d" : end.winner;
          cs.reason = reason = end.reason;
          winnerSeat = end.winner === null ? null : (end.winner === "w" ? cs.white : 1 - cs.white);
        }
      }

      let next: Duel = { ...d, chess: cs, deadline: chessDeadline(cs) };
      let credits: { id: string; amount: number }[] = [];
      if (cs.result) {
        const winner = winnerSeat === null ? null : people[winnerSeat];
        const done = finishDuel(next, winner ? winner.id : null, reason || "play");
        credits = done.credits;
        next = { ...done.next, chess: cs };
      }
      if (await commitDuel(entry, next, credits)) {
        return json({ ok: true, duel: duelView(next, u.id), balance: round2((await getCas(u.id)).bal) });
      }
    }
    return json({ error: "busy" }, 503);
  }

  if (req.method === "POST" && path === "/duel/poker") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    const u = await casUser(b.token);
    if (!u) return json({ error: "unauthorized" }, 401);
    if (!allow("dact:" + u.id, PIT_BURST, PIT_BURST_MS)) return tooMany(10);
    const action = clip(b.action, 8);
    const amount = Number(b.amount);
    for (let attempt = 0; attempt < 6; attempt++) {
      const entry = await loadDuel(clip(b.id, 32));
      const d = entry.value;
      if (!d) return json({ error: "gone" }, 404);
      if (d.settled) return json({ error: "over", duel: duelView(d, u.id) }, 409);
      if (d.game !== "poker" || !d.poker) return json({ error: "not a poker table" }, 400);
      if (d.state !== "live") return json({ error: "not now", duel: duelView(d, u.id) }, 409);
      const people = seatedPlayers(d);
      const seat = people.findIndex((p) => p.id === u.id);
      if (seat < 0) return json({ error: "not your table" }, 403);
      // a copy, so a refused action leaves nothing behind and a lost race can
      // simply be tried again from the record as it now stands
      const ps: PokerState = JSON.parse(JSON.stringify(d.poker)) as PokerState;
      const err = pokerApply(ps, seat, action, amount, people.map((p) => p.name));
      if (err) return json({ error: err, duel: duelView(d, u.id) }, 400);
      let next: Duel = { ...d, poker: ps, deadline: pokerDeadline(ps) };
      let credits: { id: string; amount: number }[] = [];
      // One player holds every chip — but the hand that did it is still on the
      // table, and taking the table down inside the request that called the
      // last bet is what used to swap the board for a result screen before
      // anybody had seen it. The hold is the same one every other hand gets;
      // sweepDuel() is what ends the duel when it is up, and the deadline
      // above is already that moment.
      if (pokerOver(ps) && !(ps.next > Date.now())) {
        // The buy-ins come out of escrow to them, and the chips themselves
        // stop existing with the table.
        const left = pokerAlive(ps);
        const winner = left.length === 1 ? people[left[0]] : null;
        const done = finishDuel(next, winner ? winner.id : null, "play");
        credits = done.credits;
        next = { ...done.next, poker: ps };
      }
      if (await commitDuel(entry, next, credits)) {
        return json({ ok: true, duel: duelView(next, u.id), balance: round2((await getCas(u.id)).bal) });
      }
    }
    return json({ error: "busy" }, 503);
  }

  // ---------- play a hand ----------
  if (req.method === "POST" && path === "/duel/move") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    const u = await casUser(b.token);
    if (!u) return json({ error: "unauthorized" }, 401);
    if (!allow("dact:" + u.id, PIT_BURST, PIT_BURST_MS)) return tooMany(10);
    const move = clip(b.move, 16);
    for (let attempt = 0; attempt < 6; attempt++) {
      const entry = await loadDuel(clip(b.id, 32));
      const d = entry.value;
      if (!d) return json({ error: "gone" }, 404);
      if (d.settled) return json({ error: "over", duel: duelView(d, u.id) }, 409);
      if (d.state !== "live") return json({ error: "not now", duel: duelView(d, u.id) }, 409);
      const cfg = DUEL_GAMES[d.game];
      if (!cfg || cfg.moves.indexOf(move) < 0) return json({ error: "not a move" }, 400);
      const mine = d.host.id === u.id ? "host" : (d.guest && d.guest.id === u.id ? "guest" : null);
      if (!mine) return json({ error: "not your duel" }, 403);
      const me = mine === "host" ? d.host : d.guest!;
      // one pick per round, and it is final. re-sending is not a way to see
      // their answer first and then change yours.
      if (me.move !== null) return json({ error: "already played", duel: duelView(d, u.id) }, 409);
      const next: Duel = {
        ...d, host: { ...d.host }, guest: d.guest ? { ...d.guest } : null, rounds: d.rounds.slice(),
      };
      if (mine === "host") next.host.move = move; else next.guest!.move = move;
      let credits: { id: string; amount: number }[] = [];
      const hm = next.host.move, gm = next.guest!.move;
      if (hm !== null && gm !== null) {
        // both are in, so the round can be read. a tie is not a round: it is
        // wiped and replayed, on a fresh clock.
        const hostTakes = TUNG_BEATS[hm] === gm;
        const guestTakes = TUNG_BEATS[gm] === hm;
        next.rounds.push({
          host: hm, guest: gm,
          won: hostTakes ? next.host.name : (guestTakes ? next.guest!.name : null),
        });
        if (hostTakes) next.host.wins += 1;
        if (guestTakes) next.guest!.wins += 1;
        next.host.move = null;
        next.guest!.move = null;
        if (next.host.wins >= cfg.target || next.guest!.wins >= cfg.target) {
          const winner = next.host.wins >= cfg.target ? next.host.id : next.guest!.id;
          const done = finishDuel(next, winner, "play");
          credits = done.credits;
          Object.assign(next, done.next);
        } else {
          if (hostTakes || guestTakes) next.round += 1;
          next.deadline = Date.now() + DUEL_MOVE_MS;
        }
      }
      if (await commitDuel(entry, next, credits)) {
        return json({ ok: true, duel: duelView(next, u.id), balance: round2((await getCas(u.id)).bal) });
      }
    }
    return json({ error: "busy" }, 503);
  }

  // ---------- watch the clock ----------
  if (req.method === "GET" && path === "/duel/state") {
    const u = await casUser(url.searchParams.get("token"));
    if (!u) return json({ error: "unauthorized" }, 401);
    if (!allow("dst:" + u.id, PIT_BURST, PIT_BURST_MS)) return tooMany(10);
    const entry = await loadDuel(clip(url.searchParams.get("id"), 32));
    const d = entry.value;
    if (!d) return json({ error: "gone" }, 404);
    if (!findSide(d, u.id)) {
      return json({ error: "not your duel" }, 403);
    }
    // ---- the table talk, carried by the poll the table is already making ----
    // It costs no request of its own and cannot lag the table it belongs to.
    // What it must not cost is a READ of its own on every poll: this is the
    // hottest poll in the casino — 1.2 seconds, per player, for as long as a
    // poker game lasts — and a conversation nobody is having is not worth
    // fetching fifty times a minute each.
    //
    // So the caller says how many lines it has, the count of how many have been
    // said rides on the duel record that has just been read anyway, and the
    // conversation itself is only fetched when those two disagree. A table
    // where nobody is talking costs nothing; a line costs each client at the
    // table exactly one read, once.
    //
    // No `talk` parameter at all means a client that has just opened the table
    // and has nothing, so it is read: -1 is behind any count, including none.
    const chat = TALK_AT.has(d.game) && !d.settled;
    const said = Number(d.talkN) || 0;
    const raw = url.searchParams.get("talk");
    const held = raw === null ? -1 : Number(raw);
    const behind = !Number.isFinite(held) || held < said;
    // null is "nothing you have not got" and is not the same answer as [],
    // which is "there is nothing" — a quiet poll must not wipe the box.
    const talk = chat ? (behind ? await readTalk(d.id) : null) : [];
    return json({
      ok: true,
      duel: duelView(d, u.id),
      talk,
      talkN: chat ? said : 0,
      balance: round2((await getCas(u.id)).bal),
    });
  }

  // ---------- say something at the table (Competitive Gambling only) ----------
  // Players in a live round only. It is a room that exists for three minutes:
  // the line is held under the round and deleted by the same commit that ends
  // it, so there is no history to moderate and nothing to read afterwards.
  if (req.method === "POST" && path === "/duel/say") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    const u = await casUser(b.token);
    if (!u) return json({ error: "unauthorized" }, 401);
    // chat-banned members keep the casino and lose the room; a round's table
    // talk is a room, so it answers to the same gate the shrine's chat does
    if (chatBlock(u).blocked) return json({ error: "blocked" }, 403);
    const id = clip(b.id, 32);
    const text = clip(b.text, TALK_LEN);
    if (!id || !text) return json({ error: "empty" }, 400);
    const entry = await loadDuel(id);
    const d = entry.value;
    if (!d) return json({ error: "gone" }, 404);
    if (!findSide(d, u.id)) return json({ error: "not your duel" }, 403);
    if (d.settled || !TALK_AT.has(d.game) || d.state !== "live") {
      return json({ error: "not now" }, 409);
    }
    // A flood cap of its own, and it earns its keep: a line is a KV write, a
    // second write to the duel record, and a read on the next poll of every
    // other client at the table. So one line costs the table a read each,
    // however few are sitting at it. Five in five seconds is faster than
    // anybody types; the hour-long cap behind it is what stops a script
    // keeping a five-handed table fetching forever.
    if (!allow("say:" + u.id, 5, 5000)) return tooMany(5);
    if (!await allowGlobal("say:" + u.id, 120, 60 * 60_000)) return tooMany(600);
    const talk = await sayAtTable(d.id, u.username, text);
    if (!talk) return json({ error: "not now" }, 409);
    return json({ ok: true, talk });
  }

  // ---------- which skins this member may wear ----------
  // Every theme the shrine has, each marked owned or not, and for the locked
  // ones whatever the shop is currently asking. The settings page draws its
  // list straight from this, so a theme that is not on sale reads as locked
  // with nothing to click rather than as a button that quietly does nothing.
  if (req.method === "GET" && path === "/themes") {
    const u = await casUser(url.searchParams.get("token"));
    if (!u) return json({ error: "unauthorized" }, 401);
    // settings, not a poll: it walks the shelves and then every theme there is
    if (!allow("thm:" + u.id, 15, 10_000)) return tooMany(10);
    // what the shop is selling, by theme
    const forSale = new Map<string, { itemId: string; price: number; name: string }>();
    // deno-lint-ignore no-explicit-any
    for await (const e of kv.list<any>({ prefix: ["shopitem"] }, { limit: SHOP_MAX })) {
      const th = String(e.value?.theme || "");
      if (!th || !e.value.active) continue;
      const price = round2(Number(e.value.price));
      const cur = forSale.get(th);
      // if two items grant the same theme, quote the cheaper one
      if (!cur || price < cur.price) forSale.set(th, { itemId: e.value.id, price, name: e.value.name });
    }
    const themes = [];
    for (const t of SHRINE_THEMES) {
      const owned = await ownsTheme(u.id, t.id);
      const sale = forSale.get(t.id) || null;
      themes.push({
        id: t.id, name: t.name, note: t.note, free: !!t.free, owned,
        price: !owned && sale ? sale.price : null,
        itemName: !owned && sale ? sale.name : null,
      });
    }
    return json({ ok: true, themes, balance: round2((await getCas(u.id)).bal) });
  }

  // ---------- admin ----------
  if (req.method === "GET" && path === "/admin") {
    // An old bookmark with ?key= on it: send them to the bare path rather than
    // serving the panel, so the key stops being in the address bar from here on
    // and nothing downstream logs it again. It is spent either way — this only
    // stops it being spent twice.
    if (url.searchParams.has("key")) {
      return new Response(null, { status: 303, headers: { location: "/admin", "cache-control": "no-store" } });
    }
    // The panel is ~37KB and serving it to every scanner that finds /admin was
    // free egress, so the door is all a GET ever gets. The panel itself comes
    // back from the POST below, which is what keeps the key out of the URL.
    return new Response(ADMIN_GATE, {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }
  // ---------- the panel itself ----------
  // A POST purely so the key rides in a body instead of a URL. The reply is a
  // document, not JSON: the gate writes it straight into the page it is on.
  if (req.method === "POST" && path === "/admin") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    if (!ADMIN_KEY || String(b.key ?? "") !== ADMIN_KEY) {
      return new Response("forbidden", { status: 403, headers: { "cache-control": "no-store" } });
    }
    return new Response(ADMIN_HTML, {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }

  if (req.method === "GET" && path === "/admin/pending") {
    if (!adminOk(req, url)) return json({ error: "forbidden" }, 403);
    const pending: unknown[] = [];
    // deno-lint-ignore no-explicit-any
    for await (const e of kv.list<any>({ prefix: ["app"] })) {
      if (e.value.status === "pending") {
        pending.push({ id: e.value.id, username: e.value.username, application: e.value.application, ts: e.value.ts, thread: e.value.thread || [] });
      }
    }
    // deno-lint-ignore no-explicit-any
    pending.sort((a: any, b: any) => a.ts - b.ts);
    return json({ pending });
  }

  // ---------- admin: dump retained chat (not part of the other list loads) ----------
  if (req.method === "GET" && path === "/admin/chat") {
    if (!adminOk(req, url)) return json({ error: "forbidden" }, 403);
    // ?since= is Talk to da people's room view keeping up: only what landed
    // after the cursor it already holds — usually nothing, or a line or two —
    // rather than the whole log again on every pass. Deletions ride along as
    // ids so the lines it is already showing can be marked.
    // any since — 0 included, which is where an empty log leaves a reader —
    // is a catch-up read; no since at all is the whole log
    const sinceQ = url.searchParams.get("since");
    const since = Math.max(0, Number(sinceQ) || 0);
    if (sinceQ !== null) {
      const messages: unknown[] = [], dels: string[] = [];
      let cursor = since;
      // deno-lint-ignore no-explicit-any
      for await (const e of kv.list<any>({ prefix: ["ev"], start: ["ev", since + 1] }, { limit: HISTORY })) {
        const ev = e.value;
        if (!ev) continue;
        if (typeof ev.seq === "number") cursor = Math.max(cursor, ev.seq);
        if (ev.type === "msg") messages.push(chatLine(ev));
        else if (ev.type === "del") {
          for (const d of Array.isArray(ev.ids) ? ev.ids : [ev.id]) if (typeof d === "string") dels.push(d);
        }
      }
      return json({ messages, dels, cursor });
    }
    const { messages, cursor } = await listChatMessages();
    // an empty log still has a counter, so a reader starts from where the
    // next line will land rather than from nothing
    return json({ messages, count: messages.length, cursor: cursor || ((await kv.get<number>(["seq"])).value ?? 0) });
  }

  // ---------- admin: read a conversation ----------
  //
  // Two routes rather than one, because a dump is two questions: who has this
  // member ever talked to, and what did the two of them say. Asking the first
  // is what fills the second dropdown in the panel, so the admin picks from
  // conversations that actually exist rather than guessing at pairs and
  // getting an empty answer back.
  //
  // Both are POSTs, not GETs, purely so that nothing — not the key, not a
  // member id — ever rides in a URL where an access log would keep it. Every
  // write in this panel already works that way; a read of somebody's private
  // messages has at least as good a reason to.
  //
  // This is a read and only a read. It moves no read mark, writes no row and
  // leaves no trace in either member's client: dumping a conversation must not
  // be able to mark it read under the people in it, which is exactly what
  // reusing /dm/with would have done.
  //
  // What it costs is bounded like everything else on these keys: DM_RAIL
  // conversations, DM_DUMP lines.
  if (req.method === "POST" && path === "/admin/dm/peers") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    if (!ADMIN_KEY || b.key !== ADMIN_KEY) return json({ error: "forbidden" }, 403);
    const id = clip(b.id, 32);
    if (!id) return json({ error: "not found" }, 404);
    // deno-lint-ignore no-explicit-any
    const me = await kv.get<any>(["app", id]);
    if (!me.value) return json({ error: "not found" }, 404);
    const peers: { id: string; name: string; last: string; ts: number; seq: number }[] = [];
    for await (const e of kv.list<DmConv>({ prefix: ["dmconv", id] }, { limit: DM_RAIL })) {
      const v = e.value;
      if (!v) continue;
      peers.push({
        id: String(e.key[2]), name: v.name, last: v.last,
        // lines written, deleted ones included (the dump shows them marked);
        // the markers that record a deletion are not lines
        ts: Number(v.ts) || 0, seq: Math.max(0, (Number(v.seq) || 0) - (Number(v.dels) || 0)),
      });
    }
    // The name on the row is whatever the other end was called when the last
    // line was written, so a rename since then would leave the dropdown naming
    // somebody who no longer exists. The account is the truth; the row is a
    // cache of it. An id with no account behind it at all is a deleted
    // member's leftovers — this used to list them as "(gone)" — and the read
    // that noticed is the moment to take the conversation away.
    const goneIds: string[] = [];
    await Promise.all(peers.map(async (pr) => {
      // deno-lint-ignore no-explicit-any
      const a = await kv.get<any>(["app", pr.id]);
      if (a.value && a.value.username) pr.name = a.value.username;
      else if (pr.id !== TUNG_DM_ID) goneIds.push(pr.id);
    }));
    for (const g of goneIds) await purgeConversation(id, g);
    const live = peers.filter((pr) => !goneIds.includes(pr.id));
    live.sort((x, y) => y.ts - x.ts);
    return json({ ok: true, id, name: me.value.username, peers: live });
  }

  if (req.method === "POST" && path === "/admin/dm/thread") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    if (!ADMIN_KEY || b.key !== ADMIN_KEY) return json({ error: "forbidden" }, 403);
    const one = clip(b.user, 32), two = clip(b.peer, 32);
    if (!one || !two) return json({ error: "not found" }, 404);
    if (one === two) return json({ error: "same member" }, 400);
    const [oneApp, twoApp] = await Promise.all([
      // deno-lint-ignore no-explicit-any
      kv.get<any>(["app", one]),
      // deno-lint-ignore no-explicit-any
      kv.get<any>(["app", two]),
    ]);
    // a deleted member's half of a conversation is not something to read back;
    // noticing it is when it goes
    if ((!oneApp.value && one !== TUNG_DM_ID) || (!twoApp.value && two !== TUNG_DM_ID)) {
      await purgeConversation(one, two);
      return json({ error: "gone" }, 404);
    }
    const pair = convOf(one, two);
    // Newest first out of KV, then flipped, so that a conversation longer than
    // the cap gives back its END rather than its beginning. A truncated dump
    // that stops a thousand lines ago is not the half anybody wants.
    const msgs: { seq: number; from: string; text: string; ts: number; deleted?: boolean; deletedAt?: number }[] = [];
    for await (
      const e of kv.list<DmMsg>({ prefix: ["dmev", pair] }, { limit: DM_DUMP, reverse: true })
    ) {
      const v = e.value;
      // a retraction marker is not a line; the line it names is still here,
      // marked deleted, and shows as such
      if (!v || v.del) continue;
      msgs.push({
        seq: v.seq, from: v.from, text: v.text, ts: v.ts,
        ...(v.deleted ? { deleted: true, deletedAt: Number(v.deletedAt) || 0 } : {}),
      });
    }
    msgs.reverse();
    const bl = await dmBlockOf(one, two);
    return json({
      ok: true,
      a: { id: one, name: oneApp.value?.username || one, gone: !oneApp.value },
      b: { id: two, name: twoApp.value?.username || two, gone: !twoApp.value },
      msgs,
      count: msgs.length,
      truncated: msgs.length >= DM_DUMP,
      // who shut it. The members are told this too now — see /dm/with.
      blockedBy: [
        ...(bl.lo ? [one < two ? one : two] : []),
        ...(bl.hi ? [one < two ? two : one] : []),
      ],
    });
  }

  // ---------- admin: talk to da people, as tung ----------
  //
  // The room already speaks as him. This is that voice in a conversation: the
  // line is his, the other end sees from:"tung" and paints his portrait on an
  // ordinary DM line, and a reply comes back through the ordinary /dm/send
  // because he is a side of the pair rather than a flag on somebody else's
  // message. Nothing here touches the room.
  //
  // It is his inbox, so opening a thread marks HIS side read and nobody
  // else's. The dump under Direct messages is a look at two members and must
  // not touch their badges; an unread count here that never cleared would not
  // be one. The member clocks (how many conversations, how many lines an hour)
  // are not applied: those exist so one account cannot mint rails, and this
  // route is the admin key.
  if (req.method === "POST" && path === "/admin/talk/list") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    if (!ADMIN_KEY || b.key !== ADMIN_KEY) return json({ error: "forbidden" }, 403);
    const convs: {
      id: string; name: string; last: string; ts: number; seq: number; unread: number;
      closed: boolean; byYou: boolean; byThem: boolean;
    }[] = [];
    for await (const e of kv.list<DmConv>({ prefix: ["dmconv", TUNG_DM_ID] }, { limit: DM_RAIL })) {
      const v = e.value;
      if (!v) continue;
      convs.push({
        id: String(e.key[2]), name: v.name, last: v.last,
        ts: Number(v.ts) || 0, seq: Number(v.seq) || 0,
        unread: dmUnread(v),
        closed: false, byYou: false, byThem: false,
      });
    }
    // a row whose member no longer exists is a deleted account's leftovers,
    // and this read is the one that noticed: the conversation goes
    const goneIds: string[] = [];
    await Promise.all(convs.map(async (pr) => {
      // deno-lint-ignore no-explicit-any
      const a = await kv.get<any>(["app", pr.id]);
      if (a.value && a.value.username) pr.name = a.value.username;
      else { goneIds.push(pr.id); return; }
      const bl = await dmBlockOf(TUNG_DM_ID, pr.id);
      if (!dmBlocked(bl)) return;
      pr.closed = true;
      // his side, and theirs. the panel never sets his; theirs is the one
      // worth saying out loud, and here it can be said.
      pr.byYou = !!bl[dmSide(TUNG_DM_ID, pr.id)];
      pr.byThem = !!bl[dmSide(pr.id, TUNG_DM_ID)];
      pr.unread = 0;
    }));
    for (const g of goneIds) await purgeConversation(TUNG_DM_ID, g);
    const live = convs.filter((c) => !goneIds.includes(c.id));
    live.sort((x, y) => y.ts - x.ts);
    return json({ ok: true, convs: live });
  }

  if (req.method === "POST" && path === "/admin/talk/thread") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    if (!ADMIN_KEY || b.key !== ADMIN_KEY) return json({ error: "forbidden" }, 403);
    const id = clip(b.user, 32);
    if (!id || id === TUNG_DM_ID) return json({ error: "not found" }, 404);
    // deno-lint-ignore no-explicit-any
    const app = await kv.get<any>(["app", id]);
    const row = await kv.get<DmConv>(["dmconv", TUNG_DM_ID, id]);
    // an approved member can be opened before a single line exists — that is
    // how a conversation starts. anybody else only if the history is already
    // there, so a guessed id does not become a blank thread.
    if (!row.value && !(app.value && app.value.status === "approved")) {
      return json({ error: "not found" }, 404);
    }
    // history with nobody behind it any more: a deleted member's, and it goes
    if (!app.value) {
      await purgeConversation(TUNG_DM_ID, id);
      return json({ error: "gone" }, 404);
    }
    const pair = convOf(TUNG_DM_ID, id);
    const msgs: { seq: number; text: string; ts: number; mine: boolean; from?: "tung"; deleted?: boolean }[] = [];
    let top = 0;
    for await (
      const e of kv.list<DmMsg>({ prefix: ["dmev", pair] }, { limit: DM_DUMP, reverse: true })
    ) {
      const v = e.value;
      if (!v) continue;
      top = Math.max(top, v.seq);
      if (v.del) continue; // the marker of a line taken back, not a line
      msgs.push({
        ...(v.deleted ? { deleted: true } : {}),
        seq: v.seq, text: v.text, ts: v.ts, mine: v.from === TUNG_DM_ID,
        ...(v.from === TUNG_DM_ID ? { from: "tung" as const } : {}),
      });
    }
    msgs.reverse();
    // his side only. the member's badge is theirs to clear by opening it.
    if (top > 0) await dmMarkRead(TUNG_DM_ID, id, top);
    const bl = await dmBlockOf(TUNG_DM_ID, id);
    const blocked = dmBlocked(bl);
    const themBlocked = blocked && !!bl[dmSide(id, TUNG_DM_ID)];
    // deno-lint-ignore no-explicit-any
    const shut = app.value ? chatBlock(app.value) : { blocked: true, reason: "gone" as const };
    const reason = !app.value || app.value.status !== "approved"
      ? "gone"
      : shut.blocked
      ? (shut.reason || "closed")
      : themBlocked
      ? "blocked"
      : blocked
      ? "closed"
      : null;
    return json({
      ok: true,
      user: { id, name: app.value?.username || row.value?.name || id, gone: !app.value },
      msgs,
      count: msgs.length,
      truncated: msgs.length >= DM_DUMP,
      closed: reason !== null,
      reason,
    });
  }

  if (req.method === "POST" && path === "/admin/talk/send") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    if (!ADMIN_KEY || b.key !== ADMIN_KEY) return json({ error: "forbidden" }, 403);
    const text = clip(b.text, 1000);
    if (!text) return json({ error: "empty" }, 400);
    const id = clip(b.user, 32);
    if (!id || id === TUNG_DM_ID) return json({ error: "not found" }, 404);
    // deno-lint-ignore no-explicit-any
    const app = await kv.get<any>(["app", id]);
    if (!app.value || app.value.status !== "approved") return json({ error: "not found" }, 404);
    const shut = chatBlock(app.value);
    // the same rule as /dm/send: a chat ban that still accepted a DM would be
    // a change of venue. he can speak again when the room is open to them.
    if (shut.blocked) return json({ error: "closed", reason: shut.reason }, 403);
    const bl = await dmBlockOf(TUNG_DM_ID, id);
    if (dmBlocked(bl)) {
      return json({ error: bl[dmSide(id, TUNG_DM_ID)] ? "blocked" : "closed" }, 403);
    }
    const msg = await dmAppend(tungVoice(), app.value, text);
    if (!msg) return json({ error: "busy" }, 503);
    return json({
      ok: true,
      msg: { seq: msg.seq, text: msg.text, ts: msg.ts, mine: true, from: "tung" },
    });
  }

  // ---------- admin: wipe the chat log ----------
  // Drops every retained event — messages and the reactions on them alike —
  // and the two indexes hanging off them, which is what a single moderator
  // delete has always done and what this used to leave behind.
  //
  // The log alone was not the message. ["msg", id] is what a message actually
  // said, and a reply quotes by id with the server filling the words in from
  // there: with it left standing, anybody still holding an id could post a
  // fresh line carrying a wiped message's author and text back into the room,
  // word for word, and could still react to something nobody could see. So
  // the quote index goes with the log, and ["rx"] — who has reacted to what —
  // goes with it too rather than being left pointing at messages that no
  // longer exist.
  //
  // The ["seq"] counter deliberately survives: it is what every connected
  // client is holding as its cursor, and winding it back would make the next
  // messages reuse seq numbers those clients have already passed, so they would
  // never see them. Leaving it be means an open chat simply goes quiet until
  // someone speaks again. Accounts, balances, DMs and shop items are untouched.
  if (req.method === "POST" && path === "/admin/clearchat") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    if (!ADMIN_KEY || b.key !== ADMIN_KEY) return json({ error: "forbidden" }, 403);
    let cleared = 0, quotes = 0, reactions = 0;
    for await (const e of kv.list({ prefix: ["ev"] })) {
      await kv.delete(e.key);
      cleared++;
    }
    for await (const e of kv.list({ prefix: ["msg"] })) {
      await kv.delete(e.key);
      quotes++;
    }
    for await (const e of kv.list({ prefix: ["rx"] })) {
      await kv.delete(e.key);
      reactions++;
    }
    return json({ ok: true, cleared, quotes, reactions });
  }

  // ---------- admin: read / flip the web veil ----------
  // `configured` tells the dashboard whether PROXY_URL is set at all, without
  // ever handing the URL itself to the page.
  // ---------- post a message as somebody else ----------
  // A message's author is the account that sent the request, except here and
  // at /admin/talk/send. This one drops a line in the ROOM. That one is only
  // ever tung, and only ever a direct message. Both are key-gated. The name
  // here has to belong to a real approved member (or be tung himself), so this
  // cannot conjure a line from an account that never existed. It is a moderator
  // tool for seeding and for putting words in tung's mouth on purpose — every
  // other room route derives the author from the token and always will.
  if (req.method === "POST" && path === "/admin/postas") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    if (!ADMIN_KEY || b.key !== ADMIN_KEY) return json({ error: "forbidden" }, 403);
    const asName = clip(b.username, 24);
    const text = clip(b.text, 1000);
    if (!asName || !text) return json({ error: "missing" }, 400);
    // tung is not a member and has no record to look up, so he is named here
    const asTung = impersonatesTung(asName);
    let name = WISDOM_NAME;
    if (!asTung) {
      const app = await findApprovedByUsername(asName);
      if (!app) return json({ error: "no such member" }, 404);
      name = app.username;       // use their real casing, not what was typed
    }
    // the quote is resolved the same way an ordinary send resolves it: nobody,
    // admin included, gets to write words into somebody else's mouth twice over
    let reply: { id: string; name: string; text: string } | null = null;
    const replyId = b.replyTo ? clip(b.replyTo, 32) : "";
    if (replyId) {
      const q = await kv.get<MsgRef>(["msg", replyId]);
      if (!q.value) return json({ error: "no such message" }, 404);
      reply = { id: replyId, name: String(q.value.name), text: String(q.value.text).slice(0, 140) };
    }
    const id = rid(8);
    await appendEvent({
      type: "msg", id, name, text, reply,
      from: asTung ? "tung" : null,
    });
    return json({ ok: true, id, username: name, tung: asTung });
  }

  // ---------- admin: tung's giveaways with entries ----------
  // Post one, see them, roll one early, call one off, see who entered. All
  // key-gated POSTs. See the giveaways section near the top for how a roll works.
  if (req.method === "POST" && path.startsWith("/admin/raffle/")) {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    if (!ADMIN_KEY || b.key !== ADMIN_KEY) return json({ error: "forbidden" }, 403);
    const what = path.slice("/admin/raffle/".length);
    await raffleTick();

    if (what === "create") {
      const amount = round2(Number(b.amount));
      const winners = Math.round(Number(b.winners));
      const minutes = Number(b.minutes);
      if (!Number.isFinite(amount) || amount < 1 || amount > 1_000_000) return json({ error: "the prize must be 1 to 1,000,000 sahurs" }, 400);
      if (!Number.isFinite(winners) || winners < 1 || winners > 50) return json({ error: "1 to 50 winners" }, 400);
      if (!Number.isFinite(minutes) || minutes < 1 || minutes > 7 * 24 * 60) return json({ error: "it can run 1 minute to 7 days" }, 400);
      if (amount / winners < 0.01) return json({ error: "too many winners for that prize" }, 400);
      const custom = clip(b.text, 300);
      const text = raffleFill(custom || RAFFLE_LINES[randBelow(RAFFLE_LINES.length)], amount, winners);
      const now = Date.now();
      const id = rid(10), msgId = rid(8);
      const endsAt = now + Math.round(minutes * 60_000);
      const r: Raffle = { id, amount, winners, endsAt, createdAt: now, text, msgId, status: "open" };
      // the record and its place in the queue before the line that advertises it,
      // so the first click cannot arrive before there is something to enter
      await kv.atomic()
        .set(["raffle", id], r, { expireIn: endsAt - now + RAFFLE_TTL })
        .set(["raffleq", endsAt, id], 1, { expireIn: endsAt - now + RAFFLE_TTL })
        .commit();
      await appendEvent({
        type: "msg", id: msgId, name: WISDOM_NAME, text, reply: null, from: "tung",
        raffle: { id, amount, winners, endsAt },
      });
      raffleSoon(endsAt);
      return json({ ok: true, raffle: r });
    }

    if (what === "list") {
      const all: (Raffle & { count: number })[] = [];
      for await (const e of kv.list<Raffle>({ prefix: ["raffle"] }, { limit: 300 })) {
        if (e.value && e.key.length === 2) all.push({ ...e.value, count: 0 });
      }
      all.sort((x, y) => y.createdAt - x.createdAt);
      const out = all.slice(0, 30);
      for (const r of out) {
        const n = (await kv.get<Deno.KvU64>(["rafflen", r.id])).value;
        r.count = n ? Number(n.value) : 0;
      }
      return json({ ok: true, raffles: out, lines: RAFFLE_LINES });
    }

    const id = clip(b.id, 32);
    const re = id ? await kv.get<Raffle>(["raffle", id]) : null;
    if (!re || !re.value) return json({ error: "not found" }, 404);

    if (what === "entries") {
      const names: string[] = [];
      for await (const e of kv.list<{ name: string }>({ prefix: ["raffle_in", id] }, { limit: 1000 })) {
        names.push(String(e.value?.name || ""));
      }
      return json({ ok: true, names });
    }

    if (what === "end") {
      if (re.value.status !== "open" && re.value.status !== "rolling") return json({ error: "it is already over" }, 409);
      return json({ ok: true, raffle: await rollRaffle(id, true) });
    }

    if (what === "cancel") {
      if (re.value.status !== "open") return json({ error: "only an open giveaway can be called off" }, 409);
      const r: Raffle = { ...re.value, status: "cancelled", doneAt: Date.now() };
      const res = await kv.atomic().check(re)
        .set(["raffle", id], r, { expireIn: RAFFLE_TTL })
        .delete(["raffleq", re.value.endsAt, id])
        .commit();
      if (!res.ok) return json({ error: "it changed under you — look again" }, 409);
      await appendEvent({
        type: "msg", id: rid(8), name: WISDOM_NAME, text: "tung closed his palm. the giveaway is off.",
        reply: null, from: "tung", raffleEnd: { id, cancelled: true },
      });
      return json({ ok: true, raffle: r });
    }
    return json({ error: "not found" }, 404);
  }

  if (req.method === "GET" && path === "/admin/veil") {
    if (!adminOk(req, url)) return json({ error: "forbidden" }, 403);
    const f = await kv.get<boolean>(["veil", "live"]);
    return json({ live: f.value === true, configured: PROXY_URL !== "" });
  }
  if (req.method === "POST" && path === "/admin/veil") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    if (!ADMIN_KEY || b.key !== ADMIN_KEY) return json({ error: "forbidden" }, 403);
    const live = b.live === true;
    await kv.set(["veil", "live"], live);
    return json({ ok: true, live, configured: PROXY_URL !== "" });
  }

  // ---------- admin: maintenance mode ----------
  // The panel asks what is true now rather than what this copy last heard, so
  // it reads KV itself instead of trusting the cache.
  if (req.method === "GET" && path === "/admin/maint") {
    if (!adminOk(req, url)) return json({ error: "forbidden" }, 403);
    maintAt = 0;
    return json(await maintState());
  }
  if (req.method === "POST" && path === "/admin/maint") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    if (!ADMIN_KEY || b.key !== ADMIN_KEY) return json({ error: "forbidden" }, 403);
    const on = b.on === true;
    // changing the message while it is on keeps the time it went on; the
    // message is kept when it goes off, so the panel offers it again next time
    const cur = maintClean((await kv.get(["maint"])).value);
    const next: Maint = { on, msg: clip(b.msg, 200), since: on ? (cur.on && cur.since) || Date.now() : 0 };
    await kv.set(["maint"], next);
    maintKnown = next;
    maintAt = Date.now();
    return json({ ok: true, ...next });
  }

  // ---------- admin: send a follow-up message/question to an applicant ----------
  if (req.method === "POST" && path === "/admin/message") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    if (!ADMIN_KEY || b.key !== ADMIN_KEY) return json({ error: "forbidden" }, 403);
    // deno-lint-ignore no-explicit-any
    const app = await kv.get<any>(["app", clip(b.id, 32)]);
    if (!app.value) return json({ error: "not found" }, 404);
    const text = clip(b.text, 1000);
    if (!text) return json({ error: "empty" }, 400);
    // an application that has had its verdict is not open to questions — the
    // line would sit on the record until the next review. /admin/talk/send is
    // how he speaks to a member.
    if (app.value.status !== "pending") return json({ error: "already decided" }, 409);
    // the same ceiling from this end: it is one array and either side can grow it
    const thread = (app.value.thread || [])
      .concat([{ from: "admin", text, ts: Date.now() }])
      .slice(-THREAD_MAX);
    const put = await kv.atomic().check(app).set(["app", app.value.id], { ...app.value, thread }).commit();
    if (!put.ok) return json({ error: "busy" }, 409);
    return json({ ok: true, thread });
  }
  if (req.method === "POST" && path === "/admin/decide") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    if (!ADMIN_KEY || b.key !== ADMIN_KEY) return json({ error: "forbidden" }, 403);
    // deno-lint-ignore no-explicit-any
    const app = await kv.get<any>(["app", clip(b.id, 32)]);
    if (!app.value) return json({ error: "not found" }, 404);
    // "send him to tung" — the third verdict, and the only one that is meant to
    // stick. The account is rejected AND banned, so every route that asks
    // blockState() refuses it, and it is flagged `banished` so the shrine itself
    // renders nothing at all rather than a screen with a message on it.
    //
    // Worth being honest about what this is: the blank page is keyed to the
    // token in their browser, so clearing site data gets them back to an
    // application form like anybody else. What does not come back is the
    // account — that name and that token stay banned.
    if (b.action === "banish") {
      await kv.atomic().set(["app", app.value.id], {
        ...dropThread(app.value),
        status: "rejected",
        banned: true,
        banished: true,
        banishedAt: Date.now(),
      }).delete(["pendq", app.value.id]).commit();
      return json({ ok: true, status: "rejected", banished: true });
    }
    const status = b.action === "approve" ? "approved" : "rejected";
    // approving somebody who was sent to tung is how it is undone, and it has
    // to lift both flags or they would be let in and shown a white page
    const lift = b.action === "approve" ? { banned: false, banished: false } : {};
    await kv.atomic()
      .set(["app", app.value.id], { ...dropThread(app.value), ...lift, status })
      .delete(["pendq", app.value.id])
      .commit();
    return json({ ok: true, status });
  }

  // ---------- admin: send an approved user back to review (pending) ----------
  // flips status to "pending" so they drop back to the application screen where
  // the follow-up thread lives. their token is kept; the thread starts empty —
  // whatever was said before the last verdict belongs to that review, not this
  // one (dropThread above, which every verdict already applies).
  if (req.method === "POST" && path === "/admin/repend") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    if (!ADMIN_KEY || b.key !== ADMIN_KEY) return json({ error: "forbidden" }, 403);
    // deno-lint-ignore no-explicit-any
    const app = await kv.get<any>(["app", clip(b.id, 32)]);
    if (!app.value) return json({ error: "not found" }, 404);
    // back on the pile, so back in its index
    await kv.atomic()
      .set(["app", app.value.id], { ...dropThread(app.value), status: "pending" })
      .set(["pendq", app.value.id], Date.now())
      .commit();
    return json({ ok: true, status: "pending" });
  }

  // ---------- admin: list approved users (with ban/timeout state) ----------
  // powers the "approved users" panel. each row carries banned + timeoutUntil
  // so the admin can see who is currently blocked and until when.
  if (req.method === "GET" && path === "/admin/users") {
    if (!adminOk(req, url)) return json({ error: "forbidden" }, 403);
    const users: unknown[] = [];
    // deno-lint-ignore no-explicit-any
    for await (const e of kv.list<any>({ prefix: ["app"] })) {
      if (e.value.status === "approved") {
        users.push({
          id: e.value.id, username: e.value.username, ts: e.value.ts,
          banned: !!e.value.banned, chatBanned: !!e.value.chatBanned,
          timeoutUntil: e.value.timeoutUntil || 0,
          timeoutWhy: e.value.timeoutWhy || "",
          timeoutKind: e.value.timeoutKind || "",
          note: e.value.note || "", veil: e.value.veil === true,
          mod: e.value.mod === true,
        });
      }
    }
    // deno-lint-ignore no-explicit-any
    users.sort((a: any, b: any) => a.username.toLowerCase().localeCompare(b.username.toLowerCase()));
    return json({ users });
  }

  // ---------- admin: ban / unban a user (permanent block) ----------
  if (req.method === "POST" && path === "/admin/ban") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    if (!ADMIN_KEY || b.key !== ADMIN_KEY) return json({ error: "forbidden" }, 403);
    // deno-lint-ignore no-explicit-any
    const app = await kv.get<any>(["app", clip(b.id, 32)]);
    if (!app.value) return json({ error: "not found" }, 404);
    const banned = b.banned !== false; // default true; pass banned:false to unban
    await kv.set(["app", app.value.id], { ...app.value, banned });
    return json({ ok: true, banned });
  }

  // ---------- admin: what one member owes the bank ----------
  // Writes the debt directly, for putting right what a bug or a bad call left
  // behind. Zero wipes it. There is no interest applied here — this is the
  // ledger being corrected, not a loan being written, so what is set is what
  // is owed. A member with no loan on file gets one whose principal matches,
  // so the counter does not read as owing more than was ever borrowed.
  if (req.method === "POST" && path === "/admin/setdebt") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    if (!ADMIN_KEY || b.key !== ADMIN_KEY) return json({ error: "forbidden" }, 403);
    const id = clip(b.id, 32);
    if (!id) return json({ error: "missing" }, 400);
    // deno-lint-ignore no-explicit-any
    const app = await kv.get<any>(["app", id]);
    if (!app.value) return json({ error: "not found" }, 404);
    const owed = round2(Number(b.owed));
    if (!Number.isFinite(owed) || owed < 0) return json({ error: "a debt is 0 or more" }, 400);
    if (owed > MAX_BET) return json({ error: "that is not a debt, that is a mortgage" }, 400);
    if (owed === 0) {
      await kv.delete(["loan", id]);
      return json({ ok: true, owed: 0 });
    }
    const had = await kv.get<Loan>(["loan", id]);
    const principal = had.value && Number(had.value.principal) > 0
      ? round2(Number(had.value.principal))
      : owed;
    await kv.set(["loan", id], {
      principal, owed, ts: had.value?.ts || Date.now(),
    }, { expireIn: LOAN_TTL });
    return json({ ok: true, owed, principal });
  }

  // ---------- admin: what the bank will lend one member ----------
  // Their own ceiling, in place of the house default. Zero shuts the bank to
  // them entirely; clearing it (pass max:null) puts them back on the default
  // rather than pinning them to whatever it happens to be today.
  if (req.method === "POST" && path === "/admin/loanmax") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    if (!ADMIN_KEY || b.key !== ADMIN_KEY) return json({ error: "forbidden" }, 403);
    const id = clip(b.id, 32);
    if (!id) return json({ error: "missing" }, 400);
    // deno-lint-ignore no-explicit-any
    const app = await kv.get<any>(["app", id]);
    if (!app.value) return json({ error: "not found" }, 404);
    if (b.max === null || b.max === "") {
      await kv.delete(["loanmax", id]);
      return json({ ok: true, loanMax: LOAN_MAX_DEFAULT, loanMaxSet: false });
    }
    const max = round2(Number(b.max));
    if (!Number.isFinite(max) || max < 0) return json({ error: "a cap is 0 or more" }, 400);
    if (max > MAX_BET) return json({ error: "that is not a loan, that is a gift" }, 400);
    await kv.set(["loanmax", id], max, { expireIn: LOAN_TTL });
    return json({ ok: true, loanMax: max, loanMaxSet: true });
  }

  // ---------- admin: a one-off raise on what the bank will lend one member ----------
  // The other half of /admin/loanmax, and deliberately not the same thing. That
  // one moves their standing cap and stays moved. This sits on top of whatever
  // the cap is and is spent by the next loan they take, whatever its size — so
  // "go on, just this once" does not quietly become their new ceiling. Passing
  // 0 (or null) takes an unspent one back.
  if (req.method === "POST" && path === "/admin/loanboost") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    if (!ADMIN_KEY || b.key !== ADMIN_KEY) return json({ error: "forbidden" }, 403);
    const id = clip(b.id, 32);
    if (!id) return json({ error: "missing" }, 400);
    // deno-lint-ignore no-explicit-any
    const app = await kv.get<any>(["app", id]);
    if (!app.value) return json({ error: "not found" }, 404);
    if (b.extra === null || b.extra === "" || Number(b.extra) === 0) {
      await kv.delete(["loanboost", id]);
      return json({ ok: true, boost: 0, limit: await loanCap(id) });
    }
    const extra = round2(Number(b.extra));
    if (!Number.isFinite(extra) || extra < 0) return json({ error: "a one-off is 0 or more" }, 400);
    const cap = await loanCap(id);
    if (round2(cap + extra) > MAX_BET) return json({ error: "that is not a loan, that is a gift" }, 400);
    await kv.set(["loanboost", id], extra, { expireIn: LOAN_TTL });
    return json({ ok: true, boost: extra, limit: round2(cap + extra) });
  }

  // ---------- admin: chat ban / un-ban a user (the chat, and only the chat) ----------
  // The narrow ban. `banned` shuts the whole shrine; this shuts the room and
  // nothing else — they cannot read a line and cannot post one, while the
  // casino, the pit, the catalog, the shop and the veil stay exactly as they
  // were. The two flags are independent: setting one never touches the other,
  // and lifting one never lifts the other.
  if (req.method === "POST" && path === "/admin/chatban") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    if (!ADMIN_KEY || b.key !== ADMIN_KEY) return json({ error: "forbidden" }, 403);
    const chatBanned = b.chatBanned !== false; // default true; pass chatBanned:false to lift it
    const next = await patchApp(clip(b.id, 32), { chatBanned });
    if (next === "missing") return json({ error: "not found" }, 404);
    if (next === "busy") return json({ error: "busy" }, 503);
    return json({ ok: true, chatBanned });
  }

  // ---------- admin: grant / revoke chat moderator powers ----------
  // A moderator can delete any chat message and nothing else. Deliberately
  // invisible: there is no badge, no mark and no field on any event that would
  // let the room tell a moderator from anyone else. See POST /delete.
  if (req.method === "POST" && path === "/admin/mod") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    if (!ADMIN_KEY || b.key !== ADMIN_KEY) return json({ error: "forbidden" }, 403);
    const mod = b.mod !== false; // default true; pass mod:false to take it away
    const next = await patchApp(clip(b.id, 32), { mod });
    if (next === "missing") return json({ error: "not found" }, 404);
    if (next === "busy") return json({ error: "busy" }, 503);
    return json({ ok: true, mod });
  }

  // ---------- admin: delete a user entirely ----------
  // removes the application record, frees the username, revokes every token
  // pointing at it, and wipes their casino balance / in-progress hands so they
  // cannot linger on the admin balances pane as "(deleted)". Then everything
  // they said goes too: both sides of every DM they were in, their lines and
  // reactions in the room, and quotes of them in other people's replies.
  if (req.method === "POST" && path === "/admin/delete") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    if (!ADMIN_KEY || b.key !== ADMIN_KEY) return json({ error: "forbidden" }, 403);
    const id = clip(b.id, 32);
    // deno-lint-ignore no-explicit-any
    const app = await kv.get<any>(["app", id]);
    if (!app.value) return json({ error: "not found" }, 404);
    const lower = String(app.value.username).toLowerCase();
    const atomic = kv.atomic()
      .delete(["app", id])
      .delete(["pendq", id])
      .delete(["name", lower])
      .delete(["cas", id])
      .delete(["loan", id])
      .delete(["loanmax", id])
      .delete(["loanboost", id])
      .delete(["bj", id])
      .delete(["mines", id])
      .delete(["beef", id]);
    for await (const e of kv.list<string>({ prefix: ["tok"] })) {
      if (e.value === id) atomic.delete(e.key);
    }
    await atomic.commit();
    // after the account, so nothing can be written back under it in between;
    // the name is theirs alone until this very commit freed it
    const dead = new Set([id]);
    const conversations = await purgeDmsOf(dead);
    const lines = await purgeRoomOf(dead, new Set([lower]));
    // and what the sahur watch kept on them
    const watchKeys: Deno.KvKey[] = [["claimpen", id], ["watch", "flag", id]];
    for await (const e of kv.list({ prefix: ["claimlog", id] })) watchKeys.push(e.key);
    await kvDeleteAll(watchKeys);
    return json({ ok: true, deleted: true, conversations, lines });
  }

  // ---------- admin: the sahur watch ----------
  // Settings, the review queue, one member's claims, and what to do about them.
  // All admin-key, all POST so the key and the member id stay out of URLs.
  if (req.method === "POST" && path.startsWith("/admin/watch/")) {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    if (!ADMIN_KEY || b.key !== ADMIN_KEY) return json({ error: "forbidden" }, 403);
    const now = Date.now();
    const what = path.slice("/admin/watch/".length);

    if (what === "config") {
      if (b.config) {
        const cfg = watchClean(b.config);
        await kv.set(["watch", "config"], cfg);
        watchCache = { cfg, at: now };
        return json({ ok: true, config: cfg, names: WATCH_NAMES, defaults: WATCH_DEFAULTS });
      }
      return json({ ok: true, config: await watchConfig(), names: WATCH_NAMES, defaults: WATCH_DEFAULTS });
    }

    if (what === "flags") {
      const open: WatchFlag[] = [], closed: WatchFlag[] = [];
      for await (const e of kv.list<WatchFlag>({ prefix: ["watch", "flag"] })) {
        if (!e.value) continue;
        (e.value.status === "open" ? open : closed).push(e.value);
      }
      open.sort((x, y) => y.lastAt - x.lastAt);
      closed.sort((x, y) => (Number(y.closedAt) || 0) - (Number(x.closedAt) || 0));
      return json({ ok: true, open, closed: closed.slice(0, 40), names: WATCH_NAMES });
    }

    if (what === "scan") {
      // Everyone, against the settings as they are now — for after changing them.
      const cfg = await watchConfig();
      let looked = 0, flagged = 0;
      // deno-lint-ignore no-explicit-any
      for await (const e of kv.list<any>({ prefix: ["app"] })) {
        const a = e.value;
        if (!a || a.status !== "approved") continue;
        looked++;
        if (await watchJudge({ id: a.id, username: a.username }, cfg)) flagged++;
      }
      return json({ ok: true, looked, flagged });
    }

    const id = clip(b.id, 32);
    // deno-lint-ignore no-explicit-any
    const app = id ? await kv.get<any>(["app", id]) : null;
    if (!app || !app.value) return json({ error: "not found" }, 404);
    const name = String(app.value.username);

    if (what === "user") {
      const cfg = await watchConfig();
      const logs = await claimLogs(id, 600);
      const nets: { net: string; claims: number; others: string[]; more: number }[] = [];
      const seen = new Map<string, number>();
      for (const l of logs) if (l.net) seen.set(l.net, (seen.get(l.net) || 0) + 1);
      for (const [net, claims] of [...seen.entries()].slice(0, 10)) {
        const ids = (await sharedOn(net, cfg.keepDays * 24, now)).filter((x) => x !== id);
        // the most recent twenty by name, and how many more there were
        const others: string[] = [];
        for (const oid of ids.slice(0, 20)) {
          // deno-lint-ignore no-explicit-any
          const o = await kv.get<any>(["app", oid]);
          others.push(o.value?.username || oid + " (gone)");
        }
        nets.push({ net, claims, others, more: Math.max(0, ids.length - 20) });
      }
      const lastNet = logs.length ? logs[logs.length - 1].net : undefined;
      const shared = cfg.rules.sharednet.on ? (await sharedOn(lastNet, cfg.rules.sharednet.hours, now)).length : 0;
      const pen = await claimPenalty(id);
      const flag = (await kv.get<WatchFlag>(["watch", "flag", id])).value;
      return json({
        ok: true, id, name, logs, nets, penalty: pen, now: penaltyNow(pen, now),
        flag, hits: watchEval(cfg, logs, now, shared), names: WATCH_NAMES,
        faucet: { amount: FAUCET_AMOUNT, interval: FAUCET_INTERVAL },
        balance: round2((await getCas(id)).bal),
      });
    }

    if (what === "punish") {
      const cfg = await watchConfig();
      const cur = (await claimPenalty(id)) || { at: now };
      const p: ClaimPenalty = { ...cur, at: now };
      const done: string[] = [];
      if (b.ban) {
        const h = watchNum(b.ban.hours, 0.1, 24 * 365, 24);
        p.banUntil = now + h * 3600_000;
        p.banGifts = b.ban.gifts !== false;
        done.push("barred from claiming for " + h + "h" + (p.banGifts ? " (giveaways too)" : ""));
      }
      if (b.reduce) {
        const pct = watchNum(b.reduce.pct, 0, 99, 50), d = watchNum(b.reduce.days, 0.1, 365, 7);
        p.reducePct = pct; p.reduceUntil = now + d * 86_400_000;
        done.push("claims paid at " + pct + "% for " + many(d, "day"));
      }
      if (b.slow) {
        const x = watchNum(b.slow.x, 1.1, 50, 2), d = watchNum(b.slow.days, 0.1, 365, 7);
        p.slowX = x; p.slowUntil = now + d * 86_400_000;
        done.push("cooldown ×" + x + " for " + many(d, "day"));
      }
      if (b.note) p.note = clip(b.note, 300);
      const until = Math.max(Number(p.banUntil) || 0, Number(p.reduceUntil) || 0, Number(p.slowUntil) || 0);
      if (until > now) await kv.set(["claimpen", id], p, { expireIn: until - now + 86_400_000 });
      let taken = 0;
      if (b.takeBack) {
        // what the watch saw them claim in the window, back out of the balance —
        // never below nothing
        const d = watchNum(b.takeBack.days, 0.1, cfg.keepDays, 7);
        const owed = round2((await claimLogs(id, 600))
          .filter((l) => l.ts > now - d * 86_400_000).reduce((a, l) => a + (Number(l.amt) || 0), 0));
        for (let i = 0; i < 8 && owed > 0; i++) {
          const ce = await kv.get<{ bal: number; lastClaim: number }>(["cas", id]);
          const rec = ce.value ?? { bal: 0, lastClaim: 0 };
          const bal = Number.isFinite(rec.bal) ? rec.bal : 0;
          taken = round2(Math.min(bal, owed));
          const res = await kv.atomic().check(ce)
            .set(["cas", id], { ...rec, bal: round2(bal - taken) }, { expireIn: CAS_TTL }).commit();
          if (res.ok) break;
          taken = 0;
        }
        done.push("took back " + taken + " of " + owed + " claimed in the last " + many(d, "day"));
      }
      if (b.timeoutHours) done.push("timed out for " + watchNum(b.timeoutHours, 0, 24 * 365, 0) + "h");
      if (b.warned) done.push("warned as tung");
      // the review closes on the verdict, and what they did before it is spent
      const fE = await kv.get<WatchFlag>(["watch", "flag", id]);
      const verdict = done.length ? done.join("; ") : "reviewed";
      await kv.set(["watch", "flag", id], {
        ...(fE.value || { uid: id, name, at: now, lastAt: now, hits: [] }),
        name, status: "closed", closedAt: now, verdict,
      } as WatchFlag);
      return json({ ok: true, penalty: until > now ? p : null, taken, verdict });
    }

    if (what === "dismiss") {
      const cfg = await watchConfig();
      const q = watchNum(b.quietDays, 0, 90, cfg.quietDays);
      const fE = await kv.get<WatchFlag>(["watch", "flag", id]);
      await kv.set(["watch", "flag", id], {
        ...(fE.value || { uid: id, name, at: now, lastAt: now, hits: [] }),
        name, status: "closed", closedAt: now, verdict: "dismissed — not a bot", quietUntil: now + q * 86_400_000,
      } as WatchFlag);
      return json({ ok: true, quietDays: q });
    }

    if (what === "lift") {
      await kv.delete(["claimpen", id]);
      return json({ ok: true });
    }
    return json({ error: "not found" }, 404);
  }

  // ---------- admin: sahur transfers between members ----------
  // Newest first, a page at a time: everybody's, or — given a member — only the
  // ones they sent or received, with what they sent and received in the page.
  if (req.method === "POST" && path === "/admin/tips") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    if (!ADMIN_KEY || b.key !== ADMIN_KEY) return json({ error: "forbidden" }, 403);
    const limit = Math.round(watchNum(b.limit, 1, 500, 100));
    const cursor = typeof b.cursor === "string" && b.cursor ? b.cursor : undefined;
    const user = clip(b.user, 32);
    const it = kv.list<TipLog>({ prefix: user ? ["tiplogu", user] : ["tiplog"] }, { limit, reverse: true, cursor });
    const tips: TipLog[] = [];
    for await (const e of it) if (e.value) tips.push(e.value);
    let sent = 0, got = 0, nSent = 0, nGot = 0;
    if (user) {
      for (const t of tips) {
        if (t.fromId === user) { sent += t.amount; nSent++; }
        if (t.toId === user) { got += t.amount; nGot++; }
      }
    }
    return json({
      ok: true, tips, cursor: tips.length < limit ? "" : it.cursor,
      ...(user ? { sent: round2(sent), got: round2(got), nSent, nGot } : {}),
    });
  }

  // ---------- admin: export the whole database ----------
  // Every entry, a page at a time, for moving the shrine to another host. It
  // needs the admin key and nothing else — no Deno login, no database id, no
  // access token. (The KV can also be opened from outside over KV Connect, but
  // that takes a token from the organization that owns it.) Key-gated like
  // everything here, and it is the lot: login keys included, so the file it
  // makes is as private as the admin key. scripts/kv-export.ts pages through
  // this into a file; scripts/kv-import.ts writes that file into any other
  // Deno KV.
  if (req.method === "POST" && path === "/admin/export") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    if (!ADMIN_KEY || b.key !== ADMIN_KEY) return json({ error: "forbidden" }, 403);
    const limit = Math.round(watchNum(b.limit, 1, 500, 400));
    const cursor = typeof b.cursor === "string" && b.cursor ? b.cursor : undefined;
    const it = kv.list({ prefix: [] }, { limit, cursor });
    const entries: { k: unknown; v: unknown }[] = [];
    for await (const e of it) entries.push({ k: kvEnc(e.key), v: kvEnc(e.value) });
    // a short page is the last one
    return json({ ok: true, entries, cursor: entries.length < limit ? "" : it.cursor });
  }

  // ---------- admin: clear what deleted accounts left behind ----------
  // For accounts deleted before deleting took their words with it — the
  // "(gone)" rows. One pass over the rails, the reaction rows and the quote
  // index, run when the panel asks and not otherwise.
  if (req.method === "POST" && path === "/admin/purgegone") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    if (!ADMIN_KEY || b.key !== ADMIN_KEY) return json({ error: "forbidden" }, 403);
    return json({ ok: true, ...(await purgeGone()) });
  }

  // ---------- admin: read back a member's login key ----------
  //
  // The key IS the account — casUser() asks nothing else — so this hands over
  // the ability to be that person, and it is worth being plain about that
  // rather than dressing it up as a lookup. It exists because the key is the
  // one thing a member cannot be sent again: it is shown once on the pending
  // screen, and somebody who loses it has no account left, only a username
  // nobody can free. This is the way back in.
  //
  // So it is deliberately not part of /admin/users. That list is polled, and a
  // poll that carries every key in the shrine puts all of them in the panel's
  // memory, and in whatever a browser does with a response, every few seconds
  // — for a field that is read perhaps twice a year. Here it travels only when
  // an admin asks for one person, by POST, so the id stays out of the URL for
  // the same reason the admin key does: a query string lands in the address
  // bar, in history and in every access log on the way.
  //
  // An account can hold more than one key — /apply mints one per application
  // and nothing sweeps the old ones — so this answers with all of them, newest
  // first is not knowable, so they come back in scan order and the panel says
  // how many there are rather than pretending there is one.
  if (req.method === "POST" && path === "/admin/token") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    if (!ADMIN_KEY || b.key !== ADMIN_KEY) return json({ error: "forbidden" }, 403);
    const id = clip(b.id, 32);
    // deno-lint-ignore no-explicit-any
    const app = await kv.get<any>(["app", id]);
    if (!app.value) return json({ error: "not found" }, 404);
    const tokens: string[] = [];
    for await (const e of kv.list<string>({ prefix: ["tok"] })) {
      if (e.value === id && typeof e.key[1] === "string") tokens.push(e.key[1] as string);
    }
    return json({ ok: true, username: app.value.username, tokens });
  }

  // ---------- admin: attach a private note to a user ----------
  if (req.method === "POST" && path === "/admin/note") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    if (!ADMIN_KEY || b.key !== ADMIN_KEY) return json({ error: "forbidden" }, 403);
    // deno-lint-ignore no-explicit-any
    const app = await kv.get<any>(["app", clip(b.id, 32)]);
    if (!app.value) return json({ error: "not found" }, 404);
    const note = clip(b.note, 500); // admin-only; never sent to the user
    await kv.set(["app", app.value.id], { ...app.value, note });
    return json({ ok: true, note });
  }

  // ---------- admin: let one user through the web veil ----------
  // Off by default and independent of the global switch: both have to be on
  // before anyone reaches the destination.
  if (req.method === "POST" && path === "/admin/veiluser") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    if (!ADMIN_KEY || b.key !== ADMIN_KEY) return json({ error: "forbidden" }, 403);
    // deno-lint-ignore no-explicit-any
    const app = await kv.get<any>(["app", clip(b.id, 32)]);
    if (!app.value) return json({ error: "not found" }, 404);
    const veil = b.allowed === true;
    await kv.set(["app", app.value.id], { ...app.value, veil });
    return json({ ok: true, veil });
  }

  // ---------- admin: time a user out until a timestamp (ms epoch) ----------
  if (req.method === "POST" && path === "/admin/timeout") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    if (!ADMIN_KEY || b.key !== ADMIN_KEY) return json({ error: "forbidden" }, 403);
    // deno-lint-ignore no-explicit-any
    const app = await kv.get<any>(["app", clip(b.id, 32)]);
    if (!app.value) return json({ error: "not found" }, 404);
    const until = Number(b.until) > 0 ? Math.floor(Number(b.until)) : 0; // 0 clears the timeout
    // the reason they will read on the lockout, and whether it was the sahur
    // watch's catch; clearing the timeout clears both
    const why = until ? clip(b.why, 200) : "";
    const kind = until && b.kind === "sahur" ? "sahur" : "";
    // deno-lint-ignore no-unused-vars
    const { timeoutWhy, timeoutKind, ...rest } = app.value;
    await kv.set(["app", app.value.id], {
      ...rest, timeoutUntil: until, ...(why ? { timeoutWhy: why } : {}), ...(kind ? { timeoutKind: kind } : {}),
    });
    return json({ ok: true, timeoutUntil: until, why, kind });
  }

  // ---------- admin: rename an existing user ----------
  // moves the ["name", lowercase] reservation to the new spelling (guarding
  // against collisions) and updates the display name on the ["app", id] record.
  if (req.method === "POST" && path === "/admin/rename") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    if (!ADMIN_KEY || b.key !== ADMIN_KEY) return json({ error: "forbidden" }, 403);
    const id = clip(b.id, 32);
    const username = clip(b.username, 24);
    if (!id || !username) return json({ error: "missing" }, 400);
    if (impersonatesTung(username)) return json({ error: "that name is his. pick another." }, 409);
    // deno-lint-ignore no-explicit-any
    const app = await kv.get<any>(["app", id]);
    if (!app.value) return json({ error: "not found" }, 404);
    const oldLower = String(app.value.username).toLowerCase();
    const newLower = username.toLowerCase();
    if (newLower === oldLower) {
      // same name (maybe just casing): update the display value, leave the reservation
      await kv.set(["app", id], { ...app.value, username });
      return json({ ok: true, username });
    }
    const taken = await kv.get<string>(["name", newLower]);
    if (taken.value) {
      if (taken.value === id) { await kv.set(["app", id], { ...app.value, username }); return json({ ok: true, username }); }
      return json({ error: "username taken" }, 409);
    }
    const res = await kv.atomic()
      .check({ key: ["name", newLower], versionstamp: null })
      .delete(["name", oldLower])
      .set(["name", newLower], id)
      .set(["app", id], { ...app.value, username })
      .commit();
    if (!res.ok) return json({ error: "username taken" }, 409);
    return json({ ok: true, username });
  }

  if (req.method === "POST" && path === "/admin/clear") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    if (!ADMIN_KEY || b.key !== ADMIN_KEY) return json({ error: "forbidden" }, 403);
    let n = 0;
    for (const prefix of [["app"], ["name"], ["tok"]]) {
      for await (const e of kv.list({ prefix })) {
        await kv.delete(e.key);
        n++;
      }
    }
    // the pile is gone, so the number of it goes too — it would correct itself
    // on the next application either way, but not saying so would be untidy.
    // Its index is bookkeeping, not entries anybody made, so it is not counted.
    await kv.delete(["pendn"]);
    for await (const e of kv.list({ prefix: ["pendq"] })) await kv.delete(e.key);
    // nobody is left to review or punish, so the sahur watch's notes on them
    // go too; its settings stay
    for (const prefix of [["claimlog"], ["claimnet"], ["claimpen"], ["watch", "flag"]]) {
      for await (const e of kv.list({ prefix })) await kv.delete(e.key);
    }
    // every account is gone now, and what they wrote goes with them
    const left = await purgeGone();
    return json({ ok: true, cleared: n, conversations: left.conversations, lines: left.lines });
  }

  // ======================= TUNG'S CASINO (fun money) =======================

  // ---------- my balance + faucet clock ----------
  if (req.method === "GET" && path === "/cas/me") {
    const u = await casUser(url.searchParams.get("token"));
    if (!u) return json({ error: "unauthorized" }, 401);
    // ask about the round FIRST: it may be overdue, and settling it pays a pot
    // that the balance below has to already know about
    const round = await liveComp(u.id);
    const c = await getCas(u.id);
    // the faucet as it stands for THIS member, penalties included, so the page
    // shows the amount and the clock that /cas/claim will actually use
    const pen = penaltyNow(await claimPenalty(u.id));
    const interval = FAUCET_INTERVAL * pen.slowX;
    const next = c.lastClaim + interval;
    return json({
      username: u.username, balance: round2(c.bal),
      canClaim: !pen.banned && Date.now() >= next, nextClaim: c.lastClaim ? next : 0,
      faucetAmount: round2(FAUCET_AMOUNT * pen.reducePct / 100), faucetInterval: interval,
      ...(pen.banned ? { claimBan: pen.banUntil } : {}),
      ...(pen.reducePct < 100 ? { reduced: { pct: pen.reducePct, until: pen.reduceUntil } } : {}),
      ...(pen.slowX > 1 ? { slowed: { x: pen.slowX, until: pen.slowUntil } } : {}),
      round: round ? duelView(round, u.id) : null,
    });
  }

  // ---------- Shrine of Sahur: claim the free faucet ----------
  if (req.method === "POST" && path === "/cas/claim") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    const u = await casUser(b.token);
    if (!u) return json({ error: "unauthorized" }, 401);
    // a person presses this once every two hours; a script asking again and
    // again for the cooldown to end is exactly what this caps
    if (!allow("claim:" + u.id, 6, 10_000)) return tooMany(10);
    // a penalty from the sahur watch: barred outright, paid less, or made to
    // wait longer — see the watch section above /cas/me
    const pen = penaltyNow(await claimPenalty(u.id));
    if (pen.banned) return json({ error: "claim_banned", until: pen.banUntil }, 403);
    const interval = FAUCET_INTERVAL * pen.slowX;
    const amount = round2(FAUCET_AMOUNT * pen.reducePct / 100);
    // guard the faucet clock atomically so a double-click can't double-claim
    for (;;) {
      const cur = await kv.get<{ bal: number; lastClaim: number }>(["cas", u.id]);
      const rec = cur.value ?? { bal: 0, lastClaim: 0 };
      const now = Date.now();
      const next = rec.lastClaim + interval;
      if (rec.lastClaim && now < next) return json({ error: "cooldown", nextClaim: next }, 429);
      // The bank takes its half off the top while a debt stands — but only ever
      // as much as is still owed, so the last claim of a loan hands back the
      // remainder instead of overpaying it. Read and written in the SAME commit
      // as the balance and the clock: a claim can never pay the player without
      // also paying the debt down, or the other way about.
      const loanE = await kv.get<Loan>(["loan", u.id]);
      const owed = loanE.value && Number(loanE.value.owed) > 0 ? round2(Number(loanE.value.owed)) : 0;
      const take = owed > 0 ? Math.min(round2(amount * LOAN_GARNISH), owed) : 0;
      const gain = round2(amount - take);
      const left = round2(owed - take);
      const nb = round2(rec.bal + gain);
      let op = kv.atomic().check(cur).check(loanE)
        .set(["cas", u.id], { bal: nb, lastClaim: now }, { expireIn: CAS_TTL });
      if (take > 0) {
        op = left > 0
          ? op.set(["loan", u.id], { ...loanE.value!, owed: left }, { expireIn: LOAN_TTL })
          : op.delete(["loan", u.id]);
      }
      const res = await op.commit();
      if (res.ok) {
        await watchClaim(u, {
          ts: now, kind: "faucet", amt: gain,
          // how long it sat claimable before this; the first claim ever has no clock
          ...(rec.lastClaim ? { lag: now - next } : {}),
          cli: cleanCli(b.cli),
        }, ip);
        return json({
          ok: true, balance: nb, claimed: gain, faucet: amount,
          garnished: take, owed: left > 0 ? left : 0, cleared: take > 0 && left <= 0,
          nextClaim: now + interval,
        });
      }
    }
  }

  // ---------- pick a game back up ----------
  // The three slow tables — mines, beef and blackjack — outlive the request
  // that dealt them: the stake is taken on the deal and the board is held in KV
  // for GAME_TTL. Nothing ever read one back, so closing the tab or wandering
  // off to another screen lost the board and the stake with it. It was never
  // actually gone; there was simply no way to ask for it.
  //
  // This is that way. It tells the client the SAME thing the game's own replies
  // tell it mid-play, through the same shaping, so a resumed board can never
  // show more than a played one: never the mine layout, never which lane the
  // cow dies in, never the dealer's hole card.
  if (req.method === "GET" && path === "/cas/resume") {
    const u = await casUser(url.searchParams.get("token"));
    if (!u) return json({ error: "unauthorized" }, 401);

    // deno-lint-ignore no-explicit-any
    const mines = await kv.get<any>(["mines", u.id]);
    if (mines.value) {
      const st = mines.value;
      const safe = (st.revealed || []).length;
      const purse = await purseOfStake(u.id, st.w);
      return json({
        ok: true, game: "mines", state: "playing",
        bet: st.bet, mines: st.count, revealed: st.revealed || [],
        multiplier: safe ? minesMult(st.count, safe) : 1,
        nextMultiplier: minesMult(st.count, safe + 1),
        ...purseJson(purse),
      });
    }

    // deno-lint-ignore no-explicit-any
    const beef = await kv.get<any>(["beef", u.id]);
    if (beef.value) {
      const st = beef.value;
      const purse = await purseOfStake(u.id, st.w);
      // the record keeps the odds, not the word for them; the picker wants the
      // word, so it is read back off the table the odds came from
      const diff = Object.keys(BEEF).find((k) => BEEF[k].q === st.q) || "";
      return json({
        ok: true, game: "beef", state: "playing", difficulty: diff,
        bet: st.bet, lanes: st.lanes, step: st.step,
        multiplier: st.step ? beefMult(st.q, st.step) : 1,
        nextMultiplier: beefMult(st.q, st.step + 1),
        ladder: beefLadder(st.q, st.lanes),
        ...purseJson(purse),
      });
    }

    // deno-lint-ignore no-explicit-any
    const bj = await kv.get<any>(["bj", u.id]);
    if (bj.value) {
      const purse = await purseOfStake(u.id, bj.value.w);
      // the hand's own reply shaping, which is what keeps the hole card down
      const out = await bjRespond(u.id, bj.value, false, purse);
      const body = await out.json();
      return json({ ...body, game: "bj" });
    }

    return json({ ok: true, game: null });
  }

  // ---------- the bank: what it will lend you, and what you still owe ----------
  if (req.method === "GET" && path === "/bank") {
    const u = await casUser(url.searchParams.get("token"));
    if (!u) return json({ error: "unauthorized" }, 401);
    const [loan, room, c] = await Promise.all([loanOf(u.id), loanRoom(u.id), getCas(u.id)]);
    return json({
      ok: true, balance: round2(c.bal),
      owed: loan.owed, principal: loan.principal,
      // `cap` is the standing one, `boost` the one-off sitting on top of it,
      // `limit` what the two come to. The client paints all three so a one-off
      // reads as a one-off rather than as a cap that mysteriously shrinks after
      // the next loan.
      cap: room.cap, boost: room.boost, limit: room.limit,
      interest: LOAN_INTEREST, garnish: LOAN_GARNISH, faucet: FAUCET_AMOUNT,
      // The sum the bank would hand over right now, if you asked for the lot.
      // In debt that is normally nothing — but a one-off suspends the settle-up
      // rule, and then it is whatever is left under the ceiling.
      canBorrow: loan.owed > 0
        ? (room.boost > 0 ? Math.max(0, round2(room.limit - loan.principal)) : 0)
        : room.limit,
    });
  }

  // ---------- borrow ----------
  // One debt at a time, nothing over the cap, and the interest is added once,
  // here, so what you owe never moves again except downward.
  if (req.method === "POST" && path === "/bank/borrow") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    const u = await casUser(b.token);
    if (!u) return json({ error: "unauthorized" }, 401);
    if (!allow("bank:" + u.id, 10, 60_000)) return tooMany(30);
    const room = await loanRoom(u.id);
    if (!(room.limit > 0)) return json({ error: "the bank will not lend to you." }, 403);
    const want = round2(Number(b.amount));
    if (!Number.isFinite(want) || want <= 0) return json({ error: "name a real number." }, 400);
    if (want > room.limit) {
      return json({ error: "the bank tops you out at " + room.limit + " sahurs.", cap: room.limit }, 400);
    }
    for (let attempt = 0; attempt < 8; attempt++) {
      const loanE = await kv.get<Loan>(["loan", u.id]);
      const held = loanE.value && Number(loanE.value.owed) > 0
        ? {
          principal: round2(Number(loanE.value.principal) || 0),
          owed: round2(Number(loanE.value.owed)),
        }
        : null;
      // One debt at a time is the rule, and a one-off is what suspends it.
      // Raising somebody's ceiling "just this once" is no use to the person it
      // is usually aimed at — somebody already in the red — if the bank still
      // tells them to settle up first, so the one-off buys the second loan as
      // well as the room for it.
      if (held && !(room.boost > 0)) {
        return json({ error: "settle the last one first.", owed: held.owed }, 409);
      }
      // The ceiling is on everything outstanding at once rather than on each
      // loan taken separately, or a one-off would be a licence to borrow the
      // whole limit again on top of a debt already at it.
      if (held) {
        const left = round2(room.limit - held.principal);
        if (!(left > 0)) {
          return json({ error: "you are already at your limit of " + room.limit + " sahurs.", cap: room.limit }, 400);
        }
        if (want > left) {
          return json({ error: "you have " + left + " sahurs of room left.", cap: left }, 400);
        }
      }
      const cur = await kv.get<{ bal: number; lastClaim: number }>(["cas", u.id]);
      const rec = cur.value ?? { bal: 0, lastClaim: 0 };
      const base = Number.isFinite(rec.bal) ? rec.bal : 0;
      const nb = round2(base + want);
      // interest is charged on the new money only — what was already owed has
      // had its interest added once already and must never be charged twice
      const owed = owedFor(want);
      // A one-off extra is spent by taking a loan at all, not by the part of
      // the loan that leaned on it, so it comes off in the same commit. It is
      // checked as well as deleted: two borrow attempts racing must not both
      // get to lean on the same one-off.
      const boostE = await kv.get<number>(["loanboost", u.id]);
      // the loan and the money it puts in your hand are one commit, so there is
      // no instant where a debt exists that was never paid out, or the reverse
      const op = kv.atomic()
        .check(loanE).check(cur).check(boostE)
        .set(["loan", u.id], {
          principal: round2((held ? held.principal : 0) + want),
          owed: round2((held ? held.owed : 0) + owed),
          ts: Date.now(),
        }, { expireIn: LOAN_TTL })
        .set(["cas", u.id], { ...rec, bal: nb }, { expireIn: CAS_TTL });
      if (boostE.value !== null) op.delete(["loanboost", u.id]);
      const res = await op.commit();
      if (res.ok) {
        return json({
          ok: true, borrowed: want, owed, balance: nb,
          cap: room.cap, spentBoost: capOf(boostE.value) ?? 0,
        });
      }
    }
    return json({ error: "busy" }, 503);
  }

  // ---------- repay ----------
  // Any amount, or leave it out for the lot. Never takes more than is owed and
  // never more than is on the balance.
  if (req.method === "POST" && path === "/bank/repay") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    const u = await casUser(b.token);
    if (!u) return json({ error: "unauthorized" }, 401);
    if (!allow("bank:" + u.id, 10, 60_000)) return tooMany(30);
    for (let attempt = 0; attempt < 8; attempt++) {
      const loanE = await kv.get<Loan>(["loan", u.id]);
      const owed = loanE.value && Number(loanE.value.owed) > 0 ? round2(Number(loanE.value.owed)) : 0;
      if (owed <= 0) return json({ error: "you owe the bank nothing." }, 409);
      const cur = await kv.get<{ bal: number; lastClaim: number }>(["cas", u.id]);
      const rec = cur.value ?? { bal: 0, lastClaim: 0 };
      const base = Number.isFinite(rec.bal) ? rec.bal : 0;
      const asked = b.amount === undefined || b.amount === null || b.amount === "" ? owed : round2(Number(b.amount));
      if (!Number.isFinite(asked) || asked <= 0) return json({ error: "name a real number." }, 400);
      const pay = Math.min(asked, owed);
      if (pay > base + 1e-9) return json({ error: "insufficient", owed, balance: round2(base) }, 402);
      const left = round2(owed - pay);
      const nb = round2(base - pay);
      let op = kv.atomic().check(loanE).check(cur)
        .set(["cas", u.id], { ...rec, bal: Math.max(0, nb) }, { expireIn: CAS_TTL });
      op = left > 0
        ? op.set(["loan", u.id], { ...loanE.value!, owed: left }, { expireIn: LOAN_TTL })
        : op.delete(["loan", u.id]);
      if ((await op.commit()).ok) {
        return json({ ok: true, paid: pay, owed: left, balance: Math.max(0, nb), cleared: left <= 0 });
      }
    }
    return json({ error: "busy" }, 503);
  }

  // ---------- tip / donate sahurs to another approved member ----------
  // Auth required (same gate as casino/chat). Profile lookup is members-only and
  // returns username + registration date + current balance so the tip UI can confirm
  // the recipient before posting. Transfer is a single atomic debit+credit.
  if (req.method === "GET" && path === "/tip/profile") {
    const u = await casUser(url.searchParams.get("token"));
    if (!u) return json({ error: "unauthorized" }, 401);
    const name = clip(url.searchParams.get("user") || url.searchParams.get("username"), 24);
    if (!name) return json({ error: "invalid" }, 400);
    const app = await findApprovedByUsername(name);
    if (!app) return json({ error: "not_found" }, 404);
    const c = await getCas(app.id);
    return json({
      // the id as well as the name: a DM is opened against the account, not
      // against a string that could have been renamed since it was drawn
      id: app.id,
      username: app.username,
      createdAt: Number(app.ts) || 0,
      registeredAt: Number(app.ts) || 0,
      balance: round2(c.bal),
      self: app.id === u.id,
    });
  }
  if (req.method === "POST" && path === "/tip") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    const u = await casUser(b.token);
    if (!u) return json({ error: "unauthorized" }, 401);
    // A tip is a write to two balances. It is also the one route a member can
    // aim at somebody else's record, so it gets a clock of its own well below
    // anything a person does and well above anything the tests do.
    if (!allow("tip:" + u.id, 20, 60_000)) return tooMany(60);
    const toName = clip(b.to ?? b.username, 24);
    const amount = parseBet(b.amount); // same min/max + finite checks as casino wagers
    if (!toName || amount === null) return json({ error: "invalid" }, 400);
    if (toName.toLowerCase() === String(u.username).toLowerCase()) {
      return json({ error: "self" }, 400);
    }
    const tipId = clip(b.tipId, 64);
    if (tipId && tipId.length < 8) return json({ error: "invalid" }, 400);
    const app = await findApprovedByUsername(toName);
    if (!app) return json({ error: "not_found" }, 404);
    if (app.id === u.id) return json({ error: "self" }, 400);
    const moved = await transferBalance(u.id, app.id, amount, tipId || undefined, { from: u.username, to: app.username });
    if (moved === "insufficient") return json({ error: "insufficient" }, 402);
    if (!moved) return json({ error: "invalid" }, 400);
    return json({
      ok: true,
      amount,
      to: app.username,
      fromBalance: round2(moved.from),
      toBalance: round2(moved.to),
      replay: !!moved.replay,
    });
  }

  // ---------- DICE (roll under) — instant ----------
  if (req.method === "POST" && path === "/cas/dice") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    const u = await casUser(b.token);
    if (!u) return json({ error: "unauthorized" }, 401);
    if (!allow("cas:" + u.id, CAS_BURST, CAS_BURST_MS)) return tooMany(Math.ceil(CAS_BURST_MS / 1000));
    const bet = parseBet(b.bet);
    if (bet === null) return json({ error: wagerError(b.bet) }, 400);
    const target = round2(Number(b.target));
    const over = b.over === true;             // false = roll under, true = roll over
    if (!(target >= 2 && target <= 98)) return json({ error: "target 2–98" }, 400);
    // winning span as a percentage of the 0–100 roll range
    const chance = over ? 100 - target : target;
    if (!(chance >= 2 && chance <= 98)) return json({ error: "bad target" }, 400);
    const purse = await purseFor(u.id, b.round);
    const no = await purse.take(bet);
    if (no) return json({ error: no }, no === "insufficient" ? 402 : 409);
    const roll = round2(rnd() * 100);
    const win = over ? roll > target : roll < target;
    const exact = (100 / chance) * HOUSE;
    const mult = win ? round2(exact) : 0;
    const payout = win ? payoutOf(bet, exact) : 0;
    await purse.give(payout);
    return json({ ok: true, roll, target, over, chance, win, multiplier: mult, payout, balance: purse.bal, ...purseJson(purse) });
  }

  // ---------- LIMBO — instant ----------
  if (req.method === "POST" && path === "/cas/limbo") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    const u = await casUser(b.token);
    if (!u) return json({ error: "unauthorized" }, 401);
    if (!allow("cas:" + u.id, CAS_BURST, CAS_BURST_MS)) return tooMany(Math.ceil(CAS_BURST_MS / 1000));
    const bet = parseBet(b.bet);
    if (bet === null) return json({ error: wagerError(b.bet) }, 400);
    const target = round2(Number(b.target)); // desired cash-out multiplier
    if (!(target >= 1.01 && target <= 1000000)) return json({ error: "target 1.01–1e6" }, 400);
    const purse = await purseFor(u.id, b.round);
    const no = await purse.take(bet);
    if (no) return json({ error: no }, no === "insufficient" ? 402 : 409);
    // crash point c with P(c >= t) = HOUSE/t  → fair, 0.1% edge. The win MUST be
    // decided on the exact crash: comparing the 2dp-rounded value let a 1.996
    // round up to 2.00 and clear a 2.00 target it should have missed, which
    // handed the player back part of the edge (worse the lower the target —
    // 99.25% RTP at 2×, 99.49% at 1.10×). Floor the displayed value so what the
    // player sees never rounds up past the real crash either.
    const crashExact = Math.max(1, HOUSE / (1 - rnd()));
    const win = crashExact >= target;
    const crash = floor2(crashExact);
    const payout = win ? payoutOf(bet, target) : 0;
    await purse.give(payout);
    return json({ ok: true, crash, target, win, multiplier: win ? target : 0, payout, balance: purse.bal, ...purseJson(purse) });
  }

  // ---------- ROULETTE (European single-zero) — instant ----------
  if (req.method === "POST" && path === "/cas/roulette") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    const u = await casUser(b.token);
    if (!u) return json({ error: "unauthorized" }, 401);
    if (!allow("cas:" + u.id, CAS_BURST, CAS_BURST_MS)) return tooMany(Math.ceil(CAS_BURST_MS / 1000));
    const bet = parseBet(b.bet);
    if (bet === null) return json({ error: wagerError(b.bet) }, 400);
    const kind = clip(b.kind, 12);   // number|red|black|odd|even|low|high|dozen|column
    const val = Math.floor(Number(b.value)); // for number(0-36), dozen(1-3), column(1-3)
    // resolve payout multiplier (winnings-to-stake) for each bet kind
    const spin = rndInt(37);
    const isRed = RED.has(spin), zero = spin === 0;
    // Roulette keeps the true single-zero wheel: flat 2×/3×/36× payouts with a
    // green zero. The edge is structural (the zero), a fixed ~2.70% on every
    // bet, and is deliberately NOT flattened to the 0.1% the other games use.
    let won = false, mult = 0;
    if (kind === "number") { if (!(val >= 0 && val <= 36)) return json({ error: "number 0–36" }, 400); won = spin === val; mult = 36; }
    else if (kind === "red") { won = isRed; mult = 2; }
    else if (kind === "black") { won = !isRed && !zero; mult = 2; }
    else if (kind === "odd") { won = !zero && spin % 2 === 1; mult = 2; }
    else if (kind === "even") { won = !zero && spin % 2 === 0; mult = 2; }
    else if (kind === "low") { won = spin >= 1 && spin <= 18; mult = 2; }
    else if (kind === "high") { won = spin >= 19 && spin <= 36; mult = 2; }
    else if (kind === "dozen") { if (!(val >= 1 && val <= 3)) return json({ error: "dozen 1–3" }, 400); won = !zero && Math.ceil(spin / 12) === val; mult = 3; }
    else if (kind === "column") { if (!(val >= 1 && val <= 3)) return json({ error: "column 1–3" }, 400); won = !zero && spin % 3 === (val % 3); mult = 3; }
    else return json({ error: "bad kind" }, 400);
    const purse = await purseFor(u.id, b.round);
    const no = await purse.take(bet);
    if (no) return json({ error: no }, no === "insufficient" ? 402 : 409);
    const payout = won ? payoutOf(bet, mult) : 0;
    await purse.give(payout);
    return json({ ok: true, spin, color: zero ? "green" : (isRed ? "red" : "black"), win: won, multiplier: won ? mult : 0, payout, balance: purse.bal, ...purseJson(purse) });
  }

  // ---------- PLINKO — instant ----------
  if (req.method === "POST" && path === "/cas/plinko") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    const u = await casUser(b.token);
    if (!u) return json({ error: "unauthorized" }, 401);
    if (!allow("cas:" + u.id, CAS_BURST, CAS_BURST_MS)) return tooMany(Math.ceil(CAS_BURST_MS / 1000));
    const bet = parseBet(b.bet);
    if (bet === null) return json({ error: wagerError(b.bet) }, 400);
    const risk = clip(b.risk, 8);
    const rows = Math.floor(Number(b.rows));
    const riskTab = pick(PLINKO, risk);
    const table = riskTab ? pick(riskTab, rows) : null;
    if (!table) return json({ error: "rows 8/12/16, risk low/medium/high" }, 400);
    const purse = await purseFor(u.id, b.round);
    const no = await purse.take(bet);
    if (no) return json({ error: no }, no === "insufficient" ? 402 : 409);
    const path2: number[] = [];
    let bucket = 0;
    for (let i = 0; i < rows; i++) { const r = rnd() < 0.5 ? 1 : 0; path2.push(r); bucket += r; }
    // correct the raw table to exactly HOUSE (risk/rows validated above)
    const exact = table[bucket] * PLINKO_CORR[risk][rows];
    const payout = payoutOf(bet, exact);
    await purse.give(payout);
    return json({ ok: true, path: path2, bucket, multiplier: round2(exact), payout, balance: purse.bal, ...purseJson(purse) });
  }

  // ---------- BLACKJACK (start / hit / stand / double) ----------
  if (req.method === "POST" && path === "/cas/bj/start") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    const u = await casUser(b.token);
    if (!u) return json({ error: "unauthorized" }, 401);
    if (!allow("cas:" + u.id, CAS_BURST, CAS_BURST_MS)) return tooMany(Math.ceil(CAS_BURST_MS / 1000));
    const bet = parseBet(b.bet);
    if (bet === null) return json({ error: wagerError(b.bet) }, 400);
    const purse = await purseFor(u.id, b.round);
    // deno-lint-ignore no-explicit-any
    const held = await kv.get<any>(["bj", u.id]);
    const clash = stakeClash(held.value, purse);
    if (clash) return json({ error: clash }, 409);
    const no = await purse.take(bet);
    if (no) return json({ error: no }, no === "insufficient" ? 402 : 409);
    const player = [drawCard(), drawCard()];
    const dealer = [drawCard(), drawCard()];
    const pv = handValue(player), dv = handValue(dealer);
    const st = { hands: [{ cards: player, bet, done: false, result: "", payout: 0 }], active: 0, dealer, split: false, base: bet, w: purse.tag };
    if (pv.total === 21 || dv.total === 21) {
      // natural(s) resolve immediately, before any split is possible
      let result = "", payout = 0;
      if (pv.total === 21 && dv.total === 21) { result = "push"; payout = bet; }
      else if (pv.total === 21) { result = "blackjack"; payout = payoutOf(bet, 2.5); }
      else { result = "dealer_blackjack"; payout = 0; }
      st.hands[0].done = true; st.hands[0].result = result; st.hands[0].payout = payout;
      // never stored, so there is no record to claim — pay it straight out
      await purse.give(payout);
      return await bjRespond(u.id, st, true, purse);
    }
    await kv.set(["bj", u.id], st, { expireIn: GAME_TTL });
    return await bjRespond(u.id, st, false, purse);
  }
  if (req.method === "POST" && (path === "/cas/bj/hit" || path === "/cas/bj/stand" ||
      path === "/cas/bj/double" || path === "/cas/bj/split")) {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    const u = await casUser(b.token);
    if (!u) return json({ error: "unauthorized" }, 401);
    if (!allow("cas:" + u.id, CAS_BURST, CAS_BURST_MS)) return tooMany(Math.ceil(CAS_BURST_MS / 1000));
    // deno-lint-ignore no-explicit-any
    const g = await kv.get<any>(["bj", u.id]);
    // drop any hand stored in the pre-split shape rather than misread it
    if (!g.value || !Array.isArray(g.value.hands)) {
      if (g.value) await kv.delete(["bj", u.id]);
      return json({ error: "no hand" }, 400);
    }
    const st = g.value;
    const h = st.hands[st.active];
    if (!h || h.done) return json({ error: "no hand" }, 400);
    // the hand settles into whatever staked it, whatever the player is in now
    const purse = await purseOfStake(u.id, st.w);

    if (path === "/cas/bj/hit") {
      h.cards.push(drawCard());
      if (handValue(h.cards).total > 21) h.done = true;
    } else if (path === "/cas/bj/stand") {
      h.done = true;
    } else if (path === "/cas/bj/double") {
      if (h.cards.length !== 2) return json({ error: "can only double on the first move" }, 400);
      const more = await purse.take(h.bet);
      if (more) return json({ error: more }, more === "insufficient" ? 402 : 409);
      h.bet = round2(h.bet * 2);          // the extra stake rides on this hand only
      h.cards.push(drawCard());
      h.done = true;
    } else {
      // split: the pair becomes two hands, each carrying its own stake
      if (h.cards.length !== 2 || rankOf(h.cards[0]) !== rankOf(h.cards[1])) return json({ error: "not a pair" }, 400);
      if (st.hands.length >= 4) return json({ error: "too many hands" }, 400);
      const more = await purse.take(h.bet);
      if (more) return json({ error: more }, more === "insufficient" ? 402 : 409);
      const moved = h.cards.pop();
      const wasAces = rankOf(h.cards[0]) === "A";
      h.cards.push(drawCard());
      const nh = { cards: [moved, drawCard()], bet: h.bet, done: false, result: "", payout: 0 };
      st.hands.splice(st.active + 1, 0, nh);
      st.split = true;
      // split aces take exactly one card each and then stand
      if (wasAces) { h.done = true; nh.done = true; }
      else if (handValue(h.cards).total > 21) h.done = true;
    }

    while (st.active < st.hands.length && st.hands[st.active].done) st.active++;
    if (st.active >= st.hands.length) {
      const done = await bjResolve(u.id, st, g, purse);
      if (!done) return json({ error: "no hand" }, 400);   // another request settled it
      return await bjRespond(u.id, done, true, purse);
    }
    if (!(await kv.atomic().check(g).set(["bj", u.id], st, { expireIn: GAME_TTL }).commit()).ok) {
      return json({ error: "no hand" }, 400);   // a concurrent action moved the hand
    }
    return await bjRespond(u.id, st, false, purse);
  }

  // ---------- MINES (start / pick / cashout) ----------
  if (req.method === "POST" && path === "/cas/mines/start") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    const u = await casUser(b.token);
    if (!u) return json({ error: "unauthorized" }, 401);
    if (!allow("cas:" + u.id, CAS_BURST, CAS_BURST_MS)) return tooMany(Math.ceil(CAS_BURST_MS / 1000));
    const bet = parseBet(b.bet);
    if (bet === null) return json({ error: wagerError(b.bet) }, 400);
    const count = Math.floor(Number(b.mines));
    if (!(count >= 1 && count <= 24)) return json({ error: "mines 1–24" }, 400);
    const purse = await purseFor(u.id, b.round);
    // deno-lint-ignore no-explicit-any
    const held = await kv.get<any>(["mines", u.id]);
    const clash = stakeClash(held.value, purse);
    if (clash) return json({ error: clash }, 409);
    const no = await purse.take(bet);
    if (no) return json({ error: no }, no === "insufficient" ? 402 : 409);
    // choose `count` distinct mine cells out of 25
    const cells = [...Array(25).keys()];
    for (let i = cells.length - 1; i > 0; i--) { const j = rndInt(i + 1); [cells[i], cells[j]] = [cells[j], cells[i]]; }
    const mines = cells.slice(0, count).sort((a, c) => a - c);
    await kv.set(["mines", u.id], { mines, bet, count, revealed: [], w: purse.tag }, { expireIn: GAME_TTL });
    return json({ ok: true, state: "playing", mines: count, revealed: [], multiplier: 1, nextMultiplier: minesMult(count, 1), ...purseJson(purse) });
  }
  if (req.method === "POST" && path === "/cas/mines/pick") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    const u = await casUser(b.token);
    if (!u) return json({ error: "unauthorized" }, 401);
    if (!allow("cas:" + u.id, CAS_BURST, CAS_BURST_MS)) return tooMany(Math.ceil(CAS_BURST_MS / 1000));
    // deno-lint-ignore no-explicit-any
    const g = await kv.get<any>(["mines", u.id]);
    if (!g.value) return json({ error: "no game" }, 400);
    const st = g.value;
    const purse = await purseOfStake(u.id, st.w);
    const tile = Math.floor(Number(b.tile));
    if (!(tile >= 0 && tile <= 24) || st.revealed.includes(tile)) return json({ error: "bad tile" }, 400);
    if (st.mines.includes(tile)) {
      // a board that pays nothing still has to be read back: the stake stops
      // being in play, and only then can an empty stack mean an empty player
      if (!await purse.settle(["mines", u.id], g, 0)) return json({ error: "no game" }, 400);
      return json({ ok: true, state: "boom", tile, mines: st.mines, balance: purse.bal, ...purseJson(purse) });
    }
    st.revealed.push(tile);
    const safe = st.revealed.length;
    const mult = minesMult(st.count, safe);
    // auto-win once every safe tile is uncovered
    if (safe === 25 - st.count) {
      const payout = payoutOf(st.bet, minesMultExact(st.count, safe));
      if (!await purse.settle(["mines", u.id], g, payout)) return json({ error: "no game" }, 400);
      return json({ ok: true, state: "cashout", tile, multiplier: mult, payout, revealed: st.revealed, mines: st.mines, balance: purse.bal, ...purseJson(purse) });
    }
    if (!(await kv.atomic().check(g).set(["mines", u.id], st, { expireIn: GAME_TTL }).commit()).ok) {
      return json({ error: "no game" }, 400);   // a concurrent pick or cashout moved it
    }
    return json({ ok: true, state: "playing", tile, revealed: st.revealed, multiplier: mult, nextMultiplier: minesMult(st.count, safe + 1) });
  }
  if (req.method === "POST" && path === "/cas/mines/cashout") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    const u = await casUser(b.token);
    if (!u) return json({ error: "unauthorized" }, 401);
    if (!allow("cas:" + u.id, CAS_BURST, CAS_BURST_MS)) return tooMany(Math.ceil(CAS_BURST_MS / 1000));
    // deno-lint-ignore no-explicit-any
    const g = await kv.get<any>(["mines", u.id]);
    if (!g.value) return json({ error: "no game" }, 400);
    const st = g.value;
    if (!st.revealed.length) return json({ error: "reveal a tile first" }, 400);
    const purse = await purseOfStake(u.id, st.w);
    const mult = minesMult(st.count, st.revealed.length);
    const payout = payoutOf(st.bet, minesMultExact(st.count, st.revealed.length));
    if (!await purse.settle(["mines", u.id], g, payout)) return json({ error: "no game" }, 400);   // already cashed out
    return json({ ok: true, state: "cashout", multiplier: mult, payout, mines: st.mines, balance: purse.bal, ...purseJson(purse) });
  }

  // ---------- BEEF (crash-chicken: start / step / cashout) ----------
  if (req.method === "POST" && path === "/cas/beef/start") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    const u = await casUser(b.token);
    if (!u) return json({ error: "unauthorized" }, 401);
    if (!allow("cas:" + u.id, CAS_BURST, CAS_BURST_MS)) return tooMany(Math.ceil(CAS_BURST_MS / 1000));
    const bet = parseBet(b.bet);
    if (bet === null) return json({ error: wagerError(b.bet) }, 400);
    const diff = clip(b.difficulty, 10);
    const cfg = pick(BEEF, diff);
    if (!cfg) return json({ error: "difficulty easy/medium/hard/daredevil" }, 400);
    const purse = await purseFor(u.id, b.round);
    // deno-lint-ignore no-explicit-any
    const held = await kv.get<any>(["beef", u.id]);
    const clash = stakeClash(held.value, purse);
    if (clash) return json({ error: clash }, 409);
    const no = await purse.take(bet);
    if (no) return json({ error: no }, no === "insufficient" ? 402 : 409);
    // pre-roll the death lane NOW so the outcome is fixed server-side and the
    // client cannot influence any step. deathStep = first lane the chicken dies on.
    let deathStep = cfg.lanes + 1; // survives the whole road unless rolled sooner
    for (let s = 1; s <= cfg.lanes; s++) { if (rnd() >= cfg.q) { deathStep = s; break; } }
    await kv.set(["beef", u.id], { bet, q: cfg.q, lanes: cfg.lanes, deathStep, step: 0, w: purse.tag }, { expireIn: GAME_TTL });
    return json({
      ok: true, state: "playing", step: 0, lanes: cfg.lanes, multiplier: 1,
      nextMultiplier: beefMult(cfg.q, 1), ladder: beefLadder(cfg.q, cfg.lanes),
      ...purseJson(purse),
    });
  }
  if (req.method === "POST" && path === "/cas/beef/step") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    const u = await casUser(b.token);
    if (!u) return json({ error: "unauthorized" }, 401);
    if (!allow("cas:" + u.id, CAS_BURST, CAS_BURST_MS)) return tooMany(Math.ceil(CAS_BURST_MS / 1000));
    // deno-lint-ignore no-explicit-any
    const g = await kv.get<any>(["beef", u.id]);
    if (!g.value) return json({ error: "no game" }, 400);
    const st = g.value;
    // refuse a walk whose config isn't sane (e.g. a record written before the
    // prototype-lookup fix); drop it rather than compute NaN multipliers
    if (!Number.isFinite(st.q) || !Number.isFinite(st.lanes) || !Number.isFinite(st.bet)) {
      await kv.delete(["beef", u.id]);
      return json({ error: "no game" }, 400);
    }
    const purse = await purseOfStake(u.id, st.w);
    const nextStep = st.step + 1;
    if (nextStep >= st.deathStep) {
      if (!await purse.settle(["beef", u.id], g, 0)) return json({ error: "no game" }, 400);
      return json({ ok: true, state: "dead", step: nextStep, deathStep: st.deathStep, balance: purse.bal, ...purseJson(purse) });
    }
    st.step = nextStep;
    const mult = beefMult(st.q, nextStep);
    if (nextStep >= st.lanes) {
      // reached the far side — auto cash out at the top multiplier
      const payout = payoutOf(st.bet, beefMultExact(st.q, nextStep));
      if (!await purse.settle(["beef", u.id], g, payout)) return json({ error: "no game" }, 400);
      return json({ ok: true, state: "cashout", step: nextStep, multiplier: mult, payout, balance: purse.bal, ...purseJson(purse) });
    }
    if (!(await kv.atomic().check(g).set(["beef", u.id], st, { expireIn: GAME_TTL }).commit()).ok) {
      return json({ error: "no game" }, 400);   // a concurrent step or cashout moved it
    }
    return json({ ok: true, state: "playing", step: nextStep, multiplier: mult, nextMultiplier: beefMult(st.q, nextStep + 1) });
  }
  if (req.method === "POST" && path === "/cas/beef/cashout") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    const u = await casUser(b.token);
    if (!u) return json({ error: "unauthorized" }, 401);
    if (!allow("cas:" + u.id, CAS_BURST, CAS_BURST_MS)) return tooMany(Math.ceil(CAS_BURST_MS / 1000));
    // deno-lint-ignore no-explicit-any
    const g = await kv.get<any>(["beef", u.id]);
    if (!g.value) return json({ error: "no game" }, 400);
    const st = g.value;
    if (!Number.isFinite(st.q) || !Number.isFinite(st.lanes) || !Number.isFinite(st.bet)) {
      await kv.delete(["beef", u.id]);
      return json({ error: "no game" }, 400);
    }
    if (st.step < 1) return json({ error: "take a step first" }, 400);
    const purse = await purseOfStake(u.id, st.w);
    const mult = beefMult(st.q, st.step);
    const payout = payoutOf(st.bet, beefMultExact(st.q, st.step));
    if (!await purse.settle(["beef", u.id], g, payout)) return json({ error: "no game" }, 400);   // already cashed out
    return json({ ok: true, state: "cashout", step: st.step, multiplier: mult, payout, balance: purse.bal, ...purseJson(purse) });
  }

  // ---------- SHOP: list active items + redeem ----------
  if (req.method === "GET" && path === "/shop/list") {
    const u = await casUser(url.searchParams.get("token"));
    if (!u) return json({ error: "unauthorized" }, 401);
    // the shop is opened, not polled — two walks of the shelves per read
    if (!allow("shop:" + u.id, 15, 10_000)) return tooMany(10);
    const items: unknown[] = [];
    // deno-lint-ignore no-explicit-any
    for await (const e of kv.list<any>({ prefix: ["shopitem"] }, { limit: SHOP_MAX })) {
      // inputLabel is shipped so the buyer can be prompted; output is held back
      // until they actually redeem (it may be a code or a one-time reward).
      if (e.value.active) {
        items.push({
          id: e.value.id,
          name: e.value.name,
          desc: e.value.desc,
          price: e.value.price,
          inputLabel: e.value.inputLabel || "",
          theme: e.value.theme || "",
          themeName: e.value.theme ? (themeById(e.value.theme)?.name || "") : "",
          // an item that unlocks something you already have is not for you
          owned: e.value.theme ? await ownsTheme(u.id, e.value.theme) : false,
        });
      }
    }
    // deno-lint-ignore no-explicit-any
    items.sort((a: any, c: any) => a.price - c.price);
    const bal = (await getCas(u.id)).bal;
    return json({ items, pending: await listShopPending(u.id), balance: round2(bal) });
  }
  if (req.method === "POST" && path === "/shop/redeem") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    const u = await casUser(b.token);
    if (!u) return json({ error: "unauthorized" }, 401);
    // deno-lint-ignore no-explicit-any
    const it = await kv.get<any>(["shopitem", clip(b.itemId, 32)]);
    if (!it.value || !it.value.active) return json({ error: "unavailable" }, 404);
    // the question (discord tag, etc) is asked AFTER they have paid. a missing
    // answer must not block the sale — the client shows the field once the
    // shelves already have their sahurs.
    const inputLabel = String(it.value.inputLabel || "").trim();
    const input = clip(b.input, 500);
    const price = round2(Number(it.value.price));
    // Buying a skin you already wear is just a donation, so refuse it before
    // taking the sahurs rather than after.
    const grants = String(it.value.theme || "");
    if (grants && await ownsTheme(u.id, grants)) return json({ error: "already owned" }, 409);
    const bal = await adjustBalance(u.id, -price);
    if (bal === null) return json({ error: "insufficient" }, 402);
    // The debit has happened, so the grant must not be conditional on anything
    // that can fail afterwards — it is written before the reply is built, and
    // writing it twice is the same as writing it once.
    if (grants && themeById(grants)) await kv.set(["theme", u.id, grants], 1);
    let pending: ShopPending | null = null;
    if (inputLabel && !input) {
      // they paid. walking away must not lose the question — keep an owed
      // redeem until they answer, and put it back on the shop list.
      pending = {
        id: rid(6),
        itemId: it.value.id,
        name: it.value.name,
        price,
        inputLabel,
        output: String(it.value.output || ""),
        ts: Date.now(),
      };
      await kv.set(["shoppend", u.id, pending.id], pending, { expireIn: CAS_TTL });
    }
    notifyRedeem(u.username, { name: it.value.name, price }, inputLabel ? input : "");
    return json({
      ok: true,
      balance: round2(bal),
      item: it.value.name,
      price,
      output: it.value.output || "",
      inputLabel,
      pending,
      theme: grants || null,
    });
  }
  if (req.method === "POST" && path === "/shop/tell") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    const u = await casUser(b.token);
    if (!u) return json({ error: "unauthorized" }, 401);
    const input = clip(b.input, 500);
    if (!input) return json({ error: "input required" }, 400);
    const redeemId = clip(b.redeemId, 32);
    const itemId = clip(b.itemId, 32);
    let pending: ShopPending | null = null;
    if (redeemId) {
      const hit = await kv.get<ShopPending>(["shoppend", u.id, redeemId]);
      pending = hit.value;
    } else if (itemId) {
      const owed = (await listShopPending(u.id)).filter((p) => p.itemId === itemId);
      pending = owed[0] || null;
    }
    if (!pending) return json({ error: "nothing to add" }, 400);
    await kv.delete(["shoppend", u.id, pending.id]);
    notifyRedeem(u.username, { name: pending.name, price: pending.price }, input);
    return json({ ok: true, output: pending.output || "" });
  }

  // ---------- admin: SET a player's balance (moderation tool) ----------
  // sets the balance to an exact value, keeping the faucet clock intact. gated by
  // the admin key. intended for cleaning up an exploiter, not day-to-day economy.
  if (req.method === "POST" && path === "/admin/setbal") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    if (!ADMIN_KEY || b.key !== ADMIN_KEY) return json({ error: "forbidden" }, 403);
    const id = clip(b.id, 32);
    const bal = round2(Number(b.balance));
    if (!id || !isFinite(bal) || bal < 0 || bal > 1e12) return json({ error: "bad balance" }, 400);
    const cur = await kv.get<{ bal: number; lastClaim: number }>(["cas", id]);
    const rec = cur.value ?? { bal: 0, lastClaim: 0 };
    await kv.set(["cas", id], { ...rec, bal }, { expireIn: CAS_TTL });
    return json({ ok: true, balance: bal });
  }

  // ---------- admin: VIEW balances ----------
  if (req.method === "GET" && path === "/admin/balances") {
    if (!adminOk(req, url)) return json({ error: "forbidden" }, 403);
    const rows: {
      id: string; username: string; balance: number; owed: number; loanMax: number; loanMaxSet: boolean;
      loanBoost: number; loanLimit: number; note: string;
    }[] = [];
    // map app id -> username for approved users, and the private note with it.
    // The note is not drawn on this pane — it belongs to the user pane and is
    // nobody's business twice over — but it travels so that searching this one
    // for it finds the row. Somebody who has written "owes me a fiver" on three
    // members should be able to pull those three up where the money is.
    const names: Record<string, string> = {};
    const notes: Record<string, string> = {};
    // deno-lint-ignore no-explicit-any
    for await (const e of kv.list<any>({ prefix: ["app"] })) {
      if (e.value.status === "approved") {
        names[e.value.id] = e.value.username;
        notes[e.value.id] = String(e.value.note || "");
      }
    }
    // deno-lint-ignore no-explicit-any
    for await (const e of kv.list<any>({ prefix: ["cas"] })) {
      const id = String(e.key[1]);
      const username = names[id];
      if (!username) continue;
      const [loan, capE, boost] = await Promise.all([
        loanOf(id),
        kv.get<number>(["loanmax", id]),
        loanBoost(id),
      ]);
      const set = capOf(capE.value);
      const loanMax = set === null ? LOAN_MAX_DEFAULT : set;
      rows.push({
        id, username, balance: round2(e.value.bal || 0),
        owed: loan.owed,
        loanMax,
        loanMaxSet: set !== null,   // false means they are simply on the house default
        loanBoost: boost,           // an unspent one-off, 0 when there is none
        loanLimit: round2(loanMax + boost),
        note: notes[id] || "",      // searchable here, shown only on the user pane
      });
    }
    rows.sort((a, c) => c.balance - a.balance);
    return json({ balances: rows, loanMaxDefault: LOAN_MAX_DEFAULT });
  }

  // ---------- admin: shop management (list all / upsert / delete) ----------
  // the list the shop editor's theme dropdown is built from
  if (req.method === "GET" && path === "/admin/themes") {
    if (!adminOk(req, url)) return json({ error: "forbidden" }, 403);
    return json({ ok: true, themes: SHRINE_THEMES.map((t) => ({ id: t.id, name: t.name, free: !!t.free })) });
  }
  if (req.method === "GET" && path === "/admin/shop") {
    if (!adminOk(req, url)) return json({ error: "forbidden" }, 403);
    const items: unknown[] = [];
    // deno-lint-ignore no-explicit-any
    for await (const e of kv.list<any>({ prefix: ["shopitem"] }, { limit: SHOP_MAX })) items.push(e.value);
    // deno-lint-ignore no-explicit-any
    items.sort((a: any, c: any) => (a.ts || 0) - (c.ts || 0));
    return json({ items });
  }
  if (req.method === "POST" && path === "/admin/shop/set") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    if (!ADMIN_KEY || b.key !== ADMIN_KEY) return json({ error: "forbidden" }, 403);
    const name = clip(b.name, 60);
    const desc = clip(b.desc, 200);
    const price = round2(Number(b.price));
    if (!name || !(price >= 0)) return json({ error: "name + price required" }, 400);
    const id = clip(b.id, 32) || rid(6);
    const active = b.active !== false;
    // inputLabel: what the buyer is asked to type (blank = no prompt).
    // output: what they are shown after redeeming (blank = nothing extra).
    const inputLabel = clip(b.inputLabel, 80);
    const output = clip(b.output, 1000);
    // theme: redeeming this item unlocks that skin for the buyer. Checked
    // against the registry so a typo cannot create an item that sells nothing.
    const theme = clip(b.theme, 32);
    if (theme && !themeById(theme)) return json({ error: "no such theme" }, 400);
    if (theme && themeById(theme)!.free) return json({ error: "that theme is already everyone's" }, 400);
    // deno-lint-ignore no-explicit-any
    const existing = await kv.get<any>(["shopitem", id]);
    const ts = existing.value?.ts || Date.now();
    await kv.set(["shopitem", id], { id, name, desc, price, active, ts, inputLabel, output, theme });
    return json({ ok: true, item: { id, name, desc, price, active, ts, inputLabel, output, theme } });
  }
  if (req.method === "POST" && path === "/admin/shop/delete") {
    // deno-lint-ignore no-explicit-any
    const b: any = await req.json().catch(() => ({}));
    if (!ADMIN_KEY || b.key !== ADMIN_KEY) return json({ error: "forbidden" }, 403);
    await kv.delete(["shopitem", clip(b.id, 32)]);
    return json({ ok: true, deleted: true });
  }

  // ---------- gone: gn-math HTML proxy ----------
  // Loaders are vendored on GitHub Pages (games/g/). Keep this 410 so old
  // scrapers and leftover clients cannot pull HTML through Deno.
  if (req.method === "GET" && path.startsWith("/g/")) {
    return new Response("gone: game loaders are on GitHub Pages at games/g/", {
      status: 410,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "public, max-age=86400",
        ...CORS,
      },
    });
  }

  // ---------- health ----------
  return new Response("Shrine of Tung backend is alive", {
    headers: { "content-type": "text/plain", ...CORS },
  });
}

const ADMIN_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Shrine of Tung — admin</title>
<style>
:root{color-scheme:dark}
body{margin:0;font-family:system-ui,Segoe UI,Roboto,sans-serif;background:#1d1206;color:#f5efe0}
header{padding:16px 20px;background:#2b1a0a;border-bottom:1px solid #3a2410;font-weight:700}
.shell{display:flex;min-height:calc(100vh - 53px)}
aside.nav{width:230px;flex-shrink:0;background:#241505;border-right:1px solid #3a2410;padding:12px 8px;display:flex;flex-direction:column;gap:4px}
.navbtn{width:100%;text-align:left;background:transparent;color:#e9d9c2;padding:10px 12px;border-radius:8px;font-size:13px;display:flex;align-items:center;gap:8px}
.navbtn:hover{background:#3a2410}
.navbtn.on{background:#c8823c;color:#1d1206}
.navbtn .count{margin-left:auto;font-weight:700;opacity:.85;font-variant-numeric:tabular-nums}
.content{flex:1;min-width:0;padding:20px 24px;max-width:780px}
.pane{display:none}
.pane.on{display:block}
.pane h2{margin:0 0 4px;font-size:18px}
.hint{color:#c8823c;font-size:13px;margin:0 0 14px}
.keybar{display:flex;gap:8px;margin-bottom:16px}
input,textarea,select{flex:1;padding:10px 12px;border-radius:8px;border:1px solid #3a2410;background:#160d04;color:#f5efe0;font-size:14px;font-family:inherit;box-sizing:border-box}
textarea{min-height:72px;resize:vertical;width:100%}
select{min-width:160px;cursor:pointer}
.dmpick{margin-bottom:14px}
.tmsg.dmfrom{align-self:flex-start;background:#241505;border:1px solid #3a2410}
.tmsg.dmto{align-self:flex-end;background:#c8823c;color:#1d1206}
#dmtext{margin-top:12px;min-height:180px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px}
.search{width:100%;flex:none;box-sizing:border-box;margin:0 0 14px}
button{padding:10px 14px;border:none;border-radius:8px;font-weight:600;cursor:pointer}
.load{background:#c8823c;color:#1d1206}
.app{background:#241505;border:1px solid #3a2410;border-radius:12px;padding:14px 16px;margin-bottom:12px}
.app h3{margin:0 0 4px;font-size:16px}
.app p{margin:0 0 12px;color:#e9d9c2;white-space:pre-wrap;word-break:break-word}
.app small{color:#c8823c}
.app.tungline{border-left:3px solid #f2c063}
.tungtag{margin-left:8px;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#1d1206;background:#f2c063;border-radius:4px;padding:1px 6px;vertical-align:middle}
.vlab{flex:1;min-width:150px}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.row+.row{margin-top:8px}
.ok{background:#2e7d32;color:#fff}
.no{background:#7a2e2e;color:#fff}
.empty{color:#c8823c;padding:20px 0}
.uname{flex:1;min-width:120px}
.tin{flex:0 1 220px;min-width:150px}
.twhy{min-width:220px}
.thrs{flex:0 0 90px;min-width:0}
.tlab{flex:0 0 auto;color:#c8823c}
.twhy{flex:1 1 260px}
.tprev{display:block;margin:2px 0 6px;color:#e9d9c2;font-style:italic}
.tsah{display:flex;align-items:center;gap:6px;font-size:13px;color:#e9d9c2;white-space:nowrap;cursor:pointer}
.app small.rev{color:#e0908a}
.thread{margin:12px 0 0;display:flex;flex-direction:column;gap:6px}
.tmsg{padding:7px 11px;border-radius:10px;font-size:.86rem;max-width:85%;white-space:pre-wrap;word-break:break-word}
.tmsg.admin{align-self:flex-end;background:#c8823c;color:#1d1206}
.tmsg.applicant{align-self:flex-start;background:#241505;border:1px solid #3a2410}
.tmsg .twhen{display:block;font-size:10px;opacity:.8;margin-bottom:3px}
.app h3 .when{margin-left:8px;font-size:11px;font-weight:500;color:#c8823c;letter-spacing:0;text-transform:none}
.danger p{color:#e9d9c2;line-height:1.45}
.content.roomy{max-width:1180px}
.tiptable{width:100%;border-collapse:collapse;font-size:13px}
.tiptable th{text-align:left;font-size:11px;font-weight:700;letter-spacing:.04em;color:#c8823c;padding:6px 8px;border-bottom:1px solid #3a2410}
.tiptable td{padding:6px 8px;border-bottom:1px solid #241505;color:#e9d9c2;white-space:nowrap}
.tiptable td.amt{color:#f2c063;font-weight:700;text-align:right}
.tiptable td.out{color:#e0908a}
.tiptable td.in{color:#b7e4bf}
.tiptable td.who{cursor:pointer;text-decoration:underline dotted}
.rfform textarea{margin:4px 0 12px}
.rflab{display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:700;color:#c8823c;letter-spacing:.02em}
.rflab small{font-weight:500}
.rfgrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
.rfgrid .row{flex-wrap:nowrap}
.rfgrid select{min-width:0;flex:0 0 120px}
.rfnote{font-size:12px;color:#c8823c}
.rfitem .rfline{margin:2px 0 8px;color:#e9d9c2;font-size:13px}
.rfitem .rftext{margin:0 0 8px;color:#f5efe0;font-style:italic;white-space:pre-wrap;word-break:break-word}
.rfitem .rfwho{margin-top:8px;font-size:12px;color:#e9d9c2;line-height:1.6}
.wchip.rfopen{background:#4a3410;color:#f2c063}
.wchip.rfdone{background:#1f3a24;color:#b7e4bf}
.wchip.rfoff{background:#3a2a24;color:#d9b8a8}
.wtabs{display:flex;gap:6px;margin:0 0 16px}
.wtabs button{background:#241505;color:#e9d9c2;border:1px solid #3a2410}
.wtabs button.on{background:#c8823c;color:#1d1206;border-color:#c8823c}
.wflag{cursor:pointer}
.wflag:hover{border-color:#8a5a28}
.wflag.sel{border-color:#c8823c}
.whits{margin:6px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:3px}
.whits li{font-size:13px;color:#e9d9c2}
.whits b{color:#ffb3b3;font-weight:700}
.wchip{display:inline-block;margin-left:8px;padding:1px 7px;border-radius:5px;font-size:11px;font-weight:700;vertical-align:1px}
.wchip.open{background:#5a1f1f;color:#ffb3b3}
.wchip.closed{background:#1f3a24;color:#b7e4bf}
.wchip.pen{background:#4a3410;color:#f2c063}
.wstats{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin:10px 0 14px}
.wstat{background:#1d1206;border:1px solid #3a2410;border-radius:10px;padding:8px 10px}
.wstat b{display:block;font-size:18px;color:#f5efe0;font-variant-numeric:tabular-nums}
.wstat span{font-size:11px;color:#c8823c}
.wtl{margin:6px 0 14px}
.wtlrow{display:flex;align-items:center;gap:10px;height:20px}
.wtlday{flex:0 0 92px;font-size:11px;color:#c8823c;text-align:right}
.wtlbar{position:relative;flex:1;height:12px;background:#1d1206;border:1px solid #3a2410;border-radius:6px}
.wtlbar i{position:absolute;top:1px;width:8px;height:8px;margin-left:-4px;border-radius:50%;background:#f2c063}
.wtlbar i.g{background:#7fb2ff}
.wtlhours{display:flex;justify-content:space-between;margin:2px 0 0 102px;font-size:10px;color:#8a6a3a}
.wtable{width:100%;border-collapse:collapse;font-size:12px;font-variant-numeric:tabular-nums}
.wtable th{text-align:left;color:#c8823c;font-weight:600;padding:6px 8px;border-bottom:1px solid #3a2410;position:sticky;top:0;background:#241505}
.wtable td{padding:5px 8px;border-bottom:1px solid #2b1a0a;color:#e9d9c2;white-space:nowrap}
.wtable td.bad{color:#ffb3b3}
.wtable td.good{color:#b7e4bf}
.wlogwrap{max-height:420px;overflow:auto;border:1px solid #3a2410;border-radius:10px}
.wpun{display:flex;flex-direction:column;gap:8px}
.wpun label,.wrule{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px;color:#e9d9c2}
.wpun input[type=number],.wrule input[type=number]{flex:0 0 76px;width:76px;padding:6px 8px}
.wpun input[type=checkbox],.wrule input[type=checkbox]{flex:0 0 auto;width:16px;height:16px}
.wpun textarea{min-height:52px}
.wrule{padding:10px 12px;background:#1d1206;border:1px solid #3a2410;border-radius:10px}
.wrule .wrname{flex:0 0 190px;font-weight:700;color:#f5efe0}
.wrules{display:flex;flex-direction:column;gap:8px}
.wsplit{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.wmuted{color:#8a6a3a;font-size:12px}
.content.wide{max-width:none;height:calc(100vh - 53px);display:flex;flex-direction:column;box-sizing:border-box;overflow:hidden}
.content.wide .keybar{flex:0 0 auto}
#pane-talk.on{flex:1;display:flex;flex-direction:column;min-height:0}
#pane-talk .hint{flex:0 0 auto}
#pane-talk h2{flex:0 0 auto}
#pane-talk .talkbox{flex:1;min-height:0;display:flex;border:1px solid #3a2410;border-radius:12px;overflow:hidden;background:#1d1206}
#pane-talk .talkrail{flex:0 0 232px;max-width:232px;min-width:0;display:flex;flex-direction:column;background:#1d1206;border-right:1px solid #3a2410}
#pane-talk .talkrailhead{padding:13px 14px 9px;font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#8a6a3a}
#pane-talk .talknew{padding:0 8px 8px}
#pane-talk .talknew select{width:100%;min-width:0;flex:none}
#pane-talk .talklist{flex:1;overflow-y:auto;padding:0 8px 10px;display:flex;flex-direction:column;gap:2px}
#pane-talk .dmrow{display:flex;flex-direction:column;gap:2px;align-items:stretch;text-align:left;width:100%;padding:8px 10px;border-radius:9px;border:1px solid transparent;background:transparent;color:inherit;font-weight:600;cursor:pointer;font-family:inherit}
#pane-talk .dmrow:hover{background:#241505}
#pane-talk .dmrow.on{background:#2b1a0a;border-color:#3a2410}
#pane-talk .dmtop{display:flex;align-items:center;gap:7px;min-width:0}
#pane-talk .dmname{flex:1;min-width:0;font-size:13px;font-weight:700;color:#f5efe0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#pane-talk .dmrow.unread .dmname{color:#f2c063}
#pane-talk .dmlast{font-size:11px;color:#8a6a3a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;max-width:100%}
#pane-talk .dmbadge{flex:0 0 auto;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:#c8823c;color:#1d1206;font-size:10px;font-weight:800;line-height:18px;text-align:center}
#pane-talk .dmempty{padding:10px;font-size:11px;color:#8a6a3a;line-height:1.5}
#pane-talk .talkmain{flex:1;display:flex;flex-direction:column;min-width:0;min-height:0}
#pane-talk .talkhead{display:flex;align-items:baseline;gap:9px;padding:12px 16px;background:#2b1a0a;border-bottom:1px solid #3a2410;min-height:44px}
#pane-talk .talkname{font-size:15px;font-weight:800;color:#f5efe0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#pane-talk .talksub{font-size:11px;color:#8a6a3a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
#pane-talk .talklog{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:8px}
#pane-talk .talkempty{color:#8a6a3a;font-size:13px;line-height:1.5}
#pane-talk .msg{max-width:75%;padding:8px 12px;border-radius:12px;background:#2b1a0a;align-self:flex-start;word-wrap:break-word}
#pane-talk .msg.me{align-self:flex-end;background:#8a5a28}
#pane-talk .meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:2px}
#pane-talk .who{display:block;font-size:11px;color:#c8823c;font-weight:600;line-height:1.2}
#pane-talk .msg.me .who{color:#f2c063}
#pane-talk .who.tung{display:flex;align-items:center;gap:6px;color:#f2c063;font-weight:800;letter-spacing:.02em}
#pane-talk .tungimg{width:15px;height:15px;border-radius:3px;object-fit:cover;flex:0 0 auto}
#pane-talk .when{font-size:10px;font-weight:500;color:#8a6a3a;white-space:nowrap}
.deltag{display:inline-block;margin-left:8px;padding:1px 6px;border-radius:4px;background:#5a1f1f;color:#ffb3b3;font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:none;vertical-align:1px}
.app.deleted p,.tmsg.deleted,#pane-talk .msg.deleted .body{opacity:.72}
#pane-talk .msg.me .when{color:#d4b48a}
#pane-talk .body{display:block;white-space:pre-wrap;word-break:break-word}
#pane-talk .talkform{display:flex;gap:8px;padding:10px;background:#2b1a0a;border-top:1px solid #3a2410}
#pane-talk .talkroom{padding:0 8px 6px}
#pane-talk .talkroomrow .dmname{color:#f2c063}
#pane-talk .talkrb{margin-left:auto;padding:1px 9px;font-size:10px;font-weight:700;border-radius:999px;border:1px solid #3a2410;background:transparent;color:#c8823c;cursor:pointer;opacity:.45}
#pane-talk .msg:hover .talkrb,#pane-talk .talkrb:focus{opacity:1}
#pane-talk .msg.me .talkrb{color:#f5efe0;border-color:#a8773f}
#pane-talk .talkquote{display:block;font-size:11px;color:#c8a878;border-left:2px solid #c8823c;padding:1px 0 1px 8px;margin:2px 0 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#pane-talk .msg.me .talkquote{color:#f5e2c4;border-left-color:#f2c063}
#pane-talk .talkgift{font-size:10px;font-weight:800;color:#1d1206;background:#f2c063;border-radius:999px;padding:1px 7px}
#pane-talk .talkreply{display:flex;align-items:center;gap:8px;padding:7px 12px;background:#241505;border-top:1px solid #3a2410;font-size:12px;color:#c8a878}
#pane-talk .talkreply[hidden]{display:none}
#pane-talk .talkreply span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#pane-talk .talkreply button{padding:0 9px;font-size:15px;line-height:22px;border-radius:7px;border:1px solid #3a2410;background:transparent;color:#c8823c;cursor:pointer}
#pane-talk .talkform input{flex:1;min-width:0}
#pane-talk .talkform input:disabled{opacity:.55}
</style></head><body>
<header>Shrine of Tung — admin</header>
<div class="shell">
<aside class="nav">
<button type="button" class="navbtn on" data-pane="pending">Approve / deny <span class="count" id="count-pending"></span></button>
<button type="button" class="navbtn" data-pane="users">Manage users <span class="count" id="count-users"></span></button>
<button type="button" class="navbtn" data-pane="balances">Casino balances <span class="count" id="count-balances"></span></button>
<button type="button" class="navbtn" data-pane="tips">Sahur transfers</button>
<button type="button" class="navbtn" data-pane="watch">Sahur watch <span class="count" id="count-watch"></span></button>
<button type="button" class="navbtn" data-pane="shop">Shop items <span class="count" id="count-shop"></span></button>
<button type="button" class="navbtn" data-pane="chat">Chat log <span class="count" id="count-chat"></span></button>
<button type="button" class="navbtn" data-pane="dms">Direct messages <span class="count" id="count-dms"></span></button>
<button type="button" class="navbtn" data-pane="talk">Talk to da people <span class="count" id="count-talk"></span></button>
<button type="button" class="navbtn" data-pane="postas">Post as&hellip;</button>
<button type="button" class="navbtn" data-pane="raffles">Giveaways <span class="count" id="count-raffles"></span></button>
<button type="button" class="navbtn" data-pane="veil">Web veil <span class="count" id="count-veil"></span></button>
<button type="button" class="navbtn" data-pane="maint">Maintenance <span class="count" id="count-maint"></span></button>
<button type="button" class="navbtn" data-pane="danger">Wipe data</button>
</aside>
<div class="content">
<div class="keybar"><input id="key" type="password" placeholder="admin key" autocomplete="off"><button class="load" id="load">load</button></div>
<section class="pane on" id="pane-pending">
<h2>Approve / deny users</h2>
<p class="hint">Pending applications. Search by name, id, or application text.</p>
<input class="search" id="search-pending" placeholder="search pending users…" autocomplete="off">
<div id="list"><div class="empty">enter your admin key and hit load.</div></div>
</section>
<section class="pane" id="pane-users">
<h2>Manage users</h2>
<p class="hint">Approved users: rename, ban, chat-ban, timeout, moderator powers, web-veil access, note, re-review, or delete.
A <b>ban</b> shuts the whole shrine — chat and casino both. A <b>chat ban</b> shuts only the chat: they cannot read it or post in it, and the casino, the pit, the games, the shop and the veil keep working normally.
A <b>moderator</b> gets a bin next to react and reply on every chat message and can delete any of them (everybody can delete their own). Nothing marks them out in the room — no badge, no tag — so only this page knows.
<b>Delete</b> takes everything they said with them: their chat messages and reactions, and both sides of every DM they were in.</p>
<div class="row" style="margin:0 0 14px"><button class="load" id="purgeGone" type="button">clear what deleted accounts left behind</button><span class="hint" id="purgeGoneOut" style="margin:0">Accounts deleted before that rule left their messages and DMs behind &mdash; the &ldquo;(gone)&rdquo; rows. One pass clears all of it; opening one of those conversations also clears it on its own.</span></div>
<input class="search" id="search-users" placeholder="search approved users…" autocomplete="off">
<div id="users"><div class="empty">load to see approved users.</div></div>
</section>
<section class="pane" id="pane-balances">
<h2>Manage casino balances</h2>
<p class="hint">Fun-money sahurs. Set a balance only as a moderation tool.
Each member also has a <b>debt</b> to the Bank of Tung and a <b>loan cap</b> &mdash; the most it will lend them at once.
Setting a debt writes it straight to the ledger with no interest added, and <b>0</b> wipes it. Leave the cap blank for the house default; set it to <b>0</b> to shut the bank to them.</p>
<input class="search" id="search-balances" placeholder="search player balances…" autocomplete="off">
<div id="balances"><div class="empty">load to see player balances.</div></div>
</section>
<section class="pane" id="pane-tips">
<h2>Sahur transfers</h2>
<p class="hint">Every time one member sends sahurs to another, newest first — who, to whom, how much, and what each was left holding after it. Credits you make from Casino balances are not transfers and are not listed. Kept 90 days. Pick a member to see only what they sent and received.</p>
<div class="row" style="margin-bottom:12px"><select id="tipWho"><option value="">everybody</option></select><button class="load" id="tipLoad" type="button">show</button></div>
<div id="tipSum" class="rfnote" style="margin-bottom:8px"></div>
<div id="tiplist"><div class="empty">enter your admin key and open this pane.</div></div>
<div class="row" style="margin-top:10px"><button type="button" id="tipMore" style="display:none;background:#241505;color:#e9d9c2;border:1px solid #3a2410">load older</button></div>
</section>
<section class="pane" id="pane-shop">
<h2>Shop items</h2>
<p class="hint">Add, edit, hide, or delete redeemable shop entries.</p>
<div id="shop"><div class="empty">load to manage the shop.</div></div>
<div class="row" style="margin-top:12px"><button class="load" id="addItem">+ add shop item</button></div>
</section>
<section class="pane" id="pane-chat">
<h2>Chat log</h2>
<p class="hint">The last 500 retained chat lines. Not loaded with the other lists — dump only when you need it. Lines somebody deleted are still here, tagged <b>(deleted)</b> with who did it and when; members never see them again. Clearing wipes every retained message and reaction; accounts, balances and shop items are untouched.</p>
<div class="row" style="margin-bottom:14px"><button class="load" id="dumpChat">dump last 500</button><button class="no" id="clearChat">clear chat log</button></div>
<div id="chatlog"><div class="empty">not loaded. click dump last 500.</div></div>
</section>
<section class="pane" id="pane-dms">
<h2>Direct messages</h2>
<p class="hint">Pick a member, and the second list fills with everybody they actually have a conversation with &mdash; so there is no guessing at pairs and getting an empty answer back. Dumping one is a read and nothing else: no read mark moves, and neither member sees anything happen in their client. Conversations age out after a month of silence, and a long one is shown from its newest end.</p>
<div class="row dmpick">
<select id="dmWho"><option value="">load first, then pick a member&hellip;</option></select>
<select id="dmPeer"><option value="">&hellip;then who they talked to</option></select>
<button class="load" id="dmDump">dump</button>
</div>
<div id="dmout"><div class="empty">nothing dumped yet.</div></div>
</section>
<section class="pane" id="pane-talk">
<h2>Talk to da people</h2>
<p class="hint"><b>general chat</b>, pinned at the top, is the room: what you write there goes to everyone as tung, with his mark, and you can reply to any line. Pick a member instead to write to them as tung in private: it lands in <b>their</b> conversations as a DM from tung, nobody else sees it, and their replies land here. A chat ban still covers a DM.</p>
<div class="talkbox">
<div class="talkrail">
<div class="talkrailhead">the room</div>
<div class="talkroom"><button type="button" class="dmrow talkroomrow" id="talkRoom"><span class="dmtop"><span class="dmname">general chat</span></span><span class="dmlast">speak to everyone as tung</span></button></div>
<div class="talkrailhead">conversations</div>
<div class="talknew"><select id="talkWho"><option value="">load first, then pick somebody&hellip;</option></select></div>
<div id="talklist" class="talklist"></div>
</div>
<div class="talkmain">
<div class="talkhead"><span class="talkname" id="talkname">nobody yet</span><span class="talksub" id="talksub">pick somebody</span></div>
<div id="talklog" class="talklog"><div class="talkempty">his conversations are on the left. pick a member to start one.</div></div>
<div class="talkreply" id="talkreply" hidden><span id="talkreplytext"></span><button type="button" id="talkreplyx" title="don't quote it">&times;</button></div>
<form class="talkform" id="talkform"><input id="talkinput" autocomplete="off" maxlength="1000" placeholder="message them as tung&hellip;" disabled><button class="load" id="talksend" type="submit">send</button></form>
</div>
</div>
</section>
<section class="pane" id="pane-postas">
<h2>Post as&hellip;</h2>
<p class="hint">Drop a message into the chat under an approved member's name. Reply-to is optional: give the id of a message (the chat log shows one under each line) and the quote is filled in from what that message actually says. To speak as <b>tung</b>, use <b>Talk to da people</b> &rarr; general chat.</p>
<div class="field"><label for="paName">post as</label><input id="paName" class="uname" placeholder="username" autocomplete="off"></div>
<div class="field"><label for="paText">message</label><textarea id="paText" class="uname" placeholder="what they said"></textarea></div>
<div class="field"><label for="paReply">reply to (optional message id)</label><input id="paReply" class="uname" placeholder="leave empty for no quote" autocomplete="off"></div>
<div class="row" style="margin-top:12px"><button class="load" id="paSend">post it</button><span id="paMsg" class="hint"></span></div>
</section>
<section class="pane" id="pane-raffles">
<h2>Giveaways</h2>
<p class="hint">Post a giveaway to the room as tung. Members press <b>enter</b> on it — once each, and being first counts for nothing. When the timer runs out the drum picks the winners at random and the prize is split between them; tung announces who won and it is paid straight into their balance. Leave the message blank and tung says one of his own lines. <b>{n}</b> and <b>{w}</b> in a message become the prize and the winners.</p>
<div class="app rfform">
<label class="rflab" for="rfText">message <small>(optional)</small></label>
<textarea id="rfText" maxlength="300" placeholder="leave blank and tung picks one of his lines"></textarea>
<div class="rfgrid">
<label class="rflab">prize, in sahurs<input id="rfAmount" type="number" min="1" step="any" value="100"></label>
<label class="rflab">winners<input id="rfWinners" type="number" min="1" max="50" step="1" value="1"></label>
<label class="rflab">runs for<span class="row"><input id="rfLen" type="number" min="1" step="any" value="10"><select id="rfUnit"><option value="1">minutes</option><option value="60">hours</option><option value="1440">days</option></select></span></label>
</div>
<div class="row" style="margin-top:12px"><button class="load" id="rfPost" type="button">post giveaway</button><span id="rfPreview" class="rfnote"></span></div>
<small id="rfMsg" class="rfnote" style="display:block;margin-top:6px"></small>
</div>
<div class="row" style="margin:18px 0 10px"><h3 style="margin:0;flex:1">posted</h3><button type="button" id="rfRefresh" style="background:#241505;color:#e9d9c2;border:1px solid #3a2410">refresh</button></div>
<div id="rflist"><div class="empty">enter your admin key and open this pane.</div></div>
</section>
<section class="pane" id="pane-veil">
<h2>Web veil</h2>
<p class="hint">The global half of the veil. "Coming Soon" shows the holding page to everyone; "Live" opens it — but only for members you have also approved individually, on the web-veil line of their card under Manage users. Takes effect immediately — no redeploy.</p>
<div id="veilbox"><div class="empty">enter your admin key and hit load.</div></div>
</section>
<section class="pane" id="pane-maint">
<h2>Maintenance</h2>
<p class="hint">Shuts the shrine to everyone but this panel, so the database stops being read and written. Members get one <b>the shrine is resting</b> screen over the chat, the casino and the pit, with your message on it if you leave one. Their open tabs stop polling and check back twice a minute, then let them back in by themselves when you turn it off. Nothing is lost: accounts, balances and chat are all where they were. Takes effect within half a minute &mdash; no redeploy. This panel keeps working the whole time.</p>
<div id="maintbox"><div class="empty">enter your admin key and hit load.</div></div>
</section>
<section class="pane" id="pane-watch">
<h2>Sahur watch</h2>
<p class="hint">Catches people botting the free sahurs &mdash; the faucet and tung's giveaways. Every claim is logged with when it came, how long after it became available, how the click was made and which network it came from. The rules below read that log each time somebody claims, and anyone they catch lands in <b>review</b>. The rules and every number in them live in the database and are only set here, so reading the site's code on GitHub does not tell anybody where the lines are.</p>
<div class="wtabs"><button type="button" data-wt="review" class="on">review <span id="wqCount"></span></button><button type="button" data-wt="lookup">look someone up</button><button type="button" data-wt="rules">detection rules</button></div>
<div id="wt-review">
<div id="wflags"><div class="empty">load to see who has been caught.</div></div>
</div>
<div id="wt-lookup" style="display:none">
<div class="row" style="margin-bottom:14px"><select id="wWho"><option value="">load first, then pick a member&hellip;</option></select><button class="load" id="wLook" type="button">show their claims</button></div>
</div>
<div id="wt-rules" style="display:none">
<div id="wrules"><div class="empty">load to see the rules.</div></div>
</div>
<div id="wdetail"></div>
</section>
<section class="pane danger" id="pane-danger">
<h2>Wipe data</h2>
<p>Delete every application (pending and approved). Usernames and tokens are wiped; everyone must re-apply, and what they said goes with them &mdash; their chat messages and every DM. Casino balances and shop items are not cleared by this.</p>
<div class="row" style="margin-top:12px"><button class="no" id="clear">clear all applications</button></div>
</section>
</div>
</div>
<script>
var keyEl=document.getElementById("key"),list=document.getElementById("list"),users=document.getElementById("users");
/* Every read goes through here so the key rides in a header, not in the URL.
   A query string would put it in this server's access log on every poll, and
   in the address bar if anyone ever pasted one; a header is written down
   nowhere. Writes already carry it in their body, which is out of the URL for
   the same reason. */
function aget(path){
  return fetch(path,{headers:{"x-admin-key":keyEl.value.trim()},cache:"no-store"});
}
/* the gate hands the key over in memory rather than on the address bar */
if(window.__ADMIN_KEY){
  keyEl.value=window.__ADMIN_KEY;
  try{delete window.__ADMIN_KEY;}catch(e){window.__ADMIN_KEY=null;}
  setTimeout(function(){loadAll();},0);
}
var balances=document.getElementById("balances"),shop=document.getElementById("shop"),chatlog=document.getElementById("chatlog");
var pendingCache=null,usersCache=null,balancesCache=null,pendingErr=null,usersErr=null,balancesErr=null;
var balancesDefault=10;   /* the house loan cap, as the server reports it */
/* A key remembered from last time, for a panel opened without the door in
   front of it. It only ever FILLS AN EMPTY box: the gate above has already
   put the key that just proved itself there, and a stale one left over from
   before the key was rotated must not be allowed to overwrite it — every
   pane would come back "forbidden" on a key the door had just accepted. */
try{if(!keyEl.value){var qk=new URLSearchParams(location.search).get("key");if(qk)keyEl.value=qk;else{var k=localStorage.getItem("shrine-admin-key");if(k)keyEl.value=k;}}}catch(e){}
function loadAll(){refresh();refreshUsers();refreshBalances();refreshShop();refreshVeil();refreshMaint();watchFlags();}
document.getElementById("load").onclick=loadAll;
document.getElementById("dumpChat").onclick=dumpChat;
document.getElementById("clearChat").onclick=function(){
  var key=keyEl.value.trim();
  if(!key){alert("enter your admin key first");return;}
  if(!confirm("Delete the whole chat log? Every retained message and reaction goes. Accounts, balances and shop items are not touched."))return;
  var btn=this;btn.disabled=true;
  fetch("/admin/clearchat",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({key:key})})
    .then(function(r){return r.json();})
    .then(function(d){
      btn.disabled=false;
      if(d.error){alert(d.error);return;}
      chatlog.innerHTML='<div class="empty">chat log cleared ('+d.cleared+' events).</div>';
      setCount("chat",0);
    })
    .catch(function(){btn.disabled=false;alert("could not reach the server.");});
};
var veilbox=document.getElementById("veilbox"),veilCount=document.getElementById("count-veil");
function paintVeil(st){
  veilbox.innerHTML="";
  if(st.error){veilbox.innerHTML='<div class="empty">'+st.error+'</div>';veilCount.textContent="";return;}
  var live=st.live===true, ready=st.configured===true;
  veilCount.textContent=live?"live":"off";
  var card=document.createElement("div");card.className="card";
  var h=document.createElement("b");h.textContent=live?"Live — the veil is open":"Coming Soon — the veil is closed";
  card.appendChild(h);
  var sub=document.createElement("p");sub.className="hint";
  sub.textContent=ready
    ? (live?"Approved members get the destination in a tab; everyone else still gets a holding page.":"Everyone gets the holding page, approved or not.")
    : "PROXY_URL is not set in the environment, so the veil stays closed whatever this says. Set it in the Deploy dashboard first.";
  card.appendChild(sub);
  var row=document.createElement("div");row.className="row";
  var on=document.createElement("button");on.textContent="open the veil";on.className=live?"":"load";on.disabled=live||!ready;
  var off=document.createElement("button");off.textContent="close the veil";off.className="no";off.disabled=!live;
  on.onclick=function(){setVeil(true);};off.onclick=function(){setVeil(false);};
  row.appendChild(on);row.appendChild(off);card.appendChild(row);
  veilbox.appendChild(card);
}
function refreshVeil(){
  var k=keyEl.value.trim();if(!k)return;
  aget("/admin/veil").then(function(r){return r.json();})
    .then(paintVeil).catch(function(){paintVeil({error:"could not reach the server."});});
}
function setVeil(live){
  var k=keyEl.value.trim();if(!k)return;
  fetch("/admin/veil",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({key:k,live:live})})
    .then(function(r){return r.json();}).then(paintVeil)
    .catch(function(){paintVeil({error:"could not reach the server."});});
}
var maintbox=document.getElementById("maintbox"),maintCount=document.getElementById("count-maint"),maintOn=false;
function paintMaint(st){
  maintbox.innerHTML="";
  if(st.error){var e=document.createElement("div");e.className="empty";e.textContent=st.error;maintbox.appendChild(e);maintCount.textContent="";return;}
  var on=maintOn=st.on===true;
  maintCount.textContent=on?"on":"off";
  var card=document.createElement("div");card.className="app";
  var h=document.createElement("h3");h.textContent=on?"On — the shrine is resting":"Off — the shrine is open";
  card.appendChild(h);
  var sub=document.createElement("small");
  sub.textContent=on
    ?"since "+(st.since?new Date(st.since).toLocaleString():"just now")+". members see the resting screen, and nothing they do reaches the database."
    :"members are using the shrine as normal.";
  card.appendChild(sub);
  var lab=document.createElement("label");lab.className="rflab";lab.style.margin="12px 0";lab.textContent="message on the resting screen (optional)";
  var msg=document.createElement("textarea");msg.maxLength=200;msg.placeholder="leave blank for none — e.g. back tonight";msg.value=st.msg||"";
  lab.appendChild(msg);card.appendChild(lab);
  var row=document.createElement("div");row.className="row";
  var bOn=document.createElement("button");bOn.className="load";bOn.textContent=on?"update the message":"turn maintenance on";
  var bOff=document.createElement("button");bOff.className="no";bOff.textContent="turn it off";bOff.disabled=!on;
  bOn.onclick=function(){setMaint(true,msg.value);};
  bOff.onclick=function(){setMaint(false,msg.value);};
  row.appendChild(bOn);row.appendChild(bOff);card.appendChild(row);
  maintbox.appendChild(card);
}
function refreshMaint(){
  if(!keyEl.value.trim())return;
  aget("/admin/maint").then(function(r){return r.json();})
    .then(paintMaint).catch(function(){paintMaint({error:"could not reach the server."});});
}
function setMaint(on,msg){
  if(!keyEl.value.trim())return;
  if(on&&!maintOn&&!confirm("Turn maintenance on? Everyone but this panel is shut out of the shrine until you turn it off."))return;
  apost("/admin/maint",{on:on,msg:msg}).then(paintMaint)
    .catch(function(){paintMaint({error:"could not reach the server."});});
}
document.getElementById("purgeGone").onclick=function(){
  var btn=this,out=document.getElementById("purgeGoneOut");
  if(!keyEl.value.trim()){out.textContent="enter your admin key first.";return;}
  btn.disabled=true;out.textContent="clearing\u2026";
  apost("/admin/purgegone",{}).then(function(d){
    btn.disabled=false;
    if(d.error){out.textContent=d.error;return;}
    out.textContent=d.accounts?("cleared "+d.accounts+" deleted account"+(d.accounts===1?"":"s")+": "+d.conversations+" conversation"+(d.conversations===1?"":"s")+" and "+d.lines+" chat message"+(d.lines===1?"":"s")+"."):"nothing left behind \u2014 it is all clear.";
  }).catch(function(){btn.disabled=false;out.textContent="network error.";});
};
document.getElementById("clear").onclick=function(){
  if(!confirm("Delete ALL applications (pending + approved)? Everyone will have to re-apply."))return;
  fetch("/admin/clear",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({key:keyEl.value.trim()})}).then(function(r){return r.json();}).then(function(d){alert(d.error?d.error:("cleared "+d.cleared+" entries"));loadAll();});
};
function showPane(id){
  var panes=document.querySelectorAll(".pane");
  for(var i=0;i<panes.length;i++) panes[i].classList.toggle("on", panes[i].id==="pane-"+id);
  var btns=document.querySelectorAll(".navbtn");
  for(var j=0;j<btns.length;j++) btns[j].classList.toggle("on", btns[j].getAttribute("data-pane")===id);
  var content=document.querySelector(".content");
  if(content)content.classList.toggle("wide", id==="talk");
  if(content)content.classList.toggle("roomy", id==="watch"||id==="raffles"||id==="tips");
  if(id==="watch")watchOpen();
  if(id==="tips")tipLoad(true);
  if(id==="raffles")rfOpen();else rfStop();
  if(id==="talk")talkOpen();else talkStop();
}
var navBtns=document.querySelectorAll(".navbtn");
document.getElementById("paSend").onclick=postAs;
for(var n=0;n<navBtns.length;n++){
  navBtns[n].onclick=function(){showPane(this.getAttribute("data-pane"));};
}
function qOf(id){var el=document.getElementById(id);return el?el.value.trim().toLowerCase():"";}
function matches(q, parts){
  if(!q) return true;
  for(var i=0;i<parts.length;i++){
    if(String(parts[i]==null?"":parts[i]).toLowerCase().indexOf(q)>=0) return true;
  }
  return false;
}
function setCount(id, n){
  var el=document.getElementById("count-"+id);
  if(el) el.textContent = (n==null || n==="") ? "" : String(n);
}
function bindSearch(id, fn){
  var el=document.getElementById(id);
  if(!el) return;
  el.addEventListener("input", fn);
}
bindSearch("search-pending", function(){renderPending();});
bindSearch("search-users", function(){renderUsers();});
bindSearch("search-balances", function(){renderBalances();});
function postAs(){
  var key=keyEl.value.trim();
  var name=document.getElementById("paName").value.trim();
  var text=document.getElementById("paText").value;
  var replyTo=document.getElementById("paReply").value.trim();
  var out=document.getElementById("paMsg");
  if(!name||!text.trim()){out.textContent="need a name and a message.";return;}
  /* tung talks from his own pane now, where he can see the room he is talking to */
  if(/^tung$/i.test(name)){out.textContent="tung speaks from Talk to da people \u2192 general chat now.";return;}
  out.textContent="posting...";
  fetch("/admin/postas",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({key:key,username:name,text:text,replyTo:replyTo})})
    .then(function(r){return r.json();}).then(function(d){
      if(d.error){
        out.textContent=d.error==="no such member"?"no approved member by that name.":
          (d.error==="no such message"?"no message with that id — it may have aged out.":d.error);
        return;
      }
      out.textContent="posted as "+d.username+".";
      document.getElementById("paText").value="";
      document.getElementById("paReply").value="";
    }).catch(function(){out.textContent="network error.";});
}

/* "(deleted)", and by whom and when where that is known */
function delLabel(by,author,at){
  var who=by?(String(by).toLowerCase()===String(author||"").toLowerCase()?" by its author":" by "+by):"";
  return "(deleted"+who+(at?" \u00b7 "+new Date(at).toLocaleString():"")+")";
}
function dumpChat(){
  var key=keyEl.value.trim();
  chatlog.innerHTML='<div class="empty">loading...</div>';
  aget("/admin/chat").then(function(r){return r.json();}).then(function(d){
    if(d.error){chatlog.innerHTML='<div class="empty">'+d.error+' — check your key.</div>';setCount("chat","");return;}
    var msgs=d.messages||[];
    setCount("chat", msgs.length);
    if(!msgs.length){chatlog.innerHTML='<div class="empty">no chat messages retained.</div>';return;}
    chatlog.innerHTML="";
    msgs.forEach(function(m){
      var el=document.createElement("div");el.className="app";
      var h=document.createElement("h3");h.textContent=m.name||"";
      if(m.from==="tung"){var tg=document.createElement("span");tg.className="tungtag";tg.textContent="the shrine";h.appendChild(tg);el.classList.add("tungline");}
      if(m.ts){var tm=document.createElement("span");tm.className="when";tm.textContent=" · "+new Date(m.ts).toLocaleString();h.appendChild(tm);}
      /* deleted in the room, kept here: members never see it again */
      if(m.deleted){var dt=document.createElement("span");dt.className="deltag";dt.textContent=delLabel(m.deletedBy,m.name,m.deletedAt);h.appendChild(dt);el.classList.add("deleted");}
      el.appendChild(h);
      if(m.reply&&m.reply.text){
        var rp=document.createElement("small");rp.textContent="reply to "+(m.reply.name||"")+" — "+m.reply.text;el.appendChild(rp);
      }
      var p=document.createElement("p");p.textContent=m.text||"";el.appendChild(p);
      var s=document.createElement("small");s.textContent="seq "+m.seq+" · id "+m.id;el.appendChild(s);
      chatlog.appendChild(el);
    });
  }).catch(function(){chatlog.innerHTML='<div class="empty">network error.</div>';});
}
function refresh(){
  var key=keyEl.value.trim();try{localStorage.setItem("shrine-admin-key",key);}catch(e){}
  list.innerHTML='<div class="empty">loading...</div>';
  aget("/admin/pending").then(function(r){return r.json();}).then(function(d){
    if(d.error){pendingCache=null;pendingErr=d.error;renderPending();return;}
    pendingErr=null;pendingCache=d.pending||[];renderPending();
  }).catch(function(){pendingCache=null;pendingErr="network error.";renderPending();});
}
function renderPending(){
  setCount("pending", pendingCache?pendingCache.length:"");
  if(pendingErr){list.innerHTML='<div class="empty">'+pendingErr+' — check your key.</div>';return;}
  if(!pendingCache){list.innerHTML='<div class="empty">enter your admin key and hit load.</div>';return;}
  var q=qOf("search-pending");
  var shown=pendingCache.filter(function(a){
    var thread=(a.thread||[]).map(function(m){return m.text||"";});
    return matches(q, [a.username, a.id, a.application].concat(thread));
  });
  if(!pendingCache.length){list.innerHTML='<div class="empty">no pending applications.</div>';return;}
  if(!shown.length){list.innerHTML='<div class="empty">no matching applications.</div>';return;}
  list.innerHTML="";
  shown.forEach(function(a){
    var el=document.createElement("div");el.className="app";
    var h=document.createElement("h3");h.textContent=a.username;el.appendChild(h);
    var p=document.createElement("p");p.textContent=a.application;el.appendChild(p);
    var s=document.createElement("small");s.textContent="id "+a.id+" · "+new Date(a.ts).toLocaleString();el.appendChild(s);
    var row=document.createElement("div");row.className="row";row.style.marginTop="10px";
    var ok=document.createElement("button");ok.className="ok";ok.textContent="approve";ok.onclick=function(){decide(a.id,"approve");};
    var no=document.createElement("button");no.className="no";no.textContent="reject";no.onclick=function(){decide(a.id,"reject");};
    /* the third verdict. rejecting leaves them able to apply again; this does
       not: the account is banned as well, and the shrine renders nothing at all
       for the token in their browser. asked twice because it is meant to be
       used rarely and cannot be undone by them. */
    var go=document.createElement("button");go.className="no";go.textContent="send him to tung";
    go.style.marginLeft="auto";
    go.onclick=function(){
      if(!confirm("send "+a.username+" to tung?\\n\\nthey are rejected and banned, and the site goes blank for them. only approving them again undoes it."))return;
      decide(a.id,"banish");
    };
    row.appendChild(ok);row.appendChild(no);row.appendChild(go);el.appendChild(row);
    if((a.thread||[]).length){
      var th=document.createElement("div");th.className="thread";
      a.thread.forEach(function(m){
        var b=document.createElement("div");b.className="tmsg "+(m.from==="admin"?"admin":"applicant");
        var tw=document.createElement("div");tw.className="twhen";
        tw.textContent=(m.from==="admin"?"tung":a.username)+(m.ts?" · "+new Date(m.ts).toLocaleString():"");
        var tx=document.createElement("div");tx.textContent=m.text;
        b.appendChild(tw);b.appendChild(tx);
        th.appendChild(b);
      });
      el.appendChild(th);
    }
    var mrow=document.createElement("div");mrow.className="row";mrow.style.marginTop="8px";
    var mi=document.createElement("input");mi.className="uname";mi.placeholder="ask a follow-up question…";mi.maxLength=1000;
    var mb=document.createElement("button");mb.className="load";mb.textContent="send";
    mb.onclick=function(){var t=mi.value.trim();if(!t)return;mi.value="";sendMsg(a.id,t);};
    mi.addEventListener("keydown",function(ev){if(ev.key==="Enter"){ev.preventDefault();mb.onclick();}});
    mrow.appendChild(mi);mrow.appendChild(mb);el.appendChild(mrow);
    list.appendChild(el);
  });
}
function decide(id,action){
  fetch("/admin/decide",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({key:keyEl.value.trim(),id:id,action:action})}).then(function(r){return r.json();}).then(function(){refresh();refreshUsers();});
}
function sendMsg(id,text){
  fetch("/admin/message",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({key:keyEl.value.trim(),id:id,text:text})}).then(function(r){return r.json();}).then(function(d){if(d.error)alert(d.error);refresh();});
}
function toLocalInput(ms){var d=new Date(ms - new Date(ms).getTimezoneOffset()*60000);return d.toISOString().slice(0,16);}
function refreshUsers(){
  var key=keyEl.value.trim();
  users.innerHTML='<div class="empty">loading...</div>';
  aget("/admin/users").then(function(r){return r.json();}).then(function(d){
    if(d.error){usersCache=null;usersErr=d.error;renderUsers();return;}
    usersErr=null;usersCache=d.users||[];renderUsers();
  }).catch(function(){usersCache=null;usersErr="network error.";renderUsers();});
}
function renderUsers(){
  setCount("users", usersCache?usersCache.length:"");
  dmFillUsers();   /* the DM pane picks its member out of this same list */
  if(usersErr){users.innerHTML='<div class="empty">'+usersErr+' — check your key.</div>';return;}
  if(!usersCache){users.innerHTML='<div class="empty">load to see approved users.</div>';return;}
  var q=qOf("search-users");
  var shown=usersCache.filter(function(u){
    var st=u.banned?"banned":(u.timeoutUntil&&u.timeoutUntil>Date.now()?"timeout timed out":"active");
    var cst=u.chatBanned?"chatban chat banned chat-banned":"chat open";
    return matches(q, [u.username, u.id, u.note||"", st, cst, u.veil?"veil approved":"veil not approved", u.mod?"mod moderator":"not a moderator"]);
  });
  if(!usersCache.length){users.innerHTML='<div class="empty">no approved users yet.</div>';return;}
  if(!shown.length){users.innerHTML='<div class="empty">no matching users.</div>';return;}
  users.innerHTML="";
  shown.forEach(function(u){
    var el=document.createElement("div");el.className="app";
    var row=document.createElement("div");row.className="row";
    var inp=document.createElement("input");inp.className="uname";inp.value=u.username;inp.maxLength=24;
    var save=document.createElement("button");save.className="load";save.textContent="save name";
    save.onclick=function(){rename(u.id,inp.value.trim());};
    var ban=document.createElement("button");
    if(u.banned){ban.className="ok";ban.textContent="unban";ban.onclick=function(){setBan(u.id,false);};}
    else{ban.className="no";ban.textContent="ban";ban.onclick=function(){setBan(u.id,true);};}
    var rev=document.createElement("button");rev.className="load";rev.textContent="re-review";rev.title="send back to the application screen to ask follow-up questions";
    rev.onclick=function(){repend(u.id,u.username);};
    var del=document.createElement("button");del.className="no";del.textContent="delete";del.title="remove the user entirely (frees the username)";
    del.onclick=function(){deleteUser(u.id,u.username);};
    row.appendChild(inp);row.appendChild(save);row.appendChild(rev);row.appendChild(ban);row.appendChild(del);
    el.appendChild(row);
    /* a timeout, and what they read while it lasts — the same two things the
       sahur watch's timeout gives: the words typed here sit under the lockout's
       own line as "tung says: ...", and "farming sahurs" makes the whole screen
       sahur's catch. the line under it shows exactly what they will see. */
    var live=u.timeoutUntil&&u.timeoutUntil>Date.now();
    var trow=document.createElement("div");trow.className="row";
    var dt=document.createElement("input");dt.type="datetime-local";dt.className="tin";
    if(live)dt.value=toLocalInput(u.timeoutUntil);
    var hrs=document.createElement("input");hrs.type="number";hrs.min="0";hrs.step="any";hrs.className="thrs";hrs.placeholder="hours";
    var apply=document.createElement("button");apply.className="no";apply.textContent="time out";
    var clr=document.createElement("button");clr.className="load";clr.textContent="clear timeout";
    clr.onclick=function(){setTimeoutUntil(u.id,0);};
    var tl1=document.createElement("small");tl1.className="tlab";tl1.textContent="time out until";
    var tl2=document.createElement("small");tl2.className="tlab";tl2.textContent="or for";
    var tl3=document.createElement("small");tl3.className="tlab";tl3.textContent="hours";
    trow.appendChild(tl1);trow.appendChild(dt);trow.appendChild(tl2);trow.appendChild(hrs);trow.appendChild(tl3);trow.appendChild(apply);trow.appendChild(clr);
    el.appendChild(trow);
    var wrow=document.createElement("div");wrow.className="row";
    var wl=document.createElement("small");wl.className="tlab";wl.textContent="message on their lockout";
    var why=document.createElement("input");why.className="uname twhy";why.maxLength=200;why.placeholder="optional words from tung";
    if(live)why.value=u.timeoutWhy||"";
    var sahL=document.createElement("label");sahL.className="tsah";sahL.title="the lockout says sahur caught them, in his own words";
    var sah=document.createElement("input");sah.type="checkbox";sah.checked=!!(live&&u.timeoutKind==="sahur");
    sahL.appendChild(sah);sahL.appendChild(document.createTextNode(" farming sahurs"));
    wrow.appendChild(wl);wrow.appendChild(why);wrow.appendChild(sahL);
    el.appendChild(wrow);
    var prev=document.createElement("small");prev.className="tprev";el.appendChild(prev);
    function until(){var h=Number(hrs.value);if(h>0)return Date.now()+h*3600000;return dt.value?new Date(dt.value).getTime():0;}
    function paintPrev(){
      var w=why.value.trim(),t=until();
      prev.textContent="they will see: \u201c"+(sah.checked?"sahur caught you":"you are timed out")+"\u201d \u2014 "+
        (sah.checked?"a line from sahur about hands and altars":"the whole shrine is shut to you until it lifts")+
        (w?" \u2014 tung says: \u201c"+w+"\u201d":"")+(t>Date.now()?" \u2014 until "+new Date(t).toLocaleString():"");
    }
    hrs.oninput=function(){var h=Number(hrs.value);if(h>0)dt.value=toLocalInput(Date.now()+h*3600000);paintPrev();};
    dt.oninput=function(){hrs.value="";paintPrev();};
    why.oninput=paintPrev;sah.onchange=paintPrev;paintPrev();
    apply.onclick=function(){var ms=until();if(!ms){alert("pick a date/time, or a number of hours");return;}if(!(ms>Date.now())){alert("pick a time in the future");return;}setTimeoutUntil(u.id,ms,why.value.trim(),sah.checked?"sahur":"");};
    // the narrow ban: shuts the room and leaves the rest of the shrine alone.
    // deliberately its own row and its own wording so it is never mistaken for
    // the full ban sitting one row above it.
    var crow=document.createElement("div");crow.className="row";
    var clab=document.createElement("small");clab.className=u.chatBanned?"vlab rev":"vlab";
    clab.textContent=u.chatBanned?"chat: banned (casino + games still open)":"chat: open";
    var cbtn=document.createElement("button");
    if(u.chatBanned){cbtn.className="ok";cbtn.textContent="restore chat access";cbtn.title="let them back into the chat";cbtn.onclick=function(){setChatBan(u.id,false);};}
    else{cbtn.className="no";cbtn.textContent="ban from chat";cbtn.title="chat only — they can no longer read it or post in it, but the casino, games, shop and veil keep working";cbtn.onclick=function(){setChatBan(u.id,true,u.username);};}
    crow.appendChild(clab);crow.appendChild(cbtn);
    el.appendChild(crow);
    // moderator powers: they can delete any chat message. nothing about this
    // shows in the room — no badge, no mark — so only this pane and their own
    // client ever know. see POST /delete in server.ts.
    var mrow=document.createElement("div");mrow.className="row";
    var mlab=document.createElement("small");mlab.className="vlab";
    mlab.textContent=u.mod?"moderator: can delete any chat message":"moderator: no";
    var mbtn=document.createElement("button");
    if(u.mod){mbtn.className="no";mbtn.textContent="revoke moderator";mbtn.title="take the bin away again";mbtn.onclick=function(){setMod(u.id,false);};}
    else{mbtn.className="ok";mbtn.textContent="make moderator";mbtn.title="a bin appears next to react and reply on every chat message, for them only. nobody in the room can tell they have it.";mbtn.onclick=function(){setMod(u.id,true,u.username);};}
    mrow.appendChild(mlab);mrow.appendChild(mbtn);
    el.appendChild(mrow);
    var vrow=document.createElement("div");vrow.className="row";
    var vlab=document.createElement("small");vlab.className="vlab";
    vlab.textContent=u.veil?"web veil: approved":"web veil: not approved";
    if(!u.veil)vlab.className="vlab rev";
    var vbtn=document.createElement("button");
    if(u.veil){vbtn.className="no";vbtn.textContent="revoke veil access";vbtn.onclick=function(){setVeilUser(u.id,false);};}
    else{vbtn.className="ok";vbtn.textContent="approve for veil";vbtn.onclick=function(){setVeilUser(u.id,true);};}
    vrow.appendChild(vlab);vrow.appendChild(vbtn);
    el.appendChild(vrow);
    /* the way back in for somebody who lost their key. it is the account, so
       it is never on screen until it is asked for, and the button says what it
       is handing over rather than calling it a lookup. */
    var krow=document.createElement("div");krow.className="row";
    var klab=document.createElement("small");klab.className="vlab";klab.textContent="login key: hidden";
    var kbtn=document.createElement("button");kbtn.className="load";kbtn.textContent="show login key";
    kbtn.title="reveals the key that IS this account — anyone holding it can log in as them";
    kbtn.onclick=function(){showToken(u.id,u.username,klab,kbtn,krow);};
    krow.appendChild(klab);krow.appendChild(kbtn);
    el.appendChild(krow);
    var nrow=document.createElement("div");nrow.className="row";
    var note=document.createElement("input");note.className="uname";note.placeholder="private note (admin only)";note.value=u.note||"";note.maxLength=500;
    var nsave=document.createElement("button");nsave.className="load";nsave.textContent="save note";
    nsave.onclick=function(){saveNote(u.id,note.value.trim());};
    nrow.appendChild(note);nrow.appendChild(nsave);
    el.appendChild(nrow);
    var meta=document.createElement("small");
    var idline=" · id "+u.id;
    var cbline=u.chatBanned?" · chat banned":"";
    var modline=u.mod?" · moderator":"";
    if(u.banned){meta.textContent="banned (permanent)"+cbline+modline+idline;meta.className="rev";}
    else if(u.timeoutUntil&&u.timeoutUntil>Date.now()){meta.textContent="timed out until "+new Date(u.timeoutUntil).toLocaleString()+(u.timeoutKind==="sahur"?" · sahur caught them":"")+(u.timeoutWhy?" · \u201c"+u.timeoutWhy+"\u201d":"")+cbline+modline+idline;meta.className="rev";}
    else if(u.chatBanned){meta.textContent="chat banned · everything else open · joined "+new Date(u.ts).toLocaleString()+modline+idline;meta.className="rev";}
    else{meta.textContent="active · joined "+new Date(u.ts).toLocaleString()+modline+idline;}
    el.appendChild(meta);
    users.appendChild(el);
  });
}
function rename(id,name){
  if(!name)return;
  fetch("/admin/rename",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({key:keyEl.value.trim(),id:id,username:name})}).then(function(r){return r.json();}).then(function(d){if(d.error)alert(d.error);refreshUsers();});
}
/* Fetch and show one member's login key. POST, so the id never reaches a URL —
   the same reason the admin key rides a header on every read. The key is put in
   a readonly input rather than written into the page so it can be selected and
   copied without being re-rendered away by the next refresh, and hiding it
   again empties the field rather than leaving it in the DOM. */
function showToken(id,name,lab,btn,row){
  if(btn.dataset.shown==="1"){
    var old=row.querySelector(".tokbox");if(old)old.remove();
    var oc=row.querySelector(".tokcopy");if(oc)oc.remove();
    btn.dataset.shown="";btn.textContent="show login key";lab.textContent="login key: hidden";lab.className="vlab";
    return;
  }
  if(!confirm("Show "+name+"'s login key?\\n\\nThe key IS the account — anyone holding it can log in as them. Only do this to give it back to them."))return;
  btn.disabled=true;
  fetch("/admin/token",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({key:keyEl.value.trim(),id:id})})
    .then(function(r){return r.json();})
    .then(function(d){
      btn.disabled=false;
      if(d.error){alert(d.error);return;}
      if(!d.tokens||!d.tokens.length){lab.textContent="login key: none on file — they have never applied";lab.className="vlab rev";return;}
      var box=document.createElement("input");box.className="uname tokbox";box.readOnly=true;box.value=d.tokens.join("  ");
      box.onclick=function(){this.select();};
      var copy=document.createElement("button");copy.className="load tokcopy";copy.textContent="copy";
      copy.onclick=function(){box.select();try{document.execCommand("copy");copy.textContent="copied";setTimeout(function(){copy.textContent="copy";},1200);}catch(e){}};
      row.appendChild(box);row.appendChild(copy);
      lab.textContent=d.tokens.length>1?("login key: "+d.tokens.length+" on file"):"login key:";
      lab.className="vlab";
      btn.dataset.shown="1";btn.textContent="hide";
    })
    .catch(function(){btn.disabled=false;alert("could not reach the server");});
}
function setBan(id,banned){
  fetch("/admin/ban",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({key:keyEl.value.trim(),id:id,banned:banned})}).then(function(r){return r.json();}).then(function(d){if(d.error)alert(d.error);refreshUsers();});
}
function setChatBan(id,chatBanned,name){
  if(chatBanned&&!confirm("Ban "+name+" from the chat?\\n\\nThey will not be able to read the chat or post in it. The casino, the pit, the games, the shop and the veil stay open to them. This is not the full ban."))return;
  fetch("/admin/chatban",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({key:keyEl.value.trim(),id:id,chatBanned:chatBanned})}).then(function(r){return r.json();}).then(function(d){if(d.error)alert(d.error);refreshUsers();});
}
function setMod(id,mod,name){
  if(mod&&!confirm("Give "+name+" moderator powers?\\n\\nThey will be able to delete any message in the chat. A bin appears next to react and reply for them only — nobody else in the room can tell they have it."))return;
  fetch("/admin/mod",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({key:keyEl.value.trim(),id:id,mod:mod})}).then(function(r){return r.json();}).then(function(d){if(d.error)alert(d.error);refreshUsers();});
}
function setTimeoutUntil(id,until,why,kind){
  fetch("/admin/timeout",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({key:keyEl.value.trim(),id:id,until:until,why:why||"",kind:kind||""})}).then(function(r){return r.json();}).then(function(d){if(d.error)alert(d.error);refreshUsers();});
}
function setVeilUser(id,allowed){
  fetch("/admin/veiluser",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({key:keyEl.value.trim(),id:id,allowed:allowed})}).then(function(r){return r.json();}).then(function(d){if(d.error)alert(d.error);refreshUsers();});
}
function saveNote(id,note){
  fetch("/admin/note",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({key:keyEl.value.trim(),id:id,note:note})}).then(function(r){return r.json();}).then(function(d){if(d.error)alert(d.error);refreshUsers();});
}
function deleteUser(id,name){
  if(!confirm("Delete "+name+" entirely? This frees the username and deletes everything they said: their chat messages, reactions and every DM they were in, on both sides. It cannot be undone."))return;
  fetch("/admin/delete",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({key:keyEl.value.trim(),id:id})}).then(function(r){return r.json();}).then(function(d){if(d.error)alert(d.error);refreshUsers();refreshBalances();});
}
function repend(id,name){
  if(!confirm("Send "+name+" back to review? They'll return to the application screen where you can ask follow-up questions."))return;
  fetch("/admin/repend",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({key:keyEl.value.trim(),id:id})}).then(function(r){return r.json();}).then(function(d){if(d.error)alert(d.error);refresh();refreshUsers();});
}
function refreshBalances(){
  var key=keyEl.value.trim();
  balances.innerHTML='<div class="empty">loading...</div>';
  aget("/admin/balances").then(function(r){return r.json();}).then(function(d){
    if(d.error){balancesCache=null;balancesErr=d.error;renderBalances();return;}
    balancesErr=null;balancesCache=d.balances||[];balancesDefault=d.loanMaxDefault;renderBalances();
  }).catch(function(){balancesCache=null;balancesErr="network error.";renderBalances();});
}
function renderBalances(){
  setCount("balances", balancesCache?balancesCache.length:"");
  if(balancesErr){balances.innerHTML='<div class="empty">'+balancesErr+' — check your key.</div>';return;}
  if(!balancesCache){balances.innerHTML='<div class="empty">load to see player balances.</div>';return;}
  var q=qOf("search-balances");
  var shown=balancesCache.filter(function(u){
    return matches(q, [u.username, u.id, String(u.balance), (u.balance!=null?Number(u.balance).toFixed(2):"")+" sahurs",
      u.owed>0?"owes debt loan in the red":"clear no debt", "cap "+u.loanMax,
      u.loanBoost>0?("one-off one time boost +"+u.loanBoost):"no one-off",
      /* the private note is searchable from here but never drawn here: it is
         written and read on the user pane, and showing it twice would put it
         on screen in front of people who only came to look at the money */
      u.note||""]);
  });
  if(!balancesCache.length){balances.innerHTML='<div class="empty">no balances yet (nobody has claimed sahurs).</div>';return;}
  if(!shown.length){balances.innerHTML='<div class="empty">no matching balances.</div>';return;}
  balances.innerHTML="";
  shown.forEach(function(u){
    var el=document.createElement("div");el.className="app";
    var row=document.createElement("div");row.className="row";
    var name=document.createElement("h3");name.style.flex="1";name.style.margin="0";name.textContent=u.username;
    var bal=document.createElement("small");bal.textContent=u.balance.toFixed(2)+" sahurs";bal.style.color="#f2c063";bal.style.fontWeight="700";
    row.appendChild(name);row.appendChild(bal);el.appendChild(row);
    var idline=document.createElement("small");idline.textContent="id "+u.id;el.appendChild(idline);
    var srow=document.createElement("div");srow.className="row";srow.style.marginTop="8px";
    var inp=document.createElement("input");inp.type="number";inp.min="0";inp.step="0.01";inp.className="tin";inp.placeholder="new balance";inp.value=u.balance.toFixed(2);inp.style.flex="0 1 160px";
    var set=document.createElement("button");set.className="no";set.textContent="set balance";
    set.onclick=function(){setBalance(u.id,u.username,inp.value);};
    srow.appendChild(inp);srow.appendChild(set);el.appendChild(srow);
    // the bank: what they still owe, and the most it will lend them
    var lrow=document.createElement("div");lrow.className="row";lrow.style.marginTop="8px";
    var llab=document.createElement("small");llab.className="vlab";
    if(u.owed>0){llab.className="vlab rev";llab.textContent="owes the bank "+Number(u.owed).toFixed(2)+" sahurs";}
    else llab.textContent="owes the bank nothing";
    var debt=document.createElement("input");debt.type="number";debt.min="0";debt.step="0.01";debt.className="tin";
    debt.placeholder="owed";debt.style.flex="0 1 120px";debt.value=Number(u.owed||0).toFixed(2);
    var dsave=document.createElement("button");dsave.className="no";dsave.textContent="set debt";
    dsave.title="write the debt directly \u2014 no interest is added, and 0 wipes it";
    dsave.onclick=function(){setDebt(u.id,u.username,debt.value);};
    var cap=document.createElement("input");cap.type="number";cap.min="0";cap.step="0.01";cap.className="tin";
    cap.placeholder="cap ("+(balancesDefault||10)+" default)";cap.style.flex="0 1 150px";
    if(u.loanMaxSet)cap.value=Number(u.loanMax).toFixed(2);
    var csave=document.createElement("button");csave.className="load";csave.textContent="set loan cap";
    csave.onclick=function(){setLoanMax(u.id,u.username,cap.value);};
    var cclr=document.createElement("button");cclr.className="load";cclr.textContent="default";
    cclr.title="put them back on the house default";
    cclr.onclick=function(){setLoanMax(u.id,u.username,null);};
    lrow.appendChild(llab);lrow.appendChild(debt);lrow.appendChild(dsave);
    lrow.appendChild(cap);lrow.appendChild(csave);lrow.appendChild(cclr);
    el.appendChild(lrow);
    // the other kind of raise. "set loan cap" above is permanent — it is their
    // cap until it is set again. this one sits on top of that cap and is spent
    // by the next loan they take, whatever its size, so a favour stays a favour.
    var brow=document.createElement("div");brow.className="row";brow.style.marginTop="8px";
    var blab=document.createElement("small");blab.className="vlab";
    if(u.loanBoost>0){
      blab.className="vlab";
      blab.textContent="one-off: +"+Number(u.loanBoost).toFixed(2)+" waiting \u2014 next loan may reach "
        +Number(u.loanLimit).toFixed(2)+", then back to "+Number(u.loanMax).toFixed(2);
    }else{
      blab.textContent="one-off: none \u2014 the cap above is all they get";
    }
    var boost=document.createElement("input");boost.type="number";boost.min="0";boost.step="0.01";boost.className="tin";
    boost.placeholder="extra, this once";boost.style.flex="0 1 150px";
    if(u.loanBoost>0)boost.value=Number(u.loanBoost).toFixed(2);
    var bsave=document.createElement("button");bsave.className="ok";bsave.textContent="grant one-time";
    bsave.title="on top of their cap, and spent the moment they borrow \u2014 their cap does not move";
    bsave.onclick=function(){setLoanBoost(u.id,u.username,boost.value);};
    var bclr=document.createElement("button");bclr.className="load";bclr.textContent="take back";
    bclr.title="remove an unspent one-off";
    bclr.onclick=function(){setLoanBoost(u.id,u.username,0);};
    brow.appendChild(blab);brow.appendChild(boost);brow.appendChild(bsave);brow.appendChild(bclr);
    el.appendChild(brow);
    balances.appendChild(el);
  });
}
function setDebt(id,name,val){
  var owed=Number(val);
  if(!(owed>=0)){alert("a debt is 0 or more");return;}
  if(owed===0&&!confirm("Wipe "+name+"'s debt to the bank entirely?"))return;
  fetch("/admin/setdebt",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({key:keyEl.value.trim(),id:id,owed:owed})})
    .then(function(r){return r.json();}).then(function(d){if(d.error)alert(d.error);refreshBalances();});
}
function setLoanMax(id,name,val){
  var body={key:keyEl.value.trim(),id:id,max:(val===null||String(val).trim()==="")?null:Number(val)};
  if(body.max!==null&&!(body.max>=0)){alert("a cap is 0 or more, or blank for the default");return;}
  fetch("/admin/loanmax",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)})
    .then(function(r){return r.json();}).then(function(d){if(d.error)alert(d.error);refreshBalances();});
}
function setLoanBoost(id,name,val){
  var extra=(val===null||String(val).trim()==="")?0:Number(val);
  if(!(extra>=0)){alert("a one-off is 0 or more, or blank to take it back");return;}
  if(extra>0&&!confirm("Let "+name+" borrow "+extra.toFixed(2)+" sahurs over their cap, once?\\n\\nIt sits on top of their cap until they take a loan, then it is gone \u2014 however much of it they used. Their cap does not change."))return;
  fetch("/admin/loanboost",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({key:keyEl.value.trim(),id:id,extra:extra})})
    .then(function(r){return r.json();}).then(function(d){if(d.error)alert(d.error);refreshBalances();});
}
function setBalance(id,name,val){
  var b=Number(val);
  if(!(b>=0)){alert("balance must be 0 or more");return;}
  if(!confirm("Set "+name+"'s balance to "+b.toFixed(2)+" sahurs?"))return;
  fetch("/admin/setbal",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({key:keyEl.value.trim(),id:id,balance:b})}).then(function(r){return r.json();}).then(function(d){if(d.error){alert(d.error);return;}refreshBalances();});
}
function refreshShop(){
  var key=keyEl.value.trim();
  shop.innerHTML='<div class="empty">loading...</div>';
  // the registry first: every card's dropdown is built from it
  loadThemes().then(function(){
  aget("/admin/shop").then(function(r){return r.json();}).then(function(d){
    if(d.error){shop.innerHTML='<div class="empty">'+d.error+' — check your key.</div>';setCount("shop","");return;}
    shop.innerHTML="";
    setCount("shop", (d.items||[]).length);
    if(!d.items.length){shop.innerHTML='<div class="empty">no shop items yet. hit “add shop item”.</div>';return;}
    d.items.forEach(function(it){shop.appendChild(itemCard(it));});
  }).catch(function(){shop.innerHTML='<div class="empty">network error.</div>';});
  });
}
var THEME_LIST=[];
function loadThemes(){
  var key=keyEl.value.trim();
  return aget("/admin/themes").then(function(r){return r.json();})
    .then(function(d){ if(d && d.themes) THEME_LIST=d.themes.filter(function(t){return !t.free;}); })
    .catch(function(){});
}
function itemCard(it){
  it=it||{name:"",desc:"",price:0,active:true,inputLabel:"",output:"",theme:""};
  var el=document.createElement("div");el.className="app";
  var r1=document.createElement("div");r1.className="row";
  var name=document.createElement("input");name.className="uname";name.placeholder="item name";name.value=it.name||"";name.maxLength=60;
  var price=document.createElement("input");price.type="number";price.min="0";price.step="0.1";price.className="tin";price.placeholder="price";price.value=(it.price!=null?it.price:"");price.style.flex="0 1 120px";
  r1.appendChild(name);r1.appendChild(price);el.appendChild(r1);
  var r2=document.createElement("div");r2.className="row";
  var desc=document.createElement("input");desc.className="uname";desc.placeholder="description (optional)";desc.value=it.desc||"";desc.maxLength=200;
  r2.appendChild(desc);el.appendChild(r2);
  var r2b=document.createElement("div");r2b.className="row";
  var inputLabel=document.createElement("input");inputLabel.className="uname";inputLabel.placeholder="ask the buyer for… (optional, e.g. your Discord tag)";inputLabel.value=it.inputLabel||"";inputLabel.maxLength=80;
  r2b.appendChild(inputLabel);el.appendChild(r2b);
  var r2c=document.createElement("div");r2c.className="row";
  var output=document.createElement("textarea");output.className="uname";output.placeholder="shown to them after they redeem (optional, e.g. a code)";output.value=it.output||"";output.maxLength=1000;output.rows=3;
  r2c.appendChild(output);el.appendChild(r2c);
  // what this item unlocks. The list is the shrine's own theme registry, so a
  // theme added to the code shows up here and nowhere else until it is sold.
  var r2d=document.createElement("div");r2d.className="row";
  var tlab=document.createElement("label");tlab.style.cssText="display:flex;align-items:center;gap:8px;color:#e9d9c2;font-size:14px;flex:1";
  tlab.appendChild(document.createTextNode("unlocks theme"));
  var theme=document.createElement("select");theme.className="uname";theme.style.flex="1";
  var none=document.createElement("option");none.value="";none.textContent="— nothing, an ordinary item —";theme.appendChild(none);
  THEME_LIST.forEach(function(t){
    var o=document.createElement("option");o.value=t.id;o.textContent=t.name+"  ("+t.id+")";theme.appendChild(o);
  });
  theme.value=it.theme||"";
  // an unknown/removed theme would silently reset the dropdown to "nothing",
  // so keep it visible rather than letting a save wipe it
  if((it.theme||"")&&theme.value!==it.theme){
    var o2=document.createElement("option");o2.value=it.theme;o2.textContent=it.theme+" (not in the registry)";
    theme.appendChild(o2);theme.value=it.theme;
  }
  tlab.appendChild(theme);r2d.appendChild(tlab);el.appendChild(r2d);
  var r3=document.createElement("div");r3.className="row";
  var lab=document.createElement("label");lab.style.cssText="display:flex;align-items:center;gap:6px;color:#e9d9c2;font-size:14px";
  var chk=document.createElement("input");chk.type="checkbox";chk.checked=it.active!==false;chk.style.flex="0";
  lab.appendChild(chk);lab.appendChild(document.createTextNode("visible in shop"));
  var save=document.createElement("button");save.className="load";save.textContent=it.id?"save":"create";
  save.onclick=function(){saveItem(it.id,name.value.trim(),desc.value.trim(),price.value,chk.checked,inputLabel.value.trim(),output.value,el,theme.value);};
  r3.appendChild(lab);r3.appendChild(save);
  if(it.id){var del=document.createElement("button");del.className="no";del.textContent="delete";del.onclick=function(){deleteItem(it.id,it.name);};r3.appendChild(del);}
  el.appendChild(r3);
  return el;
}
function saveItem(id,name,desc,price,active,inputLabel,output,card,theme){
  if(!name){alert("item needs a name");return;}
  if(!(Number(price)>=0)){alert("price must be 0 or more");return;}
  fetch("/admin/shop/set",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({key:keyEl.value.trim(),id:id||"",name:name,desc:desc,price:Number(price),active:active,inputLabel:inputLabel,output:output,theme:theme||""})}).then(function(r){return r.json();}).then(function(d){if(d.error){alert(d.error);return;}refreshShop();});
}
function deleteItem(id,name){
  if(!confirm("Delete shop item: "+name+" ?"))return;
  fetch("/admin/shop/delete",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({key:keyEl.value.trim(),id:id})}).then(function(r){return r.json();}).then(function(d){if(d.error){alert(d.error);return;}refreshShop();});
}
document.getElementById("addItem").onclick=function(){
  if(!keyEl.value.trim()){alert("enter your admin key first");return;}
  loadThemes().then(function(){
    var ph=shop.querySelector(".empty");if(ph)ph.remove();
    shop.appendChild(itemCard(null));
  });
};
/* ---------------------------------------------------------------------------
   Direct messages.

   Two dropdowns, and the second is filled from the first rather than from the
   member list: the pairs that exist are a much shorter list than every pair
   that could, and picking out of it means a dump always has something in it.

   Both calls are POSTs. Every read in this panel goes through aget() so the
   key travels in a header instead of a query string, and these would need a
   member id in the query on top of that; a body keeps the pair out of the
   address bar and out of any log in between for the same reason the key is
   kept out of them.

   Message text is written with textContent and a text node, never innerHTML.
   It is the one thing on this page that members wrote themselves. */
var dmWho=document.getElementById("dmWho"),dmPeer=document.getElementById("dmPeer"),dmout=document.getElementById("dmout");
/* a real newline, built rather than written. This whole page is a template
   literal on the server, so a backslash-n typed into the source is already a
   line break by the time it arrives here, and a line break inside a string
   literal is where the script stops parsing. */
var NL=String.fromCharCode(10);
function apost(path,body){
  body.key=keyEl.value.trim();
  return fetch(path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}).then(function(r){return r.json();});
}
function dmOption(sel,value,label){
  var o=document.createElement("option");o.value=value;o.textContent=label;sel.appendChild(o);return o;
}
function dmFillUsers(){
  if(!dmWho)return;
  var prev=dmWho.value;
  dmWho.innerHTML="";
  dmOption(dmWho,"",usersCache?"pick a member\u2026":"load first, then pick a member\u2026");
  (usersCache||[]).forEach(function(u){dmOption(dmWho,u.id,u.username);});
  if(prev)dmWho.value=prev;
  talkFillUsers();
  watchFillUsers();
  tipFillUsers();
}
function dmSetPeers(msg){
  if(!dmPeer)return;
  dmPeer.innerHTML="";
  dmOption(dmPeer,"",msg);
}
function dmLoadPeers(){
  setCount("dms","");
  var id=dmWho.value;
  if(!id){dmSetPeers("\u2026then who they talked to");return;}
  if(!keyEl.value.trim()){dmSetPeers("enter your admin key first");return;}
  dmSetPeers("looking\u2026");
  apost("/admin/dm/peers",{id:id}).then(function(d){
    if(d.error){dmSetPeers(d.error);return;}
    var ps=d.peers||[];
    setCount("dms",ps.length);
    if(!ps.length){dmSetPeers("no conversations for "+d.name);return;}
    dmSetPeers(ps.length===1?"1 conversation \u2014 pick it":ps.length+" conversations \u2014 pick one");
    ps.forEach(function(pp){
      var when=pp.ts?" \u00b7 "+new Date(pp.ts).toLocaleString():"";
      dmOption(dmPeer,pp.id,pp.name+" \u2014 "+pp.seq+(pp.seq===1?" line":" lines")+when);
    });
  }).catch(function(){dmSetPeers("network error.");});
}
function dmWhoseName(d,from){return from===d.a.id?d.a.name:d.b.name;}
function dmPaintThread(d){
  dmout.innerHTML="";
  var head=document.createElement("div");head.className="app";
  var h=document.createElement("h3");h.textContent=d.a.name+" \u2194 "+d.b.name;head.appendChild(h);
  var bits=d.count+(d.count===1?" line":" lines");
  var gone=(d.msgs||[]).filter(function(m){return m.deleted;}).length;
  if(gone)bits+=" ("+gone+" deleted)";
  if(d.truncated)bits+=" \u2014 the newest kept, older ones not shown";
  if(d.blockedBy&&d.blockedBy.length){
    bits+=" \u00b7 blocked by "+d.blockedBy.map(function(id){return dmWhoseName(d,id);}).join(" and ");
  }
  var s=document.createElement("small");s.textContent=bits;head.appendChild(s);
  dmout.appendChild(head);
  if(!d.count){
    var e=document.createElement("div");e.className="empty";
    e.textContent="nothing is left in this conversation \u2014 lines age out after a month of silence.";
    dmout.appendChild(e);return;
  }
  var thread=document.createElement("div");thread.className="thread";
  d.msgs.forEach(function(m){
    var row=document.createElement("div");
    row.className="tmsg "+(m.from===d.a.id?"dmfrom":"dmto")+(m.deleted?" deleted":"");
    var w=document.createElement("span");w.className="twhen";
    w.textContent=dmWhoseName(d,m.from)+" \u00b7 "+new Date(m.ts).toLocaleString();
    /* taken back by whoever wrote it — a DM line is only ever deleted by its author */
    if(m.deleted){var dt=document.createElement("span");dt.className="deltag";dt.textContent=delLabel("",null,m.deletedAt);w.appendChild(dt);}
    row.appendChild(w);
    row.appendChild(document.createTextNode(m.text||""));
    thread.appendChild(row);
  });
  dmout.appendChild(thread);
  var lab=document.createElement("p");lab.className="hint";lab.style.margin="14px 0 0";
  lab.textContent="the same thing as plain text \u2014 select all and copy:";
  dmout.appendChild(lab);
  var ta=document.createElement("textarea");ta.id="dmtext";ta.readOnly=true;
  ta.value=d.msgs.map(function(m){
    return "["+new Date(m.ts).toISOString()+"] "+dmWhoseName(d,m.from)+(m.deleted?" (deleted)":"")+": "+(m.text||"");
  }).join(NL);
  dmout.appendChild(ta);
}
function dmDumpThread(){
  if(!keyEl.value.trim()){alert("enter your admin key first");return;}
  var a=dmWho.value,b=dmPeer.value;
  if(!a){alert("pick a member first");return;}
  if(!b){alert("pick somebody they have talked to");return;}
  dmout.innerHTML='<div class="empty">loading...</div>';
  apost("/admin/dm/thread",{user:a,peer:b}).then(function(d){
    if(d.error==="gone"){dmout.innerHTML='<div class="empty">that account was deleted, so the conversation has been cleared.</div>';dmLoadPeers();return;}
    if(d.error){dmout.innerHTML='<div class="empty">'+d.error+' \u2014 check your key.</div>';return;}
    dmPaintThread(d);
  }).catch(function(){dmout.innerHTML='<div class="empty">network error.</div>';});
}
if(dmWho)dmWho.onchange=function(){dmSetPeers("looking\u2026");dmLoadPeers();};
if(dmPeer)dmPeer.onchange=function(){if(dmWho.value&&dmPeer.value)dmDumpThread();};
document.getElementById("dmDump").onclick=dmDumpThread;
/* ---------------------------------------------------------------------------
   Talk to da people.

   The same shape as the shrine's own DM menu: a rail of conversations, one
   thread, one composer. Every line sent from here is his, and it is drawn
   the way a DM client draws your own lines: on the right. The member's are
   on the left. None of the room's proclamation styling — the full-width
   gold bar, "the shrine" — belongs here; that is how he talks to everyone.

   The face is the file the shrine ships. This page is served by the API,
   which does not host the repo, so the portrait is the same bytes from the
   pages host the embed already uses. If that host is quiet the gold name
   still reads; the image is the only part that can fail closed. */
var TUNG_FACE="https://cdn.jsdelivr.net/gh/kanyewest50000/offline-learning@main/assets/tungtungtungsahur.png";
var talkWho=document.getElementById("talkWho"),talklist=document.getElementById("talklist");
var talklog=document.getElementById("talklog"),talkname=document.getElementById("talkname"),talksub=document.getElementById("talksub");
var talkinput=document.getElementById("talkinput"),talkform=document.getElementById("talkform");
var talksend=document.getElementById("talksend");
var talkUser=null,talkConvs=null,talkSig="",talkListSig="",talkRun=0,talkT=null,talkListT=null,talkSending=0,talkClosed=false,talkReason=null;
function talkStop(){
  talkRun++;
  if(talkT){clearTimeout(talkT);talkT=null;}
  if(talkListT){clearInterval(talkListT);talkListT=null;}
}
function talkFillUsers(){
  if(!talkWho)return;
  var prev=talkWho.value;
  talkWho.innerHTML="";
  dmOption(talkWho,"",usersCache?"message somebody\u2026":"load first, then pick somebody\u2026");
  (usersCache||[]).forEach(function(u){dmOption(talkWho,u.id,u.username);});
  if(prev)talkWho.value=prev;
  else if(talkUser&&!talkUser.room)talkWho.value=talkUser.id;
}
function talkFace(w,name){
  w.className="who tung";
  var ti=document.createElement("img");ti.className="tungimg";ti.alt="";ti.src=TUNG_FACE;
  ti.onerror=function(){ti.style.display="none";};
  w.appendChild(ti);
  var tn=document.createElement("span");tn.textContent=name||"tung";w.appendChild(tn);
}
/* one line of the conversation, drawn the way any DM client draws one: his
   (yours, from this seat) on the right, theirs on the left */
function talkLine(m,theirName){
  var isT=m.from==="tung";
  var row=document.createElement("div");row.className=(isT?"msg me":"msg")+(m.deleted?" deleted":"");
  var meta=document.createElement("div");meta.className="meta";
  if(isT)talkFace(meta.appendChild(document.createElement("span")),"tung");
  else{var w=document.createElement("span");w.className="who";w.textContent=theirName||"";meta.appendChild(w);}
  if(m.ts){var tm=document.createElement("span");tm.className="when";tm.textContent=new Date(m.ts).toLocaleString();meta.appendChild(tm);}
  if(m.deleted){var dt=document.createElement("span");dt.className="deltag";dt.textContent="(deleted)";meta.appendChild(dt);}
  row.appendChild(meta);
  var bd=document.createElement("span");bd.className="body";bd.textContent=m.text||"";row.appendChild(bd);
  return row;
}
function talkWhy(reason){
  if(reason==="blocked")return "they blocked this conversation.";
  if(reason==="chatban")return "banned from the chat. a chat ban covers this too.";
  if(reason==="banned")return "banned from the shrine.";
  if(reason==="timeout")return "timed out. this stays shut until it lifts.";
  if(reason==="gone")return "that account is gone.";
  if(reason==="closed")return "this conversation is closed.";
  if(reason==="empty")return "write something first.";
  if(reason==="not found")return "no such member.";
  if(reason==="forbidden")return "that key is not his.";
  if(reason==="busy")return "the shrine was busy. try again.";
  return reason?String(reason):"that did not send.";
}
function talkPreview(c){
  if(c.closed&&c.byThem)return "blocked";
  if(c.closed)return "closed";
  return c.last||"";
}
function talkPaintList(convs){
  if(!talklist)return;
  var rows=convs||[];
  var listSig=rows.map(function(c){return c.id+"/"+c.unread+"/"+(c.last||"")+"/"+(c.closed?1:0)+"/"+c.name;}).join("|")+(talkUser?"#"+talkUser.id:"");
  if(listSig===talkListSig&&talklist.childNodes.length)return;
  talkListSig=listSig;
  if(talkRoomBtn)talkRoomBtn.classList.toggle("on",talkIsRoom());
  talklist.innerHTML="";
  var seen=false;
  rows.forEach(function(c){
    if(talkUser&&c.id===talkUser.id)seen=true;
    talklist.appendChild(talkRow(c));
  });
  if(talkUser&&!talkUser.room&&!seen){
    talklist.insertBefore(talkRow({id:talkUser.id,name:talkUser.name,last:"",unread:0,closed:false}),talklist.firstChild);
  }
  if(!rows.length&&!talkUser){
    var e=document.createElement("div");e.className="dmempty";
    e.textContent=talkConvs?"no conversations yet. pick a member above.":"loading\u2026";
    talklist.appendChild(e);
  }
}
function talkRow(c){
  var b=document.createElement("button");b.type="button";
  b.className="dmrow"+(talkUser&&talkUser.id===c.id?" on":"")+(c.unread>0?" unread":"");
  var top=document.createElement("span");top.className="dmtop";
  var n=document.createElement("span");n.className="dmname";n.textContent=c.name||"";top.appendChild(n);
  if(c.unread>0){var u=document.createElement("span");u.className="dmbadge";u.textContent=c.unread>99?"99+":String(c.unread);top.appendChild(u);}
  b.appendChild(top);
  var l=document.createElement("span");l.className="dmlast";l.textContent=talkPreview(c);b.appendChild(l);
  b.addEventListener("click",function(){talkOpenUser(c.id,c.name);});
  return b;
}
function talkAdd(m){
  var empty=talklog.querySelector(".talkempty");if(empty)empty.remove();
  talklog.appendChild(talkLine(m,talkUser&&talkUser.name));
  talklog.scrollTop=talklog.scrollHeight;
}
function talkPaintThread(d){
  var sig=(d.msgs||[]).map(function(m){return m.seq;}).join(",")+"|"+(d.reason||"");
  var atBottom=talklog.scrollHeight-talklog.scrollTop-talklog.clientHeight<90;
  var fresh=!talkSig;
  if(talkUser&&d.user&&d.user.name){talkUser.name=d.user.name;talkname.textContent=d.user.name;}
  talkClosed=!!d.closed;
  talkReason=d.reason||null;
  talkinput.disabled=!!d.closed;
  if(talksend)talksend.disabled=!!d.closed;
  talksub.textContent=d.closed?talkWhy(d.reason):(d.truncated?"as tung \u2014 the newest lines":"as tung \u00b7 only the two of you");
  if(sig===talkSig)return;
  talkSig=sig;
  talklog.innerHTML="";
  if(!d.msgs||!d.msgs.length){
    var e=document.createElement("div");e.className="talkempty";
    e.textContent=d.closed?talkWhy(d.reason):"nothing here yet. the first line is his.";
    talklog.appendChild(e);
  }else{
    d.msgs.forEach(function(m){talklog.appendChild(talkLine(m,d.user&&d.user.name));});
  }
  if(fresh||atBottom)talklog.scrollTop=talklog.scrollHeight;
}
function talkFetchList(){
  var run=talkRun;
  if(!keyEl.value.trim()){talkListSig="";talklist.innerHTML='<div class="dmempty">enter your admin key first.</div>';return;}
  apost("/admin/talk/list",{}).then(function(d){
    if(run!==talkRun)return;
    if(d.error){talkListSig="";talklist.innerHTML="";var e=document.createElement("div");e.className="dmempty";e.textContent=talkWhy(d.error);talklist.appendChild(e);setCount("talk","");return;}
    talkConvs=d.convs||[];
    setCount("talk",talkConvs.length);
    talkPaintList(talkConvs);
  }).catch(function(){if(run===talkRun){talkListSig="";talklist.innerHTML='<div class="dmempty">network error.</div>';}});
}
function talkArm(){if(talkT)clearTimeout(talkT);talkT=setTimeout(talkPoll,2500);}
function talkPoll(){
  if(talkSending){talkT=setTimeout(talkPoll,400);return;}
  if(!talkUser)return;
  if(talkUser.room){roomFetch();return;}
  talkFetchThread(true);
}
function talkFetchThread(silent){
  var who=talkUser,run=talkRun;
  if(!who)return;
  if(!keyEl.value.trim()){talksub.textContent="enter your admin key first.";return;}
  apost("/admin/talk/thread",{user:who.id}).then(function(d){
    if(run!==talkRun||!talkUser||talkUser.id!==who.id)return;
    if(d.error){if(!silent){talklog.innerHTML="";var e=document.createElement("div");e.className="talkempty";e.textContent=talkWhy(d.error);talklog.appendChild(e);}talksub.textContent=talkWhy(d.error);talkArm();return;}
    talkPaintThread(d);
    // opening a thread is what reads it, so the badge on its row goes now
    // rather than at the next pass of the list
    if(talkConvs&&talkConvs.some(function(c){return c.id===who.id&&c.unread>0;}))talkFetchList();
    talkArm();
  }).catch(function(){if(run===talkRun){talksub.textContent="network error.";talkArm();}});
}
function talkOpenUser(id,name){
  if(!id)return;
  talkUser={id:id,name:name||""};
  talkReply(null);
  talkinput.placeholder="message them as tung\u2026";
  talkSig="";
  talkListSig="";
  talkClosed=false;
  if(talkWho&&talkWho.value!==id)talkWho.value=id;
  talkname.textContent=talkUser.name||"\u2026";
  talksub.textContent="as tung";
  talkReason=null;
  talkinput.disabled=false;
  if(talksend)talksend.disabled=false;
  talklog.innerHTML='<div class="talkempty">loading\u2026</div>';
  talkPaintList(talkConvs||[]);
  if(talkT){clearTimeout(talkT);talkT=null;}
  talkFetchThread(false);
}
function talkSend(){
  if(!talkUser){talksub.textContent="pick somebody first.";return;}
  if(talkUser.room){roomSend();return;}
  var text=talkinput.value.trim();
  if(!text)return;
  if(talkClosed){talksub.textContent=talkWhy(talkReason||"closed");return;}
  var who=talkUser;
  talkinput.value="";
  talkSending++;
  talkAdd({from:"tung",text:text,ts:Date.now()});
  talksub.textContent="sending\u2026";
  apost("/admin/talk/send",{user:who.id,text:text}).then(function(d){
    talkSending--;
    if(!talkUser||talkUser.id!==who.id)return;
    if(d.error){talkSig="";talksub.textContent=talkWhy(d.error==="closed"?(d.reason||"closed"):d.error);talkFetchThread(false);return;}
    talkSig="";
    talkFetchThread(true);
    talkFetchList();
  }).catch(function(){talkSending--;if(talkUser&&talkUser.id===who.id)talksub.textContent="network error.";});
}
function talkOpen(){
  talkStop();
  talkFetchList();
  talkListT=setInterval(function(){talkFetchList();},8000);
  if(talkUser&&talkUser.room)roomFetch();
  else if(talkUser)talkFetchThread(true);
}
if(talkWho)talkWho.onchange=function(){
  var id=talkWho.value;if(!id)return;
  var label=talkWho.options[talkWho.selectedIndex];
  talkOpenUser(id,label?label.textContent:"");
};
if(talkform)talkform.addEventListener("submit",function(ev){ev.preventDefault();talkSend();});
/* ---- general chat: the room, from his seat ----
   Everybody's lines on the left under their names, his on the right, and what
   he writes goes to everyone with his mark (it is /admin/postas as tung, the
   same line a Wisdom is). The whole retained log is read once when it opens;
   after that each pass asks only for what landed after the newest line it
   holds (?since=), which is usually nothing, every three seconds, and only
   while this pane and this conversation are open and the tab is in view. */
var talkRoomBtn=document.getElementById("talkRoom"),talkreply=document.getElementById("talkreply");
var talkreplytext=document.getElementById("talkreplytext"),talkReplyTo=null;
var roomCursor=0,roomLoaded=false,roomLines={};
function talkIsRoom(){return !!(talkUser&&talkUser.room);}
function talkReply(m){
  talkReplyTo=m||null;
  if(!talkreply)return;
  talkreply.hidden=!talkReplyTo;
  if(talkReplyTo){talkreplytext.textContent="replying to "+(m.name||"")+": "+String(m.text||"").slice(0,140);talkinput.focus();}
}
if(document.getElementById("talkreplyx"))document.getElementById("talkreplyx").onclick=function(){talkReply(null);};
function roomLine(m){
  var isT=m.from==="tung";
  var row=document.createElement("div");row.className=(isT?"msg me":"msg")+(m.deleted?" deleted":"");
  var meta=document.createElement("div");meta.className="meta";
  if(isT)talkFace(meta.appendChild(document.createElement("span")),m.name||"tung");
  else{var w=document.createElement("span");w.className="who";w.textContent=m.name||"";meta.appendChild(w);}
  if(m.ts){var tm=document.createElement("span");tm.className="when";tm.textContent=new Date(m.ts).toLocaleString();meta.appendChild(tm);}
  if(m.gift&&m.gift.amount){var gt=document.createElement("span");gt.className="talkgift";gt.textContent="giveaway \u00b7 "+m.gift.amount+" sahurs";meta.appendChild(gt);}
  if(m.raffle&&m.raffle.amount){var rt=document.createElement("span");rt.className="talkgift";rt.textContent="giveaway \u00b7 "+m.raffle.amount+" sahurs \u00b7 "+m.raffle.winners+(m.raffle.winners===1?" winner":" winners")+" \u00b7 ends "+new Date(m.raffle.endsAt).toLocaleTimeString();meta.appendChild(rt);}
  if(m.deleted){var dt=document.createElement("span");dt.className="deltag";dt.textContent="(deleted)";meta.appendChild(dt);}
  else if(String(m.id).indexOf("pending-")!==0){
    var rb=document.createElement("button");rb.type="button";rb.className="talkrb";rb.textContent="reply";
    rb.onclick=function(){talkReply(m);};meta.appendChild(rb);
  }
  row.appendChild(meta);
  if(m.reply&&m.reply.name){var q=document.createElement("span");q.className="talkquote";q.textContent=m.reply.name+": "+(m.reply.text||"");row.appendChild(q);}
  var bd=document.createElement("span");bd.className="body";bd.textContent=m.text||"";row.appendChild(bd);
  row._m=m;
  return row;
}
/* one line in, or the newer copy of one already shown (a delete, or the real
   line replacing the one drawn while it was sending) */
function roomAdd(m){
  if(!m||!m.id)return;
  var empty=talklog.querySelector(".talkempty");if(empty)empty.remove();
  var row=roomLine(m),old=roomLines[m.id];
  if(old&&old.parentNode)old.parentNode.replaceChild(row,old);else talklog.appendChild(row);
  roomLines[m.id]=row;
  while(talklog.childNodes.length>600){var f=talklog.firstChild;if(f._m)delete roomLines[f._m.id];talklog.removeChild(f);}
}
function roomDel(id){var r=roomLines[id];if(!r||!r._m||r._m.deleted)return;var m=r._m;m.deleted=true;roomAdd(m);}
function roomArm(){if(talkT)clearTimeout(talkT);talkT=setTimeout(talkPoll,document.hidden?9000:3000);}
function roomFetch(){
  var who=talkUser,run=talkRun;
  if(!who||!who.room)return;
  if(document.hidden&&roomLoaded){roomArm();return;}
  if(!keyEl.value.trim()){talksub.textContent="enter your admin key first.";return;}
  aget("/admin/chat"+(roomLoaded?"?since="+roomCursor:"")).then(function(r){return r.json();}).then(function(d){
    if(run!==talkRun||talkUser!==who)return;
    if(d.error){talksub.textContent=talkWhy(d.error);roomArm();return;}
    var first=!roomLoaded,atBottom=talklog.scrollHeight-talklog.scrollTop-talklog.clientHeight<90;
    if(first){talklog.innerHTML="";roomLines={};}
    (d.messages||[]).forEach(roomAdd);
    (d.dels||[]).forEach(roomDel);
    if(typeof d.cursor==="number"&&d.cursor>roomCursor)roomCursor=d.cursor;
    roomLoaded=true;
    if(first&&!talklog.childNodes.length){var e=document.createElement("div");e.className="talkempty";e.textContent="nobody has said anything yet. the first line can be his.";talklog.appendChild(e);}
    if(first||atBottom)talklog.scrollTop=talklog.scrollHeight;
    roomArm();
  }).catch(function(){if(run===talkRun&&talkUser===who){talksub.textContent="network error.";roomArm();}});
}
function talkOpenRoom(){
  talkUser={id:"#room",name:"general chat",room:true};
  talkSig="";talkListSig="";talkClosed=false;talkReason=null;
  roomCursor=0;roomLoaded=false;roomLines={};
  if(talkWho)talkWho.value="";
  talkname.textContent="general chat";
  talksub.textContent="as tung \u00b7 everyone in the room sees this";
  talkinput.disabled=false;talkinput.placeholder="say it to the room as tung\u2026";
  if(talksend)talksend.disabled=false;
  talkReply(null);
  talklog.innerHTML='<div class="talkempty">loading\u2026</div>';
  talkPaintList(talkConvs||[]);
  if(talkT){clearTimeout(talkT);talkT=null;}
  roomFetch();
}
if(talkRoomBtn)talkRoomBtn.addEventListener("click",talkOpenRoom);
function roomSend(){
  var text=talkinput.value.trim();
  if(!text)return;
  var who=talkUser,rep=talkReplyTo;
  talkinput.value="";talkReply(null);
  talkSending++;
  var tmp={id:"pending-"+Date.now(),name:"tung",from:"tung",text:text,ts:Date.now(),
    reply:rep?{name:rep.name,text:String(rep.text||"").slice(0,140)}:null};
  roomAdd(tmp);talklog.scrollTop=talklog.scrollHeight;
  talksub.textContent="sending\u2026";
  apost("/admin/postas",{username:"tung",text:text,replyTo:rep?rep.id:""}).then(function(d){
    talkSending--;
    var row=roomLines[tmp.id];delete roomLines[tmp.id];
    if(talkUser!==who)return;
    if(d.error){
      if(row&&row.parentNode)row.parentNode.removeChild(row);
      talkinput.value=text;talkReply(rep);
      talksub.textContent=d.error==="no such message"?"that line has gone, so it cannot be quoted.":talkWhy(d.error);
      return;
    }
    /* the real line (with the server's clock) replaces this one when it lands */
    if(row){if(roomLines[d.id]){if(row.parentNode)row.parentNode.removeChild(row);}else{tmp.id=d.id;roomLines[d.id]=row;}}
    talksub.textContent="as tung \u00b7 everyone in the room sees this";
    roomFetch();
  }).catch(function(){
    talkSending--;
    var row=roomLines[tmp.id];delete roomLines[tmp.id];if(row&&row.parentNode)row.parentNode.removeChild(row);
    if(talkUser===who){talkinput.value=text;talkReply(rep);talksub.textContent="network error.";}
  });
}
/* ---------------------------------------------------------------------------
   Sahur watch.

   The review queue (who the rules caught, and what they saw), one member's
   claims laid out so a script stands out at a glance — a person's week has
   holes in it where they slept, a script's does not — and what to do about
   it. The rules and their numbers are edited here and kept server-side. */
var wflagsEl=document.getElementById("wflags"),wrulesEl=document.getElementById("wrules");
var wdetail=document.getElementById("wdetail"),wWho=document.getElementById("wWho");
var WATCH={names:{},flags:null,cfg:null,defaults:null,sel:null};
function wEl(tag,cls,txt){var e=document.createElement(tag);if(cls)e.className=cls;if(txt!=null)e.textContent=txt;return e;}
function wWhen(t){return t?new Date(t).toLocaleString():"";}
function wAgo(ms){var s=Math.round(Math.abs(ms)/1000);if(s<90)return s+"s";if(s<5400)return Math.round(s/60)+"m";if(s<172800)return (Math.round(s/360)/10)+"h";return Math.round(s/86400)+"d";}
function wNum(v){var i=document.createElement("input");i.type="number";i.step="any";i.min="0";i.value=v;return i;}
function wBox(on){var b=document.createElement("input");b.type="checkbox";b.checked=!!on;return b;}
function wLine(parent,parts){var l=document.createElement("label");parts.forEach(function(p){l.appendChild(typeof p==="string"?document.createTextNode(p):p);});parent.appendChild(l);return l;}
function wMsg(parent,t){parent.innerHTML="";parent.appendChild(wEl("div","empty",t));}
function watchTab(t){
  ["review","lookup","rules"].forEach(function(k){document.getElementById("wt-"+k).style.display=k===t?"":"none";});
  var bs=document.querySelectorAll(".wtabs button");
  for(var i=0;i<bs.length;i++)bs[i].classList.toggle("on",bs[i].getAttribute("data-wt")===t);
  wdetail.style.display=t==="rules"?"none":"";
  if(t==="rules")watchRules();
}
(function(){var bs=document.querySelectorAll(".wtabs button");for(var i=0;i<bs.length;i++)bs[i].onclick=function(){watchTab(this.getAttribute("data-wt"));};})();
function watchOpen(){watchFlags();if(!WATCH.cfg)watchConfigLoad(null);}
function watchFillUsers(){
  if(!wWho)return;var prev=wWho.value;wWho.innerHTML="";
  dmOption(wWho,"",usersCache?"pick a member…":"load first, then pick a member…");
  (usersCache||[]).forEach(function(u){dmOption(wWho,u.id,u.username);});
  if(prev)wWho.value=prev;
}
document.getElementById("wLook").onclick=function(){if(wWho.value)watchUser(wWho.value);};
if(wWho)wWho.onchange=function(){if(wWho.value)watchUser(wWho.value);};

/* ---- the review queue ---- */
function watchFlags(){
  if(!keyEl.value.trim())return;
  apost("/admin/watch/flags",{}).then(function(d){
    if(d.error){wMsg(wflagsEl,d.error+" — check your key.");setCount("watch","");return;}
    WATCH.names=d.names||WATCH.names;WATCH.flags=d;
    setCount("watch",d.open.length||"");
    var qc=document.getElementById("wqCount");if(qc)qc.textContent=d.open.length?"("+d.open.length+")":"";
    paintFlags();
  }).catch(function(){wMsg(wflagsEl,"network error.");});
}
function hitList(hits){
  var ul=wEl("ul","whits");
  (hits||[]).forEach(function(h){var li=wEl("li");li.appendChild(wEl("b",null,(WATCH.names[h.rule]||h.rule)+": "));li.appendChild(document.createTextNode(h.detail));ul.appendChild(li);});
  return ul;
}
function flagCard(f,open){
  var c=wEl("div","app wflag"+(WATCH.sel===f.uid?" sel":""));
  var h=wEl("h3",null,f.name);
  h.appendChild(wEl("span","wchip "+(open?"open":"closed"),open?"waiting for review":"decided"));
  h.appendChild(wEl("span","when",open
    ?"caught "+wWhen(f.at)+(f.lastAt&&f.lastAt!==f.at?" · still tripping "+wWhen(f.lastAt):"")
    :wWhen(f.closedAt)));
  c.appendChild(h);
  if(open)c.appendChild(hitList(f.hits));else c.appendChild(wEl("small",null,f.verdict||""));
  c.onclick=function(){watchUser(f.uid);};
  return c;
}
function paintFlags(){
  var d=WATCH.flags;if(!d)return;wflagsEl.innerHTML="";
  if(!d.open.length)wflagsEl.appendChild(wEl("div","empty","nobody is waiting for review."));
  d.open.forEach(function(f){wflagsEl.appendChild(flagCard(f,true));});
  if(d.closed.length){
    var h=wEl("h3",null,"recent verdicts");h.style.cssText="margin:18px 0 8px;font-size:14px;color:#c8823c";wflagsEl.appendChild(h);
    d.closed.slice(0,12).forEach(function(f){wflagsEl.appendChild(flagCard(f,false));});
  }
}

/* ---- one member ---- */
function watchUser(id){
  WATCH.sel=id;paintFlags();
  wMsg(wdetail,"loading their claims…");
  apost("/admin/watch/user",{id:id}).then(function(d){
    if(d.error){wMsg(wdetail,d.error);return;}
    WATCH.names=d.names||WATCH.names;paintDetail(d);
    try{wdetail.scrollIntoView({behavior:"smooth",block:"start"});}catch(e){}
  }).catch(function(){wMsg(wdetail,"network error.");});
}
function paintDetail(d){
  wdetail.innerHTML="";
  var now=Date.now(),logs=d.logs||[],day=86400000;
  var fau=logs.filter(function(l){return l.kind==="faucet";}),gif=logs.filter(function(l){return l.kind==="gift";});
  var card=wEl("div","app"),h=wEl("h3",null,d.name);
  if(d.flag&&d.flag.status==="open")h.appendChild(wEl("span","wchip open","waiting for review"));
  var penal=d.now.banned||d.now.reducePct<100||d.now.slowX>1;
  if(penal)h.appendChild(wEl("span","wchip pen","under a penalty"));
  h.appendChild(wEl("span","when","balance "+d.balance+" sahurs"));
  card.appendChild(h);
  var lags=fau.filter(function(l){return typeof l.lag==="number";}).map(function(l){return l.lag;}).sort(function(a,b){return a-b;});
  var glags=gif.filter(function(l){return typeof l.lag==="number";}).map(function(l){return l.lag;});
  var stats=[
    [fau.filter(function(l){return l.ts>now-day;}).length,"faucet claims, 24h"],
    [fau.filter(function(l){return l.ts>now-7*day;}).length,"faucet claims, 7 days"],
    [Math.round(logs.filter(function(l){return l.ts>now-7*day;}).reduce(function(a,l){return a+(Number(l.amt)||0);},0)*100)/100,"sahurs claimed, 7 days"],
    [gif.filter(function(l){return l.ts>now-7*day;}).length,"giveaways won, 7 days"],
    [lags.length?wAgo(lags[Math.floor(lags.length/2)]):"—","typical wait after ready"],
    [glags.length?Math.min.apply(null,glags)+"ms":"—","fastest giveaway"]
  ];
  var st=wEl("div","wstats");
  stats.forEach(function(p){var b=wEl("div","wstat");b.appendChild(wEl("b",null,String(p[0])));b.appendChild(wEl("span",null,p[1]));st.appendChild(b);});
  card.appendChild(st);
  card.appendChild(wEl("small",null,d.hits.length?"what the rules see in everything logged, right now:":"nothing trips the rules on everything logged, right now."));
  if(d.hits.length)card.appendChild(hitList(d.hits));
  var bits=[];
  if(d.now.banned)bits.push("barred from claiming until "+wWhen(d.now.banUntil)+(d.now.banGifts?" (giveaways too)":" (faucet only)"));
  if(d.now.reducePct<100)bits.push("claims pay "+d.now.reducePct+"% until "+wWhen(d.now.reduceUntil));
  if(d.now.slowX>1)bits.push("cooldown ×"+d.now.slowX+" until "+wWhen(d.now.slowUntil));
  var pen=wEl("div","row");pen.style.marginTop="10px";
  pen.appendChild(wEl("span","wmuted",bits.length?"penalty: "+bits.join("; ")+(d.penalty&&d.penalty.note?" — "+d.penalty.note:""):"no penalty on them."));
  if(bits.length){
    var lift=wEl("button","no","lift the penalty");lift.type="button";
    lift.onclick=function(){if(!confirm("Lift every claim penalty on "+d.name+"?"))return;apost("/admin/watch/lift",{id:d.id}).then(function(){watchUser(d.id);});};
    pen.appendChild(lift);
  }
  card.appendChild(pen);
  wdetail.appendChild(card);
  wdetail.appendChild(watchTimeline(logs));
  wdetail.appendChild(watchPunish(d));
  wdetail.appendChild(watchNets(d));
  wdetail.appendChild(watchLog(d));
}
/* a week, one row a day, a dot for every claim at the hour it was made */
function watchTimeline(logs){
  var c=wEl("div","app");c.appendChild(wEl("h3",null,"the last 7 days, hour by hour"));
  c.appendChild(wEl("small",null,"gold: faucet · blue: giveaways · hover a dot for the details. a person's week has gaps where they slept; a script's does not."));
  var tl=wEl("div","wtl"),d0=new Date();d0.setHours(0,0,0,0);
  for(var i=0;i<7;i++){
    var start=d0.getTime()-i*86400000,end=start+86400000,row=wEl("div","wtlrow");
    row.appendChild(wEl("span","wtlday",i===0?"today":new Date(start).toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric"})));
    var bar=wEl("div","wtlbar");
    logs.forEach(function(l){
      if(l.ts<start||l.ts>=end)return;
      var dot=wEl("i",l.kind==="gift"?"g":null);dot.style.left=((l.ts-start)/86400000*100)+"%";
      dot.title=new Date(l.ts).toLocaleTimeString()+" · "+(l.kind==="gift"?"giveaway":"faucet")+
        (typeof l.lag==="number"?" · "+(l.kind==="gift"?l.lag+"ms after it appeared":wAgo(l.lag)+" after it was ready"):"");
      bar.appendChild(dot);
    });
    row.appendChild(bar);tl.appendChild(row);
  }
  var hrs=wEl("div","wtlhours");["00","03","06","09","12","15","18","21","24"].forEach(function(x){hrs.appendChild(wEl("span",null,x));});
  tl.appendChild(hrs);c.appendChild(tl);return c;
}
function watchNets(d){
  var c=wEl("div","app");c.appendChild(wEl("h3",null,"networks they claimed from"));
  if(!d.nets.length){c.appendChild(wEl("small",null,"no claims logged yet."));return c;}
  d.nets.forEach(function(n){
    var r=wEl("p");r.style.margin="4px 0";
    r.textContent="network "+n.net+" — "+n.claims+" of their claims"+(n.others.length?" · also claimed from by: "+n.others.join(", ")+(n.more?" and "+n.more+" more":""):" · nobody else claimed from it");
    c.appendChild(r);
  });
  c.appendChild(wEl("small",null,"a network is a scrambled tag, never an address. a school puts many people on one network, so several names here is not proof on its own."));
  return c;
}
/* every claim, newest first, with the numbers the rules read */
function watchLog(d){
  var c=wEl("div","app");c.appendChild(wEl("h3",null,"every claim they made ("+d.logs.length+")"));
  if(!d.logs.length){c.appendChild(wEl("small",null,"nothing logged. claims are kept for as many days as the rules say."));return c;}
  var qs=(WATCH.cfg?WATCH.cfg.rules.quick.seconds:90)*1000,gm=WATCH.cfg?WATCH.cfg.rules.giftfast.ms:1500;
  var sm=(WATCH.cfg&&WATCH.cfg.rules.still?WATCH.cfg.rules.still.seconds:600)*1000;
  var wrap=wEl("div","wlogwrap"),t=wEl("table","wtable"),thead=document.createElement("thead"),hd=wEl("tr");
  ["when","what","got","after ready","since last","click","tab","still before","network"].forEach(function(x){hd.appendChild(wEl("th",null,x));});
  thead.appendChild(hd);t.appendChild(thead);
  var tb=document.createElement("tbody"),lastF=null,rows=[];
  d.logs.forEach(function(l){var gap=null;if(l.kind==="faucet"){if(lastF)gap=l.ts-lastF;lastF=l.ts;}rows.push([l,gap]);});
  rows.reverse().forEach(function(p){
    var l=p[0],gap=p[1],cli=l.cli,tr=wEl("tr"),lag=typeof l.lag==="number";
    tr.appendChild(wEl("td",null,wWhen(l.ts)));
    tr.appendChild(wEl("td",null,l.kind==="gift"?"giveaway":"faucet"));
    tr.appendChild(wEl("td",null,String(l.amt)));
    tr.appendChild(wEl("td",lag&&(l.kind==="gift"?l.lag<=gm:l.lag<=qs)?"bad":null,lag?(l.kind==="gift"?l.lag+"ms":wAgo(l.lag)):"—"));
    tr.appendChild(wEl("td",null,gap===null?"—":wAgo(gap)));
    tr.appendChild(wEl("td",cli&&cli.tr===1?"good":"bad",cli?(cli.tr===1?"real":"scripted"):"none sent"));
    tr.appendChild(wEl("td",cli&&cli.vis===0?"bad":null,cli?(cli.vis===1?"visible":"hidden"):"—"));
    tr.appendChild(wEl("td",cli&&typeof cli.idle==="number"&&cli.idle>=sm?"bad":null,cli&&typeof cli.idle==="number"?wAgo(cli.idle):"—"));
    tr.appendChild(wEl("td",null,l.net||"—"));
    tb.appendChild(tr);
  });
  t.appendChild(tb);wrap.appendChild(t);c.appendChild(wrap);return c;
}
/* the verdict. the claim penalties are the watch's own; the site timeout and
   the warning go through the routes those already have */
function watchPunish(d){
  var c=wEl("div","app");c.appendChild(wEl("h3",null,"what to do about "+d.name));
  var f=wEl("div","wpun");
  var banOn=wBox(true),banH=wNum(24),banG=wBox(true);
  wLine(f,[banOn," bar them from claiming for ",banH," hours — ",banG," giveaways too"]);
  var redOn=wBox(false),redP=wNum(50),redD=wNum(7);
  wLine(f,[redOn," pay their claims at ",redP," % for ",redD," days"]);
  var slowOn=wBox(false),slowX=wNum(2),slowD=wNum(7);
  wLine(f,[slowOn," make them wait ×",slowX," as long between faucet claims, for ",slowD," days"]);
  var takeOn=wBox(false),takeD=wNum(7);
  wLine(f,[takeOn," take back every sahur they claimed in the last ",takeD," days"]);
  var toOn=wBox(false),toH=wNum(6),toWhy=document.createElement("input");
  toWhy.maxLength=200;toWhy.placeholder="optional words from tung";toWhy.style.cssText="flex:1;min-width:200px";
  wLine(f,[toOn," time them out of the whole site for ",toH," hours — the lockout says sahur caught them — ",toWhy]);
  var warnOn=wBox(false);wLine(f,[warnOn," warn them as tung, in a DM:"]);
  var warnT=document.createElement("textarea");warnT.value="tung sees the hands that are not hands. claim with your own.";f.appendChild(warnT);
  var noteI=document.createElement("input");noteI.placeholder="a note for yourself — only this page sees it";f.appendChild(noteI);
  var acts=wEl("div","row"),go=wEl("button","no","punish"),dis=wEl("button","ok","not a bot — dismiss"),qd=wNum(WATCH.cfg?WATCH.cfg.quietDays:3);
  go.type="button";dis.type="button";
  acts.appendChild(go);acts.appendChild(dis);acts.appendChild(document.createTextNode(" and leave them alone for "));acts.appendChild(qd);acts.appendChild(document.createTextNode(" days"));
  var out=wEl("small");out.style.cssText="display:block;margin-top:8px";
  f.appendChild(acts);f.appendChild(out);c.appendChild(f);
  go.onclick=function(){
    var body={id:d.id,note:noteI.value.trim()};
    if(banOn.checked)body.ban={hours:Number(banH.value),gifts:banG.checked};
    if(redOn.checked)body.reduce={pct:Number(redP.value),days:Number(redD.value)};
    if(slowOn.checked)body.slow={x:Number(slowX.value),days:Number(slowD.value)};
    if(takeOn.checked)body.takeBack={days:Number(takeD.value)};
    if(toOn.checked)body.timeoutHours=Number(toH.value);
    if(warnOn.checked&&warnT.value.trim())body.warned=true;
    if(!body.ban&&!body.reduce&&!body.slow&&!body.takeBack&&!body.timeoutHours&&!body.warned){out.textContent="tick at least one thing to do — or dismiss them.";return;}
    if(!confirm("Punish "+d.name+"?"))return;
    go.disabled=true;out.textContent="applying…";
    /* the warning goes before the timeout: tung cannot DM somebody the site
       has already shut out */
    var rs=[];
    (body.warned?apost("/admin/talk/send",{user:d.id,text:warnT.value.trim()}):Promise.resolve(null)).then(function(r){
      rs.push(r);
      return body.timeoutHours?apost("/admin/timeout",{id:d.id,until:Date.now()+body.timeoutHours*3600000,kind:"sahur",why:toWhy.value.trim()}):null;
    }).then(function(r){
      rs.push(r);
      var bad=rs.filter(function(r){return r&&r.error;}).map(function(r){return r.error+(r.reason?" ("+r.reason+")":"");});
      if(bad.length)body.note=(body.note?body.note+" — ":"")+"some of it did not go through: "+bad.join(", ");
      return apost("/admin/watch/punish",body);
    }).then(function(r){
      go.disabled=false;
      if(r.error){out.textContent=r.error;return;}
      watchFlags();watchUser(d.id);
    }).catch(function(){go.disabled=false;out.textContent="network error.";});
  };
  dis.onclick=function(){
    apost("/admin/watch/dismiss",{id:d.id,quietDays:Number(qd.value)}).then(function(r){
      if(r.error){out.textContent=r.error;return;}watchFlags();watchUser(d.id);
    });
  };
  return c;
}

/* ---- the rules ---- */
var WRULE_ORDER=["volume","quick","regular","nosleep","streak","noclick","hidden","still","giftfast","giftmany","sharednet"];
var WRULE_TEXT={
  volume:"{count} or more faucet claims within {hours} hours",
  quick:"{count} of the last {of} faucet claims came within {seconds} seconds of the cooldown ending",
  regular:"the gaps between the last {of} faucet claims vary by less than {seconds} seconds",
  nosleep:"across the last {hours} hours, with {count} or more faucet claims, the longest break is under {gapHours} hours",
  streak:"{perDay} or more faucet claims a day, {days} days running",
  noclick:"{count} of the last {of} claims came without a real click from the page",
  hidden:"{count} of the last {of} claims came from a tab nobody was looking at",
  still:"{count} of the last {of} claims were real clicks with no mouse, key or touch in the {seconds} seconds before",
  giftfast:"{count} of the last {of} giveaways were taken within {ms} ms of appearing",
  giftmany:"{count} or more giveaways won within {hours} hours",
  sharednet:"{accounts} or more accounts claim from one network within {hours} hours (a school is one network: keep it high or off)"
};
function watchConfigLoad(then){
  apost("/admin/watch/config",{}).then(function(d){
    if(d.error){if(then)wMsg(wrulesEl,d.error+" — check your key.");return;}
    WATCH.cfg=d.config;WATCH.defaults=d.defaults;WATCH.names=d.names||WATCH.names;
    if(then)then(d.config);
  }).catch(function(){if(then)wMsg(wrulesEl,"network error.");});
}
function watchRules(){if(!keyEl.value.trim()){wMsg(wrulesEl,"enter your admin key first.");return;}watchConfigLoad(function(c){paintRules(c,"");});}
function paintRules(cfg,msg){
  wrulesEl.innerHTML="";
  var g=wEl("div","app"),f=wEl("div","wpun");g.appendChild(wEl("h3",null,"how the watch behaves"));
  var on=wBox(cfg.on),minR=wNum(cfg.minRules),quiet=wNum(cfg.quietDays),keep=wNum(cfg.keepDays);
  wLine(f,[on," the watch is on — claims are logged either way"]);
  wLine(f,["put somebody in review when ",minR," or more rules trip at once"]);
  wLine(f,["after a dismissal, leave them alone for ",quiet," days"]);
  wLine(f,["keep claim logs for ",keep," days"]);
  g.appendChild(f);wrulesEl.appendChild(g);
  var box=wEl("div","app"),list=wEl("div","wrules"),inputs={};
  box.appendChild(wEl("h3",null,"the rules — flag somebody when…"));
  WRULE_ORDER.forEach(function(k){
    var r=cfg.rules[k],row=wEl("div","wrule"),cb=wBox(r.on),ins={on:cb};
    row.appendChild(cb);row.appendChild(wEl("span","wrname",WATCH.names[k]||k));
    /* doubled backslashes: this page is a template literal, which eats single ones */
    WRULE_TEXT[k].split(/(\\{\\w+\\})/).forEach(function(part){
      var m=/^\\{(\\w+)\\}$/.exec(part);
      if(m){var i=wNum(r[m[1]]);ins[m[1]]=i;row.appendChild(i);}else if(part)row.appendChild(document.createTextNode(part));
    });
    inputs[k]=ins;list.appendChild(row);
  });
  box.appendChild(list);wrulesEl.appendChild(box);
  var acts=wEl("div","row"),save=wEl("button","load","save the rules"),reset=wEl("button",null,"back to the starting numbers"),scan=wEl("button",null,"check everyone against these now");
  [save,reset,scan].forEach(function(b){b.type="button";acts.appendChild(b);});
  reset.style.cssText="background:#241505;color:#e9d9c2;border:1px solid #3a2410";scan.style.cssText=reset.style.cssText;
  var out=wEl("small",null,msg||"");out.style.cssText="display:block;margin-top:8px";
  wrulesEl.appendChild(acts);wrulesEl.appendChild(out);
  function collect(){
    var c={on:on.checked,minRules:Number(minR.value),quietDays:Number(quiet.value),keepDays:Number(keep.value),rules:{}};
    WRULE_ORDER.forEach(function(k){var o={};Object.keys(inputs[k]).forEach(function(fk){o[fk]=fk==="on"?inputs[k][fk].checked:Number(inputs[k][fk].value);});c.rules[k]=o;});
    return c;
  }
  save.onclick=function(){
    out.textContent="saving…";
    apost("/admin/watch/config",{config:collect()}).then(function(d){
      if(d.error){out.textContent=d.error;return;}
      WATCH.cfg=d.config;paintRules(d.config,"saved. new claims are judged by these from now on; “check everyone” applies them to what is already logged.");
    }).catch(function(){out.textContent="network error.";});
  };
  reset.onclick=function(){if(WATCH.defaults)paintRules(WATCH.defaults,"the starting numbers are filled in — save to use them.");};
  scan.onclick=function(){
    if(!confirm("Check every member's logged claims against the saved rules now?"))return;
    out.textContent="checking everyone…";
    apost("/admin/watch/scan",{}).then(function(d){
      if(d.error){out.textContent=d.error;return;}
      out.textContent="looked at "+d.looked+" members; "+d.flagged+" "+(d.flagged===1?"is":"are")+" waiting for review.";watchFlags();
    }).catch(function(){out.textContent="network error.";});
  };
}
/* ---------------------------------------------------------------------------
   Giveaways.

   Posting one, and the ones already posted: a countdown for each open one
   (this page's clock — nothing is asked of the server for it), roll it now,
   call it off, see who entered. The list is read when the pane opens, after
   anything done here, and once more a few seconds after an open one's timer
   runs out so its winners show. Nothing polls while the pane is shut. */
var rfList=document.getElementById("rflist"),rfT=null,rfData=null,rfAgain=null;
function rfStop(){if(rfT){clearInterval(rfT);rfT=null;}if(rfAgain){clearTimeout(rfAgain);rfAgain=null;}}
function rfFmt(ms){var s=Math.max(0,Math.ceil(ms/1000)),d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60),x=s%60;return d?d+"d "+h+"h "+m+"m":h?h+"h "+m+"m "+x+"s":m?m+"m "+x+"s":x+"s";}
function rfMinutes(){return Number(document.getElementById("rfLen").value)*Number(document.getElementById("rfUnit").value);}
function rfPreview(){
  var a=Number(document.getElementById("rfAmount").value),w=Math.round(Number(document.getElementById("rfWinners").value)),mins=rfMinutes();
  var out=document.getElementById("rfPreview");
  if(!(a>=1)||!(w>=1)||!(mins>=1)){out.textContent="";return;}
  out.textContent=(w===1?"one winner takes "+a:"each of "+w+" winners takes "+(Math.floor(a*100/w)/100))+" sahurs \u00b7 ends around "+new Date(Date.now()+mins*60000).toLocaleString();
}
["rfAmount","rfWinners","rfLen","rfUnit"].forEach(function(id){var el=document.getElementById(id);el.addEventListener("input",rfPreview);el.addEventListener("change",rfPreview);});
function rfOpen(){rfPreview();rfLoad();}
function rfLoad(){
  if(!keyEl.value.trim()){rfList.innerHTML='<div class="empty">enter your admin key first.</div>';return;}
  apost("/admin/raffle/list",{}).then(function(d){
    if(d.error){rfList.innerHTML="";rfList.appendChild(wEl("div","empty",d.error+" \u2014 check your key."));setCount("raffles","");return;}
    rfData=d.raffles||[];rfPaint();
  }).catch(function(){rfList.innerHTML='<div class="empty">network error.</div>';});
}
function rfPaint(){
  rfStop();rfList.innerHTML="";
  var open=rfData.filter(function(r){return r.status==="open"||r.status==="rolling";}).length;
  setCount("raffles",open||"");
  if(!rfData.length){rfList.appendChild(wEl("div","empty","no giveaways yet."));return;}
  var clocks=[];
  rfData.forEach(function(r){
    var c=wEl("div","app rfitem"),h=wEl("h3",null,r.amount+" sahurs \u00b7 "+r.winners+(r.winners===1?" winner":" winners"));
    var st=r.status==="open"?["rfopen","open"]:r.status==="rolling"?["rfopen","rolling"]:r.status==="done"?["rfdone","done"]:["rfoff","called off"];
    h.appendChild(wEl("span","wchip "+st[0],st[1]));
    h.appendChild(wEl("span","when","posted "+new Date(r.createdAt).toLocaleString()));
    c.appendChild(h);
    c.appendChild(wEl("p","rftext",r.text));
    var line=wEl("div","rfline");c.appendChild(line);
    if(r.status==="open"){clocks.push({r:r,el:line});}
    else if(r.status==="done"){
      var ws=(r.picked||[]).map(function(p){return p.name;});
      line.textContent=(r.entries||0)+" entered \u00b7 "+(ws.length?"won by "+ws.join(", ")+" \u2014 "+r.each+" sahurs"+(ws.length>1?" each":""):"nobody won it")+" \u00b7 rolled "+new Date(r.doneAt||r.endsAt).toLocaleString();
    }else if(r.status==="rolling")line.textContent=r.count+" entered \u00b7 the drum is rolling\u2026";
    else line.textContent=r.count+" had entered \u00b7 called off "+new Date(r.doneAt||r.createdAt).toLocaleString();
    var acts=wEl("div","row"),who=wEl("button",null,"who entered ("+r.count+")");who.type="button";
    who.style.cssText="background:#241505;color:#e9d9c2;border:1px solid #3a2410";
    var list=wEl("div","rfwho");list.style.display="none";
    who.onclick=function(){
      if(list.style.display!=="none"){list.style.display="none";return;}
      list.style.display="";list.textContent="loading\u2026";
      apost("/admin/raffle/entries",{id:r.id}).then(function(d){
        if(d.error){list.textContent=d.error;return;}
        list.textContent=d.names.length?d.names.join(", "):"nobody yet.";
      }).catch(function(){list.textContent="network error.";});
    };
    acts.appendChild(who);
    if(r.status==="open"||r.status==="rolling"){
      var roll=wEl("button","load","roll it now");roll.type="button";
      roll.onclick=function(){
        if(!confirm("Roll this giveaway now? Whoever has entered so far is in the draw."))return;
        roll.disabled=true;apost("/admin/raffle/end",{id:r.id}).then(function(d){if(d.error)alert(d.error);rfLoad();}).catch(function(){roll.disabled=false;});
      };
      acts.appendChild(roll);
    }
    if(r.status==="open"){
      var off=wEl("button","no","call it off");off.type="button";
      off.onclick=function(){
        if(!confirm("Call this giveaway off? Nobody wins and tung says so in the room."))return;
        off.disabled=true;apost("/admin/raffle/cancel",{id:r.id}).then(function(d){if(d.error)alert(d.error);rfLoad();}).catch(function(){off.disabled=false;});
      };
      acts.appendChild(off);
    }
    c.appendChild(acts);c.appendChild(list);rfList.appendChild(c);
  });
  function tick(){
    var due=false;
    clocks.forEach(function(k){
      var left=k.r.endsAt-Date.now();
      k.el.textContent=k.r.count+" entered \u00b7 "+(left>0?"ends in "+rfFmt(left)+" ("+new Date(k.r.endsAt).toLocaleTimeString()+")":"time is up \u2014 the drum is rolling\u2026");
      if(left<=0)due=true;
    });
    /* once one runs out, read the list again a few seconds later so the winners show */
    if(due&&!rfAgain){rfAgain=setTimeout(function(){rfAgain=null;rfLoad();},4000);}
  }
  if(clocks.length){tick();rfT=setInterval(tick,1000);}
}
document.getElementById("rfRefresh").onclick=rfLoad;
document.getElementById("rfPost").onclick=function(){
  var btn=this,msg=document.getElementById("rfMsg");
  var body={text:document.getElementById("rfText").value.trim(),amount:Number(document.getElementById("rfAmount").value),
    winners:Math.round(Number(document.getElementById("rfWinners").value)),minutes:rfMinutes()};
  if(!(body.amount>=1)){msg.textContent="the prize has to be at least 1 sahur.";return;}
  if(!(body.winners>=1&&body.winners<=50)){msg.textContent="1 to 50 winners.";return;}
  if(!(body.minutes>=1)){msg.textContent="it has to run at least a minute.";return;}
  if(!confirm("Post a giveaway of "+body.amount+" sahurs for "+body.winners+(body.winners===1?" winner":" winners")+", running "+rfFmt(body.minutes*60000)+"?"))return;
  btn.disabled=true;msg.textContent="posting\u2026";
  apost("/admin/raffle/create",body).then(function(d){
    btn.disabled=false;
    if(d.error){msg.textContent=d.error;return;}
    msg.textContent="posted. tung said: \u201c"+d.raffle.text+"\u201d";
    document.getElementById("rfText").value="";rfLoad();
  }).catch(function(){btn.disabled=false;msg.textContent="network error.";});
};
/* ---------------------------------------------------------------------------
   Sahur transfers.

   Member-to-member sends, newest first, a hundred at a time. Read when the
   pane opens and when asked; it does not poll. Clicking a name shows only
   that member's sends and receipts. */
var tipWho=document.getElementById("tipWho"),tipList=document.getElementById("tiplist");
var tipSum=document.getElementById("tipSum"),tipMoreBtn=document.getElementById("tipMore");
var TIP={cursor:"",rows:[],user:""};
function tipFillUsers(){
  if(!tipWho)return;var prev=tipWho.value;tipWho.innerHTML="";
  dmOption(tipWho,"","everybody");
  (usersCache||[]).forEach(function(u){dmOption(tipWho,u.id,u.username);});
  if(prev)tipWho.value=prev;
}
function tipLoad(reset){
  if(!keyEl.value.trim()){tipList.innerHTML='<div class="empty">enter your admin key first.</div>';return;}
  if(reset){TIP={cursor:"",rows:[],user:tipWho.value};tipList.innerHTML='<div class="empty">loading\u2026</div>';tipSum.textContent="";}
  apost("/admin/tips",{user:TIP.user,cursor:TIP.cursor,limit:100}).then(function(d){
    if(d.error){tipList.innerHTML="";tipList.appendChild(wEl("div","empty",d.error+" \u2014 check your key."));return;}
    TIP.rows=TIP.rows.concat(d.tips||[]);TIP.cursor=d.cursor||"";
    if(TIP.user&&reset){
      var nm=tipWho.options[tipWho.selectedIndex]?tipWho.options[tipWho.selectedIndex].textContent:"";
      TIP.sum={name:nm,sent:0,got:0,nSent:0,nGot:0};
    }
    if(TIP.user&&TIP.sum){(d.tips||[]).forEach(function(t){if(t.fromId===TIP.user){TIP.sum.sent+=t.amount;TIP.sum.nSent++;}if(t.toId===TIP.user){TIP.sum.got+=t.amount;TIP.sum.nGot++;}});}
    tipPaint();
  }).catch(function(){tipList.innerHTML='<div class="empty">network error.</div>';});
}
function tipPaint(){
  tipList.innerHTML="";tipMoreBtn.style.display=TIP.cursor?"":"none";
  if(TIP.user&&TIP.sum){
    var r2=function(x){return Math.round(x*100)/100;};
    tipSum.textContent=TIP.sum.name+" sent "+r2(TIP.sum.sent)+" sahurs in "+TIP.sum.nSent+" transfer"+(TIP.sum.nSent===1?"":"s")+
      " and received "+r2(TIP.sum.got)+" in "+TIP.sum.nGot+(TIP.cursor?" (in what is loaded so far)":"")+".";
  }else tipSum.textContent=TIP.rows.length?TIP.rows.length+" transfer"+(TIP.rows.length===1?"":"s")+(TIP.cursor?" loaded so far":"")+".":"";
  if(!TIP.rows.length){tipList.appendChild(wEl("div","empty",TIP.user?"no transfers to or from them in the last 90 days.":"nobody has sent anybody sahurs in the last 90 days."));return;}
  var t=wEl("table","tiptable"),hd=wEl("tr");
  ["when","from","","to","sahurs","sender left with","receiver left with"].forEach(function(x){hd.appendChild(wEl("th",null,x));});
  var th=document.createElement("thead");th.appendChild(hd);t.appendChild(th);
  var tb=document.createElement("tbody");
  TIP.rows.forEach(function(r){
    var tr=wEl("tr");
    tr.appendChild(wEl("td",null,new Date(r.ts).toLocaleString()));
    var f=wEl("td","who"+(TIP.user&&r.fromId===TIP.user?" out":""),r.from);f.title="only "+r.from;f.onclick=function(){tipWho.value=r.fromId;if(tipWho.value===r.fromId)tipLoad(true);};
    tr.appendChild(f);tr.appendChild(wEl("td",null,"\u2192"));
    var to=wEl("td","who"+(TIP.user&&r.toId===TIP.user?" in":""),r.to);to.title="only "+r.to;to.onclick=function(){tipWho.value=r.toId;if(tipWho.value===r.toId)tipLoad(true);};
    tr.appendChild(to);
    tr.appendChild(wEl("td","amt",String(r.amount)));
    tr.appendChild(wEl("td",null,String(r.fromAfter)));
    tr.appendChild(wEl("td",null,String(r.toAfter)));
    tb.appendChild(tr);
  });
  t.appendChild(tb);var wrap=wEl("div","wlogwrap");wrap.appendChild(t);tipList.appendChild(wrap);
}
document.getElementById("tipLoad").onclick=function(){tipLoad(true);};
if(tipWho)tipWho.onchange=function(){tipLoad(true);};
tipMoreBtn.onclick=function(){tipLoad(false);};
</script></body></html>`;
