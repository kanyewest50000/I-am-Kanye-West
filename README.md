the one and only Tung Tung Tung Sahur Learning Website.

special thanks to my good friends Opus and Grok.

## layout

The site is two things wearing one coat. On top is "Untether", a decoy
education-infrastructure marketing site. Underneath is the Shrine of Tung — a
chat room, a casino, a games catalog and Tung's own originals — which opens in
its own `about:blank` window and stays invisible until someone types `tung`
into the impact calculator on the homepage.

```
index.html              the decoy homepage. markup only.
*.html                  the rest of the decoy site (curriculum, pricing, faq, ...)

assets/css/home.css     homepage stylesheet
assets/css/site.css     shared stylesheet for every other decoy page
assets/js/site.js       decoy subpage runtime (nav, forms, accordions)
assets/js/theme-toggle.js   light/dark switch, shared by every page
assets/js/home.js       homepage runtime: imagery, calculator, odometer, and
                        the three doors to the shrine (the "tung" unlock, the
                        staff portrait, the "popup" keyword)

assets/js/shrine/       everything behind the decoy. loaded in this order:
  config.js               backend URL, the base the repo's own files are found
                          under, artwork, ace mark, cloaked labels
  games-catalog.js        the curated catalog (the GAMES array)
  originals.js            Tung's own games, from games/tung/
  chat.js                 chat client source
  casino.js               casino client source (lobby, dice, limbo, roulette,
                          plinko, blackjack, mines, beef, the pit, shop, faucet)
  styles.js               the shrine window's stylesheet
  markup.js               the shrine window's <body>
  window.js               assembles the document and opens the window

server.ts               Deno backend: auth, approvals, chat history, balances,
                        every casino outcome. Runs on Deno Deploy, state in KV.
embed/                  standalone embeds for other hosts: the chat on its own,
                        and the whole shrine from one script tag
games/                  vendored game files served from this origin, fetched
                        into their own tab rather than framed
  tung/                 Tung's originals, including chess.html (the game against
                        the computer), chess-rules.js (generated from server.ts)
                        and stockfish/ (the real engine, GPL, vendored)
scripts/                tests and maintenance tools
```

Each shrine module hangs itself off `window.Shrine`; nothing opens on its own.
`window.js` is the only file that knows how to put the pieces together, and it
has to load last. The shrine window is written with `document.write` into an
`about:blank` popup, so its stylesheet and its two clients travel as strings
rather than as `<link>` and `<script src>`.

Nothing is on the other side of the door until tung says yes. The shrine boots
to its own door — the application, or the pending screen, or a ban — and the
chooser is opened from exactly one place, the moment `/status` comes back
`approved`. Until then there is no chat, no casino, no catalog, no originals and
no proxy, because there is no chooser to reach them from.

The casino used to be gated on its own, with its tile shipped hidden and put
back once approved. That rule is gone: a general one replaced it, and two rules
saying the same thing are one rule and one bug waiting to happen. The tile still
ships hidden so nothing shows for a frame before `/status` answers, and
`paintGate()` is what puts it back — which is worth saying because removing the
old rule without moving that job left approved members looking at a chooser with
no casino on it, and `scripts/test-gate.ts` now holds it down.

All of that is presentation. The gate itself is `authUser()` and `casUser()`,
and `authUser()` refuses any token whose account is not approved — so every
route behind it, the room and DMs included, was already shut. Unhiding a tile
from devtools buys nothing.

**Send him to tung.** The third verdict on an application, next to approve and
reject. A rejection leaves somebody able to apply again; this does not. The
account is rejected *and* banned, so every route that asks `blockState()`
refuses it and the name stays taken, and `/status` and `/login` both carry a
`banished` flag that tells their own client to empty the document — not a screen
with a message on it, an actually blank white page with nothing left polling.
Approving them again is the only thing that lifts it.

Worth being straight about which half is which. The blank page is keyed to the
token in their browser, so clearing site data gets them back to an application
form like any other stranger. The account is what stays banned, and that half is
real.

Outcomes are the server's, never the client's: the casino code only sends bets
and paints whatever `server.ts` replies, so editing it in devtools changes
nothing. The same rule runs through the chat — a reply quotes a message by id
and the server fills in what that message actually said, and whether a reaction
is yours is a fact the server holds — so neither the words above a reply nor the
number on a reaction chip can be set by whoever sent the request.

## opening a game

A catalog title used to be an `<iframe>` pointed at the game. Networks that
refuse to frame things refuse the whole catalog that way, and a refused frame
is a black rectangle with nothing to catch — so the game is fetched and written
into its tab as the whole document instead. The same bytes over the same
origin rules, arriving as an ordinary page load rather than as a frame.

The whole document, not a container: half of these call `document.write` while
they load, and the Unity and Godot loaders read `location` and
`document.baseURI`. Handed the whole document they behave exactly as they would
if you had navigated to them, which is the only thing that works across all of
them. An `about:blank` popup reports its opener's URL, so `location` is a real
one — the reason this is not a `srcdoc` frame, which reads `about:srcdoc` and
hangs those loaders at 0%.

Relative assets still have to resolve. The 777 gn-math stubs carry an absolute
`<base href>` of their own, pointing at wherever their wasm lives, and keep it.
The rest are folders of relative files and are given their own folder as a base
on the way in — without which a game would look for `index.js` next to the
shrine. `scripts/test-game-fetch.ts` runs both helpers for real.

If the fetch is the thing that cannot get through — a cross-origin embed whose
host sends no CORS header, say — the frame is still there to fall back to,
rather than a blank tab.

## the shrine somewhere else

Because `window.js` builds the whole shrine as one string, the shrine does not
actually need this site. `embed/shrine.js` is that fact made usable: one script
tag, pasted into Replit, w3schools, a CodePen, anything that runs JavaScript.

```html
<script src="https://cdn.jsdelivr.net/gh/kanyewest50000/offline-learning@main/embed/shrine.js"></script>
```

Two hosts are in play there and they are not interchangeable. The **code** — the
eight modules, about 90KB gzipped — can come from a CDN, and jsDelivr serves
`.js` with the right content-type. The **files** — the artwork, the originals,
the 830 vendored games — cannot: jsDelivr hands `.html` out of `/gh/` as
`text/plain`, so a game fetched from it arrives as its own source code instead
of rendering. Those stay on Pages.

`Shrine.BASE` is what keeps the two straight. Every repo path any module builds
is resolved against it rather than against the page, so the one value decides
where the shrine looks for its own things: the artwork in `config.js`, the three
originals, the 777 catalog entries remapped onto `games/g/`, and the game URL
baked into the emitted chat client. On this site it is the page's own folder
and nothing has changed. Pasted elsewhere, `embed/shrine.js` sets
`window.SHRINE_BASE` before the modules load and points all of it back here —
without which a catalog would quietly resolve 777 games onto a stranger's
domain. `?base=` does the same for a one-off test. `scripts/test-shrine-base.ts`
holds that down from both ends: the default must not move, and nothing in the
finished document may name the host it was pasted into.

The login key is per-origin, because localStorage is. Somebody using an embed
logs in on that host once with the key they already have; the backend answers
`access-control-allow-origin: *`, so it does not care where they are. Games open
with `window.open`, so a sandboxed frame without `allow-popups` gets the chat,
the casino and the originals but no catalog tabs.

### getting a push to the people running it

The script tag points at `@main`, which is a branch and therefore a moving
target — and a CDN will not go back to GitHub on every request to see whether it
has moved. jsDelivr holds a branch URL at its edge for hours, and the browser
that fetched it holds a copy for longer than that. Neither is a bug; both mean
somebody who opened the shrine last week is still running last week's shrine.
That is how a friend ends up on a copy with no poker in it.

Asking politely does not work, so the URL changes instead. The embed's first act
is `GET /version` on the backend, which answers with the current deployment's id
and is the one route in the whole system served `no-store` — if that went stale
it would pin everything else to whatever it last said. Every module is then
loaded with `?v=<that build>` on the end. A new deployment is a new set of URLs,
so nothing any cache is holding can answer for them; between deployments the
URLs are identical and every cache keeps working exactly as it did. If the
backend cannot be reached the tag falls back to the current hour, which bounds
the damage without the shrine having to wait on anything — the version request
gives up after two and a half seconds and loads regardless.

`.github/workflows/purge-cdn.yml` is the other half, and the smaller one: on
every push to main it calls jsDelivr's purge API for the embed and the eight
modules, so the CDN edge is current too rather than revalidating lazily behind
the new URL. It is deliberately not allowed to fail a build — the version tag
already gets the new code to everybody; purging only makes the first request
for it faster.

`scripts/test-shrine-base.ts` runs the embed against a fake page and looks at
what it appends: every module has to carry the build the backend reported, two
different builds must not be able to name the same URL, and with no backend at
all it still has to load, still tagged with something that moves.

## direct messages

Beside the room is a rail of conversations, and the room is the first row in it.
Clicking a name in the chat opens that member's profile card, which now has
**send a message** on it next to the tip button; picking it swaps the pane over
to a conversation with them and leaves the room where it was, because the room
and a DM are the same pane wearing different contents — the header renames
itself, the composer's placeholder names who it is writing to, reactions and
replies go away (there is nobody else to react in front of), and going back to
the room replays it from the top rather than resuming a half-scrolled log. Each
row carries the newest line and, if it has not been opened, a count; the rail
sorts by who spoke last. Below 760px it is the first thing to go, because the
room still works without it.

A DM is not the room with a filter on it. The room is one append-only stream
everybody reads; a conversation is a stream of its own and the pair it belongs
to is the key, sorted so both ends name the same one. That is the whole access
story: the only conversation ids that exist are built out of two member ids, so
the only ones you can name are the ones you are in, and there is no per-message
check for somebody to forget to write later. A line and both sides' view of the
conversation are one commit, so a message cannot exist without appearing in the
list that points at it, and the list cannot promise a line that was never
written. The sender has by definition read their own line; the recipient's read
mark is left exactly where it was, and the difference between it and the
conversation's counter is the number on the badge. Opening a conversation is
what clears it — there is no second call to forget — and the mark only ever
moves forward, so a stale poll cannot un-read anything. A conversation ages out
after a month of silence.

Any member can **block** any other, from the header of the conversation
itself — but not tung: his conversation has no block button, `/dm/block`
refuses him, and no block holds against his conversation, including any set
before that rule existed. A block is a fact about the pair rather than an entry on somebody's
list, so it lives under the same sorted key the conversation does and costs the
one read that was already being made. It shuts the conversation both ways:
neither writes, neither reads. A block that only stopped them writing would
leave you writing at somebody who cannot answer, which is not what the word
means. Two flags rather than one "blocked by", because both ends can block at
once and one of them relenting must not quietly lift the other's.

Both ends are told whose block it is. The end that set it sees "you blocked X"
and an unblock button; the end that was blocked sees **"you have been blocked by
X"** — under the name, in the middle of the empty conversation, and in the
composer it has switched off — and their rail row says "blocked you". It used to
say only "closed", which left somebody writing into a door that would never
open with no way to know why. `/dm/with` and `/dm/list` carry `byYou` and
`byThem`; a refused `/dm/send` answers `you_blocked` or `blocked_you`. A block
is a DM matter and nothing else: both of them still see each other in the room
exactly as before. Lifting it hands the conversation back whole — an open window
on the other end reopens on its own — and the lines refused while it stood were
never written.

### taking a line back

A member can delete their own lines, in the room and in a DM, from the same bin
a moderator has (two clicks, so one stray tap cannot do it). In the room it is
`POST /delete`, which a moderator can use on any line and anybody else only on
their own: whose a line is lives in the server-side quote index as the author's
id, never in the event the room replays, so a rename cannot hand somebody
another member's old lines. In a DM it is `POST /dm/delete {with, seq}`, only
ever on your own line. The line is marked deleted and a small marker takes the
next seq in its place, so the other end's open window drops it on its next
ordinary poll without any poll paying an extra read to find out. The preview on
both rails moves to the newest line still standing, and the unread badge never
counts what was taken back (the reader's row keeps the seqs to skip until they
read past them). `scripts/test-own-delete.ts`.

**Deleted is not destroyed.** A deleted line — taken back by its author, or
removed by a moderator or with the admin key — stays where it was, marked, and
keeps the clock it already had, so it ages out when it would have anyway. No
member ever sees it again: the room's window, its poll, a fresh open of a
conversation and its poll all skip it. The admin panel is the one place it
still shows: the **Chat log** dump lists it tagged "(deleted by its author)" or
"(deleted by <whoever>)" with the time, and the **Direct messages** dump and
tung's inbox show a taken-back DM line tagged "(deleted)" — the plain-text copy
included. Deleting an account, and **clear chat log**, still wipe for real.

The chat ban covers all of it, in both directions. Somebody shut out of the room
can neither send a DM nor be sent one: their own three routes answer `chatban`
like every other chat route, and anybody writing to them is told the
conversation is `closed` rather than that they are gone. A ban that left DMs
open would not be a ban, it would be a change of venue, and one that only
stopped them sending would leave everyone else free to talk at them. Lifting it
hands the conversation back exactly as it was — a ban is not a purge, and the
lines refused while it was on were never written. `scripts/test-dm.ts` walks
delivery to one member and nobody else (by name or by id, with a third member
trying both), the badge, the rail's ordering, both halves of the ban, and the
block: both directions shut, the blocked end told who blocked them, the room
untouched by it, the two sides independent, and the conversation whole again
when it is lifted.

### what a DM is allowed to cost

Every one of these four routes carries a session token, and a request with a
token on it skips the anonymous ninety-a-minute IP cap entirely — that is what
the cap is for, so that a school NAT full of approved members is not one
identity. It also meant, until this, that `/dm/list`, `/dm/with` and
`/dm/block` had no clock on them at all: one approved account could ask for any
of them as fast as it could open sockets, and every ask was KV reads somebody
pays for. Only `/dm/send` was capped, and only against bursts.

The shape of the abuse matters more than the volume. A conversation is cheap;
what is expensive is how MANY of them one account can bring into being. Writing
"hi" to every member of the shrine is a handful of requests, and what it leaves
behind is a row on two rails per member, for a month, that every later read of
either rail has to walk. The fan-out is the attack, not the messages. So:

* **Every list read is bounded.** `/dm/list` walks at most `DM_RAIL` (300)
  conversations, so one read of a rail costs what one read of a rail costs
  however many rows are behind it. That is the half that protects somebody
  with rows made *at* them, which they never agreed to.
* **Opening a conversation is told apart from replying in one**, by a single
  read, and only opening one pays: five new conversations a minute, ten in ten
  minutes across isolates, and `DM_CONV_MAX` (80) of them ever. Replying in a
  conversation that already exists meets none of it, which is what everybody
  actually does all day. At the ceiling the composer says so — "too many
  conversations open — this would be a new one" — rather than "that did not
  send", because nothing is wrong with the line and trying again will not help.
* **The polls have clocks.** `/dm/with` allows twenty in ten seconds against a
  client that asks every 2.5s, and `/dm/list` ten in ten seconds against one
  that asks every twelve. A refused poll is dropped and retried by the client
  without showing anything, so a person never learns either exists.
* **A cold read is counted separately.** A poll carrying a cursor reads the
  handful of lines past it. A poll carrying none replays the conversation — up
  to `DM_PAGE` reads and a few hundred KB out — so that one gets its own
  allowance, twenty a minute per isolate and forty across them. The cross-
  isolate half is the one place a KV read and write are worth spending, because
  they are bought against three hundred.
* **Blocking is the tightest of the four**, because it is the only one that
  writes: ten a minute, twenty in ten minutes. Blocking somebody is a thing a
  person does once and thinks about first.
* **And a long window on sending.** Three lines every six seconds is a burst
  cap, and kept up it is also a licence: thirty a minute, forty-odd thousand a
  day, seven KV operations each, from one account, where nobody in the room
  would ever see it. `DM_HOUR_MAX` (400 an hour) is the window a burst cap does
  not have — a quarter of what the burst cap alone allows, and far more than
  anybody writes.

`DM_RAIL`, `DM_CONV_MAX` and `DM_HOUR_MAX` are all env-overridable, so the
ceilings can move without a code change if the shrine ever outgrows them.
`scripts/test-dm-limits.ts` walks it: an ordinary rail poll is never refused and
forty at once are, replying in a conversation that exists is never charged what
opening a new one costs, and opening them one after another runs into both the
clock and the ceiling.

### reading a conversation from /admin

**Direct messages** in the admin panel is two dropdowns. The first is every
approved member, taken from the list the panel has already loaded rather than
fetched again. Picking one fills the second from the conversations that
actually exist for them — `POST /admin/dm/peers` — so there is no guessing at
pairs and getting an empty answer back; each row names the other end, how many
lines are in it and when the last one was. Picking that dumps the conversation
(`POST /admin/dm/thread`), two-sided, oldest at the top, with a plain-text copy
of the whole thing underneath for pasting somewhere else.

Both are POSTs rather than GETs, for the same reason the key is: a body is not
an address bar, a history entry or an access log, and a member id has as good a
claim to stay out of those as the key does. Neither is fetched by **load** —
like the chat dump, somebody's private messages are pulled deliberately or not
at all.

It is a read and strictly a read — `scripts/test-dm-limits.ts` dumps a
conversation with a line sitting unopened in it and checks the badge afterwards.
It moves no read mark, writes no row, and shows up in neither member's client — which is exactly what reusing `/dm/with`
would have failed to do, since reading a conversation is what marks it read.
The dump says which end blocked it, if either did, because the admin panel is
the one place where saying so is the point; the members themselves are still
never told. What it costs is bounded like everything else on these keys:
`DM_RAIL` conversations, `DM_DUMP` (1000) lines, and a conversation longer than
that gives back its newest end rather than its oldest.

### talking to a member as tung

**Talk to da people**, under Direct messages, is tung's own DM inbox. He has no
account, so he is a side of the pair under an id no member can have
(`tung!voice`), and a line sent from the panel (`POST /admin/talk/send`) is an
ordinary direct message: it lands in that member's conversation rail as a DM
from *tung*, only the two of them can see it, and their reply goes back through
the ordinary `/dm/send` into his inbox (`/admin/talk/list`, `/admin/talk/thread`).
Nothing on this path touches the room.

It is drawn as a DM, too. His portrait and gold name say it is him — the name
is one nobody else is allowed to hold — but not the room's gold proclamation
bar or the **the shrine** chip: "the shrine" is what the public room is called,
and on a private conversation it made his DM read as the room itself. In the
panel his lines sit on the right, as the sender's, and theirs on the left. A
chat ban still shuts it; a block cannot — he is not somebody a member can shut
the door on. `scripts/test-admin-talk.ts`.

**general chat** is pinned above his conversations: the room itself, from his
seat. Everybody's lines sit on the left under their names and his on the
right; **reply** on any line quotes it; and what he writes goes to everyone
with his mark — it is `/admin/postas` as tung, the same kind of line a Wisdom
is. The whole retained log is read once when it opens, and after that each
pass asks `GET /admin/chat?since=<cursor>` for only what landed past the
newest line it holds — usually nothing — every three seconds, and only while
this pane and this conversation are open and the tab is in view. Deletions
come back on the same pass as ids, so a line taken back is marked
**(deleted)** where it sits. **Post as…** no longer offers tung: it is for
members' names, and points here.

## tung's giveaways, with entries

The panel's **Giveaways** pane posts one to the room as tung: his line (or
yours — leave it blank and he picks one of `RAFFLE_LINES`; `{n}` and `{w}` in
either become the prize and "3 winners"), and under it a card with the prize,
how many win it, a countdown and an **enter** button. It is not the
first-to-click gift his Wisdoms sometimes carry: everyone who enters before the
timer runs out is in the draw once, and speed buys nothing. When it runs out
the server draws the winners at random (the platform's CSPRNG, no modulo bias),
splits the prize between them to the cent, pays it into their balances and
announces who won in a line of his own, which is also what turns every open
copy of the card into the result. Fewer entrants than winners means everyone
who entered wins; nobody entering means nobody is paid, and he says so.

The pane lists what has been posted: the countdown for open ones, **who
entered**, **roll it now**, and **call it off** (nobody wins; the room is told).
It reads the list when it opens, after anything done there, and once more a few
seconds after an open one runs out so the winners show. It does not poll.

Members: one entry each (entering twice, or five times at once, is still one);
a chat ban or the sahur watch's "barred, giveaways too" shuts the button; the
countdown is the page's own clock; which ones you entered is remembered on the
device, per name, so a reload still says so. Somebody banned, timed out or shut
out of the room after entering is passed over in the draw, and a winner the
sahur watch has on reduced claims is paid their percent.

Nothing polls for the end. The room's `/events` poll carries a check that is a
comparison against a number held in memory until something is due (and one KV
read a minute otherwise, to hear about one another isolate posted); the isolate
that posted it also sets a timer for its end. A roll is three commits, each safe
to repeat: close entries and write down the winners (checked against the
record, so two rollers cannot both draw), pay each winner behind a per-winner
"paid" mark in the same commit as their balance, then mark it done — and only
the commit that did that may announce it. Five rolls at once, or the timer and
**roll it now** together, pay nobody twice. `scripts/test-giveaways.ts`.

## the pit

Four tables in the casino where the opponent is another member rather than the
house: **Tung, Wood, Fire** (tung splits the wood, the wood feeds the fire, the
fire takes tung — first to two rounds, a tie is replayed), **The Cut** (one
card each, high card takes it) and **Competitive Gambling** (three minutes on
the casino floor, a stack of wood each, biggest pile at the buzzer). The last two
seat two, three or four.

A round of Tung, Wood, Fire is two hidden picks resolving into one outcome, and
it is shown as exactly that: the two moves slide in from opposite sides onto the
same line, meet, and the loser is taken out of the world. A tie has nothing to
resolve, so the two rebound and it is played again. The Cut has nothing to play
at all — both cards are decided before either is shown — so its whole experience
is the wait: the deck is cut, your card stirs and turns over slowly, and you sit
with it for three full seconds while theirs shivers under a sheen before it
turns. The result is held behind the second card, because knowing it early is
the one thing that would make the pause worthless.

Competitive Gambling is the one where the pit is not the game. Everyone at the
table is handed the same stack of wood and turned loose on the whole floor for
three minutes — every table, not a sprint corner of them — and whoever is
sitting on the biggest pile when the clock stops takes the pot.

A cut wants a body in the other chair and there is not always one about, so the
host can **call tung** into it. One call is one chair and he can be called again
for as long as a chair is empty, so a four-seat cut with nobody around is the
player against three of him. He is seated already confirmed, because he is
always ready. What he is not is a member: no account, no balance,
no lock. That makes a table he is sitting at a house table wearing the pit's
clothes, and it changes exactly one thing, which is the money. His stake is the
house's, so the pot pays the house's 0.1% edge, the same as the wheel. Between
players there is no rake and never will be. The table says which it is.

The Cut and Competitive Gambling both seat two, three or four and say which when
they go up; Tung, Wood, Fire is a hand against one opponent — its rounds, its
score and its forfeit rule are all written for a pair — so it stays two however
many a client asks for. Those tables wait, and can still be taken down, until
the last chair is filled.

**Poker's table is a lobby instead.** It used to name a number like the rest,
and that was a guess either way round: open it for five and a table nobody else
found sat there for ten minutes and refunded itself, open it for two and the
third person to turn up could not sit down. Two is a game, five is a game, and
which one you get depends on who happens to be about. So there is no seat
picker: the table opens with all five chairs, anybody may take one, and the host
deals when they are ready — from two up. A table that does fill every chair
still closes itself, because at that point there is nothing left to decide.

What does not go with that is the handshake. Dealing settles *who* is at the
table, not whether they agreed to it: the roster is fixed the moment the host
presses it, nobody else may sit down, and everyone seated still has to say yes
inside the confirm window or every stake goes home exactly as before. The one
server-side consequence worth naming is that the last yes is now counted against
the people at the table rather than the chairs the table has — counting chairs
would leave a three-handed game sitting in the handshake until it timed out.

Finishing level at the top is not a void: the players on the biggest pile split
what is on the table. Each share is the gap between two floored running totals,
so no share is ever rounded up and they add back to exactly the pot — nothing
minted, nothing left behind. With everyone level that pays each player their own
stake back, which is what a refund used to do; the difference shows at three and
four, where two players can tie above a third. They take the pot between them and
the one who lost stays lost, rather than being handed their stake back for it.

Running the wood out ends a two-player round there and then. At three and four it
usually does not: the rest of the table still has its clock, and one player going
broke must not cut that short — so a bust ends the round only once there is
nobody left to play against. Deciding that means reading whether the others still
have a stake out on the floor, and every record read joins the guard on the
commit, so a hand dealt anywhere between the decision and the commit makes the
commit fail and the call is taken again.

There is one exception that matters throughout: a stake still sitting on a table
is not spent, it is unread. A player
who puts their last wood on a mines board is on zero and still in it, because
the board can pay; the round ends when the board is read, not when it is dealt.
That is taken off the game records themselves rather than off a counter, so two
deals racing each other, a hand replaced by another, or a record that expired
cannot leave a phantom stake behind that makes somebody unbustable. The flip
side is the buzzer: a hand still open when the clock stops is a stake paid and
never played, and it scores as spent. Otherwise the last ten seconds of every
round would be worth a free look at a hand you could abandon.

### table talk

The players at a table get a small chat of their own — **a round of Competitive
Gambling and a poker game**, which are the two tables where the same people are
sat together long enough to want to say anything. It is not the shrine's chat
and shares nothing with it: no history, no reactions, no retention, no webhook.
The whole conversation is one value held under the table, which is what lets the
commit that settles it delete the talk in the same breath — there is no window
where the game is over and the talk is still readable, and nothing to sweep
afterwards. A chat ban closes it, the way it closes the shrine's chat, while
leaving the tables open.

It reaches the players wherever they are standing, because a round does: the
table's own page shows it open, and out on the floor it is a drawer under the
round bar. On a poker table it is a drawer on the table's own header, and it
**floats** over the felt rather than sitting in the column — that page is
already taller than a laptop window, and a chat log in the flow would push the
action bar off the bottom of it, which is the exact thing the raise panel had to
be rebuilt to stop doing. Shut, it costs no height at all; open, nothing on the
table moves.

**What it must not cost is a read per poll.** The talk rides the poll the table
is already making, so it costs no request of its own — but `/duel/state` is the
hottest poll in the casino, 1.2 seconds per player, and a poker game can run for
an hour where a round lasts three minutes. Fetching a conversation nobody is
having, fifty times a minute each, is exactly the kind of quiet expense this
project keeps finding.

So the *count* of lines said lives on the duel record, which every poll reads
anyway, and the conversation itself is fetched only when the client's count and
the table's disagree. A quiet table costs nothing at all; a line costs each
player at the table one read, once. The line and the count go in the same atomic
commit, because a counter that moved without its line would have everyone fetch
a conversation that had not changed, and a line without its counter would sit
there unread until somebody else spoke. The unread badge on the drawer comes off
the same number, so it is free too.

For those three minutes **the table's own page is the lobby**, and the back
button says so. The round is played out on the floor — you leave the table's
page, pick a house game off the floor menu sitting on it, and the round follows
you onto whatever you pick — so walking back out of that game has to land where
you came from. It did not: every view in the casino is mounted by one function
that hardwired "← back to lobby" to the casino floor, which put you a level
further out than you had started, with the round you were in the middle of
reduced to a bar along the top and the way back to it a different button in a
different place. While a round is running that button reads "← back to the
round" and goes to its page. The round's own page is the one exception and stays
one, because standing on it the way out really is the floor — a page that *is*
the round cannot offer to take you to the round. It is one rule in one place
rather than a line per view, so a table added later cannot quietly get the old
behaviour, and it is repainted as the round starts and ends rather than written
once at mount, so a round finishing under an open game takes its own offer back
off the button. `scripts/test-round-back.ts` holds all of it.

Wood is not sahurs and never becomes sahurs. It is handed out by the round,
spent against the house inside it, and swept when the round ends; the only thing
that crosses back is the pot, which is the real stakes and was escrowed
before the round began, so three minutes of this cannot move a sahur in either
direction. Which purse a wager comes out of is read off the player's own duel
lock on every bet rather than sent with it, so a wager cannot be aimed at the
cheap money — and one cannot be aimed at somebody's sahurs from inside a round
either. A bet does name the round it believes it is in, but that can only ever
refuse a wager: it is there so a roll meant as wood does not land on real sahurs
because the buzzer went while the player was reaching for the button.

A hand, a board or a walk outlives the request that dealt it, so each one
carries the stake it was dealt from and settles back into that: a hand dealt in
sahurs still pays sahurs after a round has started on top of it, and a hand
dealt in a round that has since ended pays into nothing, because its wood was
swept with the rest. A round will not deal over a game that is holding real
sahurs — it says so and asks you to finish that one first — since replacing it
is how the casino has always started a fresh game, and a round must never be the
thing that throws a real stake away. Retiring one of those records and moving
the wood it owes is a single commit, so a hand cannot be cashed out twice.

The round follows the player rather than waiting on the table's page: a strip
over every casino screen carries both stacks and the clock, both live, and the
result finds them wherever in the casino they are standing when it stops. The
header keeps showing sahurs the whole time, because that number is never once a
lie.

The stack on that strip is held while a table is still showing a wager. The
server answers a bet the instant it is decided, which on every table here is
well before the player has seen it happen, and painting that number as it
arrived would give the wheel away while it was still spinning, the cow away
mid-lane and the dealer's hole card away before he turned it. So the stake comes
off the pile when it goes out and the rest lands when the table says it has
finished — and the poll keeps its hands off in between, since all it knows is
the answer.

Opening a table takes you to its own page, and the way to take it down is on
that page: a countdown to when it closes itself and a button that hands the
stake straight back — once. Both stakes are debited the moment a player
commits and from then on the sahurs live in the duel record, not in anybody's
balance. Every way out — a win, a
cancel, a table nobody joined inside ten minutes, a confirm nobody gave inside
ten seconds, a player who wandered off mid-round — goes through one function
that writes the settled record and the credits it implies in a single atomic
commit. So a duel can never read as finished without the money having moved, and
it can never pay twice. Nothing is raked: whatever went in comes back out.

Nothing runs on a timer. The clocks are enforced lazily — every read of a duel
settles an overdue one first, and the lobby sweeps abandoned tables — so a stake
always finds its way home even if the host never reopens the page.
`scripts/test-duel.ts` walks every exit and counts the money after each, with a
dozen readers racing the same expiry.

### chess

The fifth pit table, and the only one that can be played for nothing: the lobby
asks whether there are sahurs on it, and a bet of zero moves no money anywhere
without a single special case in the escrow — the debit, the hold and the payout
are all `bet` arithmetic already.

The rules are the server's. A table can be played for sahurs, and a client that
can invent a move is a client that can invent a win, so the whole rulebook is
one block in `server.ts` and the pit client holds no copy of it: the board draws
the position it was sent and offers the legal moves it was given, so picking a
piece up is a filter over that list rather than a second opinion that could
disagree with the first.

That generator is verified by **perft** — counting every leaf of the move tree
from the six standard test positions and comparing against the published totals,
16,564,718 of them. It is the only test worth having for a move generator:
castling through check, an en-passant capture that exposes a rank, a pinned
knight, a promotion that gives mate are all a number that does not match, rather
than a subtlety nobody notices until it costs somebody a pot.

**Each player has their own clock**, the way chess has been played with one
since 1861, and the lobby picks which: 3 min, 3 | 2, 5 min, 10 min, 15 min or
1 hour. Only the player to move is spending anything; an increment goes back on
when they move. The table's own expiry is set to whenever the running clock hits
zero, so the same sweeper that takes down every other abandoned pit table is
what flags a chess game — one deadline, not two, and an escrow can never sit
there forever holding the other player's sahurs.

Running out loses, **unless the other player could never have mated**: against a
bare king, or a lone bishop or knight, a flag is a draw. That is the rule every
chess clock in the world implements and the one nobody remembers, and it is
`chessMatingMaterial()` in `server.ts`.

Your own move is painted **before** the server answers. The client already knows
the move is legal — the server sent the legal list it was picked from — so the
piece lands, the clock changes hands and the increment goes on locally, and the
next poll is a reconciliation rather than the thing you were waiting for. A
refusal puts the position back. What the client guesses is only the bookkeeping
around a move it was already told was legal: the rook that comes with a castling
king, the pawn taken in passing, what a promotion turns into. It still owns no
rules, and it does not guess the scoresheet — spelling a move in algebraic needs
the rulebook, so the move list is the server's and arrives with the poll.

Resigning and offering a draw are there because chess needs them. An offer
stands for whoever made it and comes off the board three ways: they withdraw
it, the player it was made to declines it, or a move answers it — an offer
does not survive the move that answers it. Met with an offer of its own, it
is an agreement rather than a second offer, which is why offering and
accepting are one action and not two.

**Tung Chess**, in the originals, is the same game against the computer instead
of a person — and it never touches the backend at all. No table, no escrow, no
polling, nothing for anybody to pay for. Two opponents: *tung's own head* is a
few hundred lines of alpha-beta with piece-square tables that ship with the page
and start instantly, and *stockfish* is the real engine — Stockfish 10, about
370KB of WebAssembly served from this site as a static file and run in a
Worker. If it cannot run — a network that blocks the wasm, a school proxy — the
game falls back to tung's own head at its strongest, the name over the board
changes to say so, and the reason stays on screen for the rest of the game.

It has to be the **single-threaded** build (`games/tung/stockfish/README.md`).
The one this shipped with first was the multi-threaded build, which needs
`SharedArrayBuffer`, and browsers only allow that on a page served with
cross-origin isolation headers, which GitHub Pages does not send and a tab the
shrine writes a game into never has. So it never started: every "stockfish"
game waited out the ten-second timeout and was quietly played by tung's own
head under stockfish's name. The single-threaded build needs nothing from the
host and answers in a fraction of a second. When the shrine is embedded on
another site, the game tab belongs to that site and a worker cannot be started
straight from this one, so the page starts a one-line worker of its own that
pulls the engine in by its full address. Either way nothing goes near the
backend, and `scripts/test-chess.ts` checks the build and that it never does.

Two things can no longer move a piece for you: an answer still on its way from
a game you have left is only ever played in the game it was asked about, and
the computer never moves on your turn, whichever timer woke it — the one that
has him open as white used to go off in the next game, where white was you.

**Take it back** goes back until it is *your* move, however many plies that is,
rather than counting two off the end: one back from a mate he has just delivered
is his move, and a board handed to somebody who is not going to play it sits on
“he is thinking” until you give up and start again. If there is no game left to
go back through — you have black and he has only just opened — he opens again.
He answers a position, not a board, so a take-back invalidates whatever he is
chewing on: the page drops an answer to a position it has left, and a second
question to stockfish stops the search already running rather than talking over
it, which is what stopped his reply to the board you took back from landing on
the board you took it back to.

The rules in the browser are **generated** from the ones in `server.ts` by
`scripts/build-chess-rules.sh`, not written beside them: two hand-maintained
rulebooks is one rulebook and a divergence waiting to happen, and if the two
ever disagreed the server would be right by definition. `scripts/test-chess.ts`
checks the generated copy has not gone stale, and makes the opponent prove
itself on positions with one right answer — a search that misses mate in one is
not a weak opponent, it is a broken one, which is exactly what the first cut of
it was.

The move list scrolls inside its panel and can never move the board. In normal
flow it counted toward the height of the row the board sits in, and since the
game is centred in the window, every move pushed the board up until *tung's own
head* ran into the header. It is now positioned out of flow in a box that takes
the panel's leftover height, and the page centres with auto margins, which
give up the space instead of pushing anything above the top. The pit's own
scoresheet was never affected: it has always been capped at 210px and scrolls.

Stockfish is GPL-3.0. It lives in `games/tung/stockfish/` with its licence
alongside it, unmodified, loaded as a separate program the page talks to over
UCI — the same arrangement every browser chess front end uses. Keep
`Copying.txt` next to it if you fork this.

#### the board is drawn once

A move used to be a whole new screen. The duel poll saw a different FEN, the
shape gate in `pitRender()` failed, and the entire casino view came down and
went back up — back button, header, names, pot, clock, board and panel — along
with thirty-two fresh `<img>` elements, each of which had to come back out of
cache and decode before its square stopped being empty. From the other seat that
reads as the board flashing every time your opponent moves, because that is
exactly what it is: not the position changing, the screen being replaced in
order to change it.

The screen and the position it carries are now fingerprinted apart. A change to
the position alone goes to `chessPaint()`, which walks the sixty-four squares
and touches only what differs: an unmoved piece keeps the element it already
had, and the piece that DID move is carried across to its new square as that
same element, image and all, rather than being made again. The printed rank and
file down the edges belong to the square and are never redrawn. Everything else
— a game ending, a table changing state — still rebuilds, because then the
screen really is a different screen.

The catch that comes with it: the handlers are bound to the board once and now
outlive every position that stands on it, so none of them may close over the
arguments they were built with. They read the live record instead, which the
repaint replaces before it draws anything. A board that stopped being rebuilt
while its handlers still held last move's legal list would offer moves that are
not there any more, which is a worse bug than the flash.

The cursor follows the same rule the board does. An 8×8 grid of pointers claims
every square is worth pressing when most of them do nothing at all, so: an open
hand where there is a piece the server listed a move from — never on their turn,
because the legal list is only ever sent to whoever is to move, and never on
their pieces — a pointer where the piece in hand can land, a closed hand while
one is being carried, and an ordinary arrow everywhere else.
`scripts/test-chess-board.ts` holds all of it.

### poker

The fourth table, and the only one that does not resolve in a single stroke.
Two to five seats, no limit hold'em: everyone buys in for the same stake, is
handed a thousand chips, and plays until one of them holds all of them. The
buy-ins are escrowed by the same create-and-join every other table uses and are
released to the last player standing by the same `commitDuel()`, so nothing new
touches anybody's balance.

The chips are the wood again under another name — dealt by the table, moved
around inside it, gone when it ends. What makes them different is that they have
to survive dozens of hands, so the whole tournament is carried on the duel
record and moves with the same atomic commit the escrow rides.

The blinds are what make it end. They step up every three minutes and are
250/500 at eighteen, then keep going to 1000/2000 — at which point a starting
stack is half a big blind and the hands play themselves. Without that, a
tournament nobody is winning would sit in the pit all night holding five
people's sahurs.

Hole cards are hidden the way a move in Tung, Wood, Fire is hidden: you are sent
your own two and nobody else's, and the rest of the table arrives as a count of
face-down cards rather than as cards. A showdown is the only thing that turns
them over, and the finished hand then stays up for a few seconds before the next
is dealt — otherwise paying the pot, busting the empty and dealing again all
happen in one pass, and the cards that won are cleared before anyone can see
them.

Two rules are worth writing down because both of them read as bugs from the
seat. **The hole card plays.** Two hands that miss the board are separated by
the best card either of them is holding, and an ace on the board belongs to
everyone, so it separates nobody: K-J beats 10-J on an ace-high board, and the
only way that hand chops is if the five on the board are the best five for both
— which means it is a straight or better, never still reading as high card.
**A raise has to be at least as big as the last one**, which is not the same as
double the bet. The first bet on a street sets its own minimum, so a bet of 100
into an unopened pot can only be raised to 200; but a raise to 100 over a blind
of 50 was a raise of 50, so it can be re-raised to 150. The raise panel prints
the minimum and, behind a `?`, the arithmetic it came from, because a table that
just refuses a number looks broken.

An uncalled bet is not a pot and was not won. When a shove is called for less,
the part nobody matched is pushed back to whoever put it out before the hands
are compared, the way a dealer does it. Left in, it still reaches the right
stack — the side-pot maths hands it back as a pot only its owner can win — but
it arrives looking like winnings, which puts the loser of the hand in the list
of winners and announces a pot taken outright as a split. Chips a player left
behind when they folded are a different thing: those were matched, so they are
won, and the push-back is measured against them.

**The number in the middle is not the running total.** What is going into the
pot on this street is already on the screen — drawn in chips in front of the
people who pushed it out — so counting it in the middle as well is the same
money twice, and a total that jumps on every call is not something anybody can
read a decision off. The middle shows the pot as it stood when the street began
and moves when the chips are actually swept in: after the flop, the turn, the
river. That is what "the pot" means at a real table, and preflop it means the
blinds are in front of the blinds rather than in the middle. The running total
rides alongside it and is what the ½ / ¾ / POT shortcuts reckon against, because
a pot-sized raise is a raise into the pot as it will be, not as it was.

**An all-in is a hand to watch, including the last one.** When the last chip
goes in with board to come, the rest of it is dealt a street at a time on a
clock with both hands face up, rather than resolving inside the request that
called the bet. That much was always true of every hand but one: the hand that
ends the tournament used to finish the duel in the same beat it paid the pot, so
the result screen replaced the board before either player had read the river
that put somebody out — on the one hand of the whole game most worth looking at.
The last hand now holds on the table like any other, for `POKER_END_MS` (three
seconds, shorter than an ordinary showdown because there is no next hand waiting
behind it), and only then does the table come down.

**Confirming a raise is not a scroll hunt.** Stacked, the raise panel is five
rows and about 230px — four times the action bar it replaces — which under a
table that already fills a laptop window pushed BET off the bottom of the
screen. A phone column has nowhere to put those rows except under each other; a
desktop window has width going spare, so above the poker breakpoint it lays out
across instead: amount and minimum down the left, shortcuts and slider in the
middle, BACK and BET full-height down the right. Two rows and about a hundred
pixels, near enough what the bar took. The press that opens it also brings the
confirm button into view, which costs nothing on a window where it already
fits. `scripts/test-poker-raise.ts` holds the layout — and holds the trap that
made the first attempt at it do nothing: `@media` carries no specificity, so a
desktop block written above the base rules it means to override loses to every
one of them while looking perfectly correct in the source.

Nothing runs on a timer here either. A player who says nothing checks if it is
free and folds if it is not, and the next hand deals itself, both off the same
lazy deadline every other table uses. `scripts/test-poker.ts` plays 2-, 3-, 4-
and 5-handed tournaments out over the wire and counts the chips on every look at
the table: what is in the stacks plus what is in the pot has to equal what was
dealt, through every side pot an all-in cuts. It also asserts a run actually
reached a showdown, because one that never does has proved nothing about the
hand rankings however green it looks. Alongside that it runs the real
`pokerFinishHand()` out of `server.ts` — not a copy of what it does — over the
four settlements that have to come out differently: an uncalled bet, a board
that plays, dead money from a folded player, and an ordinary called pot. It also
walks an all-in through its runout street by street and then waits out the hold
on the table it ended on, and watches the middle of the table hold still through
a street and move when the chips are swept in.

## moving the backend, and what it costs to run

The backend is `server.ts` and one Deno KV database; the site, the games and
the shrine's code are all served from GitHub Pages and jsDelivr, never from it.
Measured against a local copy, one open tab costs the backend a few dozen bytes
a poll: about 20 requests a minute (the room every 4 s, the conversation list
every 12 s), 0.03–0.2 MB an hour of bodies and roughly 0.5 MB with headers; a
seat at a pit table polls its 2.4 KB state every 1.2 s. Every poll stops while
the tab is hidden. Answers of a kilobyte or more go out gzipped when the client
takes it (`gzipped()` in `server.ts`): a fresh room 17 KB → 3.5 KB, a table's
state 2.4 KB → 0.8 KB, the panel 118 KB → 31 KB. What is sent and how often do
not change.

So the backend's own bandwidth is small; on a host that bills per request the
number to watch is requests — each open tab makes roughly 1,200 an hour.

**Where it runs, and how a change gets there.** The backend is the app `tung` in
the `takelearningoffline` organization on Deno Deploy, at
`https://tung.takelearningoffline.deno.net`. It is deployed from a folder on the
owner's machine with the `deno deploy` CLI and is not linked to GitHub, so
pushing `server.ts` here does not redeploy it. After any change to `server.ts`,
copy it into that local `shrine-backend` folder and deploy from there:

```
cp server.ts ../shrine-backend/
cd ../shrine-backend && deno deploy --prod
```

That folder holds `server.ts` and this `deno.json`, and needs both:

```json
{"unstable":["kv"],"deploy":{"org":"takelearningoffline","app":"tung","runtime":{"type":"dynamic","entrypoint":"./server.ts"}}}
```

Without it the build fails with "No runtime entrypoint provided", and
`Deno.openKv` is undefined — Deno Deploy has no command line to pass
`--unstable-kv` on, so `"unstable": ["kv"]` is the only way it gets turned on.
The folder is only those two files on purpose: the repo is gigabytes of games
the backend never reads.

**Taking the data with you.** There are two ways into the database, and both end
in the same file. The running app hands its own data over: `POST /admin/export`
pages through every entry with the admin key and needs nothing else — no Deno
login, no database id. Or the KV can be opened from outside over KV Connect,
`Deno.openKv("https://api.deno.com/v2/databases/<DATABASE_ID>/connect")` with
`DENO_KV_ACCESS_TOKEN` set to an organization access token (`ddo_…`); the id is
the one for the app's `<app-id>-production` database, on the database
instance's page in the Deno Deploy console.

```
# out of the running server, into a file (login keys included — keep it private;
# .gitignore keeps shrine-export*.ndjson out of the repo)
API=https://tung.takelearningoffline.deno.net ADMIN_KEY=... \
  deno run --allow-net --allow-env --allow-write scripts/kv-export.ts shrine-export.ndjson

# into another Deno Deploy app's KV, over KV Connect
DENO_KV_ACCESS_TOKEN=ddo_... \
  deno run --allow-read --allow-net --allow-env --unstable-kv scripts/kv-import.ts \
  shrine-export.ndjson https://api.deno.com/v2/databases/<DATABASE_ID>/connect

# or into a file on your own server
deno run --allow-read --allow-write --unstable-kv scripts/kv-import.ts shrine-export.ndjson /srv/shrine/shrine.db
```

Values JSON cannot carry (the giveaway entry counters are `Deno.KvU64`) travel
tagged and come back as themselves. KV does not say how long an entry had left,
so what the server writes to expire gets its full lifetime again from the
import. Import into a stopped or not-yet-started server, and redeploy one that
was already running so nothing it held in memory outlives the import.

**Running it somewhere else.** Nothing in `server.ts` is Deno Deploy–specific:
on any machine with Deno,

```
ADMIN_KEY=... SHRINE_KV_PATH=/srv/shrine/shrine.db PORT=8000 \
  deno run --allow-net --allow-env --allow-read --allow-write --unstable-kv server.ts
```

behind anything that terminates HTTPS (Caddy does it in two lines). Then point
the clients at the new address — it is written in four places:
`assets/js/shrine/config.js` (`SHRINE_API`), `embed/shrine.js` (the `API`
default, or `data-api` on the script tag), `embed/chat.html` (`PROD_API`), and
the test that pins it, `scripts/test-shrine-base.ts`. `scripts/test-kv-export.ts`
checks the export, both scripts and the gzip.

## working on it

```
deno run --allow-net --allow-env --unstable-kv server.ts        # backend
deno run --allow-net --allow-read --allow-sys \
  jsr:@std/http/file-server -p 8080 .                           # static site
```

The backend reads four environment variables, set on Deno Deploy under
Settings -> Environment Variables. `ADMIN_KEY` is required to approve anyone.
The two webhooks are optional and independent — shop redemptions and new
applications post to their own Discord channel, and whichever is unset simply
goes quiet.

| variable | what posts there |
| --- | --- |
| `ADMIN_KEY` | — (password for `/admin`) |
| `SHOP_WEBHOOK_URL` | shop redemptions, including anything the buyer typed |
| `APPLICATION_WEBHOOK_URL` | new applications |

`PROXY_URL` is where the shrine's web veil actually goes. It lives in the
environment rather than in this repo so the destination is not sitting in public
source, and the server hands it out only to someone entitled to it.

Reaching it takes two separate yeses, and the URL travels only when both are
given:

1. the global switch on the **Web veil** pane of `/admin`, and
2. that member being approved on the **Manage users** pane, on the web-veil line
   under their timeout controls.

Both take effect immediately, with no redeploy. Miss either and the member gets
a holding page instead — the same page in two wordings, one for a shut veil and
one for a veil that is open but not to them. With `PROXY_URL` unset the veil
stays shut whatever the switch says, so it can never open a blank tab.

`WISDOM_MIN_MS` and `WISDOM_MAX_MS` (default 45m / 2h) bound the gap between two
Wisdoms of Tung — the lines he drops into the chat on his own. He only speaks
into a room that is already talking, so the roll happens on a real message and
a dead chat stays dead. Set both to a couple of seconds to watch one happen.

One line in five is a giveaway instead: the same voice, but with a button under
it worth `WISDOM_GIFT_AMOUNT` sahurs (default 50) to whoever reaches it first.
`WISDOM_GIFT_CHANCE` (default 0.2) sets the odds; 1 makes every line a giveaway,
which is how the tests force one. The claim and the payout land in a single
atomic commit, so exactly one person can ever win a given gift and the winner is
paid exactly once — `scripts/test-gift-claim.ts` throws a dozen simultaneous
claims at one gift and counts the money.

Plinko's board takes several balls at once. Each drop is its own request and
the server holds no plinko state, so they cannot interfere; the client just
stopped locking its button. The fall is a frame loop rather than a slide down a
wire — a ball crosses at a steady rate, falls with y going as t squared so it
accelerates the way a dropped thing does, and kicks off each peg it clips, which
is the part that reads as a bounce. None of that can move a ball: the waypoints
are computed from the server's own left/right path before a frame is drawn, and
the last of them is the exact centre of the bucket that path adds up to.
`scripts/test-plinko-balls.ts` checks every one of the 256 paths through an
8-row board and a few hundred each at 12 and 16, all landing dead on centre.

## leaving a table mid-game

Mines, beef and blackjack outlive the page they were dealt on. The stake goes on
the deal and the board is held server-side for `GAME_TTL`, so closing the tab
never ended a game — but nothing ever read one back, which made it look exactly
like losing it, and the next deal would overwrite the board and take the stake
with it. Worst at the very start: deal a mines board, touch nothing, come back,
and the stake was gone without even a half-played board to show for it.

`GET /cas/resume` is the way to ask. Each of the three views calls it on the way
in and paints whatever it finds — the board, the lane, the hand — and mentions
it if the open game belongs to one of the other two, so a board is never left
open on a screen nobody is looking at. It answers with the same shaping the
game's own replies use mid-play, so a resumed table can never show more than a
played one: never the mine layout, never the lane the cow dies in, never the
dealer's hole card.

## what an account is allowed to cost

Every route in here that carries a session token skips the anonymous
90-a-minute IP cap. That is deliberate — a school NAT full of approved members
must not be one identity — but it means that for an approved account, a route
with no clock of its own has **no ceiling at all**. Not a high one: none. A
sweep of the whole surface turned up rather a lot of those, and they are all
closed now.

* **The house tables.** `/cas/dice`, limbo, roulette, plinko, blackjack (start
  and every hit/stand/double/split), mines (start, pick, cash out) and beef
  (start, step, cash out) are a KV read and a KV write each, and had nothing on
  them. A balance that random-walks never runs out, so one account could hold
  the tables down at whatever rate it could open sockets, forever. `CAS_BURST`
  (30 per 10s) is far above anything a hand can do — the fastest table animates
  for most of a second. It is env-overridable for exactly one caller:
  `scripts/test-limbo-rtp.ts` fires sixty thousand spins through limbo to
  measure the house edge, and says so in its own header.
* **The pit.** `/duel/state` is polled every 1.2 seconds by every player at a
  table, and every action route (`join`, `confirm`, `cancel`, `start`, `call`,
  `move`, `chess`, `poker`) had no clock either. `PIT_BURST` is 300 per 10s —
  about forty times what a client does, and a fortieth of what a socket can.
  It is a wall for a script and invisible to everything else.
* **The pit lobby.** `/duel/list` used to walk up to two hundred duel records
  every 1.5 seconds and throw away the ones that were not open — and a finished
  duel lingers a day so both players can read the result, so nearly everything
  it read was history. It was the most expensive read in the casino by a
  distance. A table that is open now has a key of its own, `["duelopen", id]`,
  written and deleted by the same commits that move it in and out of that
  state; the lobby lists those and reads only the tables they name. It has a
  clock on it as well.

  The index is a **hint**, never the truth — the duel record is that, and the
  lobby checks every entry against one. An entry naming a table that is no
  longer open is deleted on sight, so a commit that somehow missed one costs a
  single wasted read, once. The direction that would actually matter, an open
  table with no entry and so invisible to everybody, cannot happen: the only
  commit that ever creates an open table is the one that creates its entry.
  `scripts/test-pit-index.ts` walks a table from put-up to filled, to
  cancelled, to expired, and counts the commit sites in the source so that a
  new one added later cannot quietly skip the index.
* **The application thread.** `/respond` appended to an array on the account
  record and wrote it back, with no cap and no clock, and an applicant holds a
  token. One KV value could be grown for as long as somebody liked — read back
  by every `/status` poll, read by `/admin/pending` for every applicant at once,
  and eventually big enough to hit the hard value-size limit and make the
  account unwritable. Capped at `THREAD_MAX` (30 lines, oldest off the top,
  from both ends of the conversation) and clocked at four answers per 30s.
  It also ends with its verdict: approving, rejecting or sending somebody to
  tung takes the thread off the record (`dropThread()`), so sending them back
  to review later opens on an empty thread rather than the old questions — and
  `/admin/repend` drops it too, for a record decided before that rule. Once an
  application has its verdict neither `/respond` nor `/admin/message` will
  write to it (409), and `/respond` commits against the version it read, so an
  answer racing a verdict cannot put the thread back or flip the account to
  pending. `scripts/test-app-thread.ts`.
* **The shelves.** Every walk of `["shopitem"]` is bounded (`SHOP_MAX`), as is
  the per-member list of unfinished redemptions, and `/shop/list` and `/themes`
  are clocked. They are opened, never polled; there are a dozen shop entries in
  practice, and the cap is only the difference between "small" and "unbounded".
* **Tips and giveaways.** `/tip` writes two balances and is the one route a
  member can aim at somebody else's record; `/gift/claim` races eight times for
  a giveaway that only one person can win. Both are clocked well above what a
  person does. Every tip that goes through is written to a log in the same
  commit as the two balances — so a retried one (same `tipId`) is logged once,
  and a refused one never — and the panel's **Sahur transfers** pane reads it:
  everybody's, newest first, or one member's sends and receipts with what they
  add up to (`POST /admin/tips`, kept 90 days). Credits from the panel are not
  transfers and are not in it.
* **Table talk** is clocked twice: five lines in five seconds against a burst,
  and 120 an hour across isolates, because a line is two writes and a read on
  the next poll of every other client at the table.

### the pile of applications

`/apply` is the one route that makes an account, and it is anonymous, so the
only thing in front of it is the 90-a-minute IP cap — ninety accounts a minute,
three KV writes each, and ninety more rows in a list tung reads whole every time
he opens the panel. A morning of that and the panel is useless while the door
still works.

The obvious guard is a rate cap per address, and it is the wrong one here: this
repo's own suite applies dozens of times from one address, and a guard that
turns the tests red is a guard nobody keeps. So the cap is on the thing that
actually does the harm — **the size of the pile, not the speed it arrives at**.
`PENDING_MAX` (200) unanswered applications is the ceiling; past it the door
says *"tung has more applications than he has read, try again later"* and stops
writing. Answering them is what makes room for more, which is how it ought to
work anyway, and the tests never come near it because they approve what they
apply for.

The counter in front of that is **allowed to be wrong**. It only ever goes up —
nothing decrements it when tung answers one — so it drifts past the truth and
eventually trips. That is the design: a counter that trips is never believed, it
is checked against a walk bounded by the ceiling itself and then put right. The
worst drift can do is spend one bounded count on one application; the failure it
can never produce is the one that would matter, which is the door shut on
somebody real because a number was stale.

The walk is over `["pendq"]`, an index of the applications still waiting: the
commit that makes an application writes its row, and every verdict, account
delete and wipe takes it out (re-review puts it back). It first walked the
first `PENDING_MAX + 1` rows of *every* account instead, which only counted the
pile while the pile was most of the accounts — once members outnumbered it,
those rows were nearly all approved, the count came back near zero, and the
ceiling never shut. Each index row is checked against the account it names, and
one whose account is not pending is dropped rather than counted, so a stale row
can cost a walk but can never turn anybody away. `scripts/test-apply-flood.ts`
lets in half a pile's worth of members first, then floods it, checks it stops at
the ceiling rather than at a rate, and checks that answering some lets the next
applicant straight in. Every one of those applications also comes out of the
anonymous IP cap the next test in a suite run shares, so it finishes by waiting
out that minute — about a minute longer, and the next test starts with all of
it.

Everything member-facing that takes a string `clip()`s it; every `innerHTML` in
the admin panel interpolates a server-fixed error string and never member text,
which goes through `textContent` and text nodes; and every unbounded `kv.list`
left in the file is behind the admin key, where dumping the lot is the point.

## the tables, and how fast they move

Dice, limbo, roulette and plinko all animate an outcome the server has already
decided, so how long the animation takes is free. They take their time by
default — the wheel slowing down and the plinko ball picking its way through
the pegs is most of what there is to watch — and each carries a lightning
button that speeds them up. It is **one** setting, shared by all four and
remembered between visits, because turning it on per game would be maddening.
Mines, beef and blackjack have no button: there you are the slow part.

`pace(slow, fast)` is the only place the setting is read, and
`scripts/test-table-pace.ts` checks that every call to it sits on a line that
picks a duration or a number of wheel turns — never anything a wager, a
multiplier or a path depends on. A speed button that could reach the money
would be a cheat button. The roulette wheel takes its durations from two CSS
custom properties the client sets at spin time, rather than a number frozen in
the stylesheet, so the button can reach them.

The roulette felt is the real layout: zero down the left across all three
number rows, the numbers in the rows a table actually uses (3, 6, 9… along the
top), and every outside bet touching what it covers — each column's box at the
end of its own row, each dozen spanning its twelve, the even-money bets two
columns apiece along the bottom, with red and black wearing red and black
diamonds. Every chip states its odds. The part that can silently go wrong is
the column mapping: `/cas/roulette` pays column *v* when `spin % 3 === v % 3`,
so the row of threes along the top is column **3**, and the test checks the
felt's labels against the server's own rule rather than against a comment.

## the bank

A third button in the casino header, next to the Shrine and the Shop: the **Bank
of Tung**. It is the shrine's altar next door and reads like one —
one character, one thing he does, one button — except the shrine gives and the
bank lends.

The face behind the counter is rolled fresh each time the page opens: `BANK_IMG`
nine times in ten, `BANK_RARE_IMG` the other one. Both paths and the odds
(`BANK_RARE_CHANCE`) sit together in `assets/js/shrine/config.js`.

Borrow up to your cap and you owe the loan plus ten percent, added once at
signing, so what you owe never moves again except downward. One debt at a time:
topping a loan up would mean charging interest on interest or tracking each
slice's own rate, and neither is worth it at this size. Pay it back in part or
in full whenever you like — or do not, and the bank takes half of every Shrine
of Sahur claim until it is square. On a garnished claim the win toast shows the
five that landed and says what the other five went to.

Two things it will not do. It never takes more than is still owed, so the last
claim of a loan hands the remainder back to the player rather than overpaying
the debt. And a loan and the sahurs it puts in your hand are one commit, as are
a claim's payout and the debt it pays down — there is no instant where a debt
exists that was never paid out, or a player is paid without the debt moving.

The cap is twenty-five sahurs by default, and there are two ways to move it,
both on the **Casino balances** pane of `/admin`. **Set loan cap** is the
permanent one: it is their cap until it is set again, zero shuts the bank to
them, and clearing the field puts them back on the house default rather than
pinning them to whatever it is today. **Grant one-time** is the other: an extra
that sits on top of whatever the cap is and is spent the moment they borrow —
whatever size that loan turned out to be — so "go on, just this once" cannot
quietly become a new ceiling. The bank screen shows the two apart, as a cap and
a *this once*, for the same reason. An unspent one can be taken back.

The one-off comes off in the same commit that writes the loan, so two borrows
racing cannot both lean on it. The same pane shows what each member currently
owes and can write that debt straight to the ledger — no interest is added by
the correction, and zero wipes it.

## the sahur watch

Free sahurs invite scripts: claim the faucet the second its two hours are up,
around the clock, and take every one of tung's giveaways before a person could
have read the line. The **Sahur watch** pane of `/admin` is where those get
caught.

Every claim — faucet or giveaway — is written down (`["claimlog", uid, ts, rid]`,
kept `keepDays`): when, what it paid, how long it had been claimable (for a
giveaway, how long since tung posted it), a tag for the network it came from,
and what the page could say about the click. The network tag is a SHA-256 of the
address salted with the admin key, cut to ten hex characters: two claims from
the same place match, and nobody can turn it back into an address. The page's
part (`window.__claimProof` in `chat.js`, used by the giveaway button and the
casino's altar) is whether the click was a real one (`isTrusted`), whether the
tab was visible and focused, and how long mouse, keys and touch had sat still
before the click (the click itself does not count, so a macro clicking a mouse
nobody has moved for an hour shows exactly that). A script that posts to `/cas/claim` or `/gift/claim` directly sends
none of it, and a proof that is not exactly right is clamped to "no".

Eleven rules read that log each time the member claims: too many claims in a
window, claiming within seconds of the cooldown ending, gaps between claims
that barely vary (clockwork), no long break across a day (never sleeps),
several busy days running, claims with no real click, claims from a hidden tab,
real clicks with nothing moving before them (hands never move), giveaways
taken within milliseconds, too many giveaways won, and several
accounts on one network (off by default — a school is one network). The rules
are in `server.ts`, which is public; **what they are set to is not**. Every
number, whether each rule is on, how many must trip at once before somebody is
flagged, how long a dismissal keeps them off the queue and how long logs are
kept all live in KV (`["watch", "config"]`) and are changed on the pane's
**detection rules** tab. Reading the code tells somebody which rules exist, not
where any line is, and slipping under all of them means claiming like a person.
**check everyone against these now** re-reads every member's log after a change.

Whoever trips enough rules lands in **review**, with what tripped and why.
Opening them — or looking anybody up by name — shows their numbers, the last
seven days as an hour-by-hour dot chart (a person's week has nights in it; a
script's does not), the networks they claimed from and who else did, and every
claim in a table with the numbers the rules read, the suspicious ones
highlighted. Then a verdict, any mix of:

- **bar them from claiming** for so many hours — the faucet, and giveaways
  unless that box is unticked;
- **pay their claims at** some percent for so many days (7 by default) — the
  faucet and giveaways both; at 0% a giveaway is refused rather than won for
  nothing, so it stays up for somebody else;
- **make them wait** a multiple of the two hours between faucet claims;
- **take back** everything the log shows they claimed in the last so many days,
  never below zero;
- **time them out** of the whole site, through the same timeout as Manage users —
  their lockout says **sahur caught you**, with any words you add under it;
- **warn them as tung** in a DM — sent before the timeout, which would shut
  tung's DM out.

The casino shows a punished member what is happening to them under the altar's
button — the reduced amount, the longer wait, or "the altar is closed to you"
with the date it opens. A verdict closes the review, and the claims it was
given for are spent: only claims after it can flag them again. **not a bot —
dismiss** closes it too and keeps them off the queue for a few days. A penalty
can be lifted early from their card; deleting the account takes its log, flag
and penalty with it, and wiping every account from **Wipe data** clears the lot.

Nothing here polls. The rules run inside the claim request (twelve faucet
claims a day at most, per member) and when the pane asks, and a failure inside
the watch never refuses the claim it follows. `/cas/claim` itself is capped at
six requests in ten seconds per member, so a script asking over and over for
the cooldown to end is turned away before it costs more than a counter. One thing to know when reading a
flag: a page opened before this shipped sends no click proof, so an old tab
left open reads as "no real click" until it is reloaded. `scripts/test-sahur-watch.ts`.

## settings and skins

A boxed gear in the top-left of the main menu opens the settings page: the
**theme**, and the **tab disguise** — the title and favicon this window and
every game tab opened from it wear, which used to sit as a bar over the catalog.
The chosen theme is stamped on `<html data-theme>` as the document is written,
so a dark window never flashes the wood first.

Skins are property. Only Tung's Wood is free, and it is also the base
stylesheet, so it overrides nothing. **Every other theme is locked to every
member until tung puts it in the shop and that member buys it** — and that is
the default on purpose: adding a row to `SHRINE_THEMES` in `server.ts` (plus its
block in `styles.js`) ships a skin nobody can wear yet rather than quietly
handing it to the whole shrine. The shop editor on `/admin` scans that registry,
so a new theme appears in its dropdown by itself and only needs a price.

Ownership is per member, lives in KV, and is the server's to state: the settings
page asks `/themes` what it may wear and draws a padlock over anything else, so
a locked skin cannot be selected by editing the client — it simply is not in the
stylesheet that was served. Buying charges once, re-buying is refused rather
than taken as a donation, and taking an item off the shelves does not repossess
what people already bought. `scripts/test-themes.ts` covers all of it.

A skin is a palette, not a stylesheet. `assets/js/shrine/styles.js` holds one
list of every surface a theme repaints, written once with braced token names
where the colours go, and stamps a palette into it per skin — so adding a theme
is a few colours in `assets/js/shrine/config.js` and no CSS at all, and it
cannot miss a surface, because every skin is generated from the same list.

A palette wants three colours — `bg` the ground, `text` the ink, `accent` the
colour the skin is actually about — and the rest of the ramp (panels, borders,
hovers, the muted greys, the solid buttons) is mixed from them. The accent is
spent on the text ramp rather than blended into the surfaces, which is where the
wood spends its orange, so a skin with nothing but an accent still reads as that
colour instead of as another grey. An accent too close to its own ground to be
read is walked toward the ink until it clears. Any single token can be spelled
out to override what the mix would have chosen: **Dark Mode** pins all of its
own, because it was hand-picked before the engine existed — and
`scripts/test-theme-engine.ts` checks it comes back out of the engine exactly as
it went in, along with the promise that three colours fill every token.

The other half of a skin is a row in `SHRINE_THEMES` in `server.ts`, which is
what decides whether it is free or has to be bought; the two lists have to
match, and that test checks it.

## admin

The admin key never travels in a URL. `/admin` is a small door — it is also an
egress guard, so a scanner that finds it gets 800 bytes rather than the 37KB
panel — and the panel itself comes back from a POST, written into the page the
door is already on. The address bar says `/admin` the whole way through, and
every read the panel makes carries the key in an `x-admin-key` header, so it
reaches no history entry, no bookmark and no access log. An old bookmark with
`?key=` on it is redirected to the bare path rather than served. The query
parameter is still accepted, because the scripts in `scripts/` pass it that way
from a terminal, where none of those exposures apply.

The panel is one inline script, so a syntax error anywhere in it is a syntax
error everywhere: the shell renders, the key box sits there, and not one button
does anything. `\n` inside the template literal that holds the page is a real
newline by the time it reaches the browser, which inside a JS string is the end
of the script — it has to be written `\\n`. That is worth a look before
wondering why a pane is empty.

`/admin` has a **Post as…** pane: drop a line into the chat under an approved
member's name. It is the one place in the app where a message's author is not
the account that sent the request — key-gated, and the name still has to belong
to somebody real. Tung speaks from **Talk to da people → general chat**, where
the room he is talking to is in front of him; the route behind both
(`/admin/postas`) still takes his name.

**Clearing the chat log** takes the words with it, not just the log. A line
lives in two places: the `["ev", seq]` entry the room replays, and `["msg", id]`
— what it actually said, which is where the server reads a quote from when
somebody replies by id, and what a reaction checks before it is allowed. Left
standing, anybody still holding an id could post a fresh line carrying a wiped
message's author and text back into the room word for word, and could still
react to something nobody could see. So the quote index goes with the log, and
`["rx"]` — who has reacted to what — goes with it rather than pointing at
messages that no longer exist, which is what a single moderator delete has
always done. The `["seq"]` counter deliberately stays: it is the cursor every
connected client is holding, and winding it back would make the next messages
reuse numbers those clients have already passed, so they would never arrive.

There are two bans on the **Manage users** pane and they are not the same ban.
**ban** shuts the whole shrine: chat, casino, the pit, the veil, the catalog,
tung's originals, everything — and so does a **timeout**, until it runs out.
The page shows it as one screen over all of it, wherever the member is when it
lands: "you are timed out" with a countdown (or "you are banned"). It used to be
the room's own ban screen, which only the Shrine tile ever showed, so "back"
walked straight past it into everything else. Whichever of the page's existing
requests hears it first — `/status` on open, the room's poll that runs under
every view, or the casino being refused — puts the screen up; it stops the
room, the conversations and the casino behind it, closes every game tab the
page opened, and refuses every view while it is up. A timeout counts down,
asks once when it runs out, and is re-checked every five seconds so one lifted
early from here is picked up too; nothing on the server was added for any of
it. `scripts/test-lockout.ts`.
A timeout can carry a **reason**, typed next to it on the card; the lockout
reads it back to them as *tung says: "…"*, and clearing the timeout clears it.
Tick **farming sahurs** (or time them out from the Sahur watch, which always
does) and the screen becomes sahur's own catch — **sahur caught you**, and a
line from him about hands and altars — with the reason, if any, under it. Both
ride on the answers the page already gets (`/status`, the room's poll,
`/login`) as `why` and `kind: "sahur"`; the embed's chat says the same.
**ban from chat** shuts the room and only the room — they cannot read a line and
cannot post one, and their DMs go with it in both directions, while the casino,
the pit, the catalog, the shop, tips and the veil keep working exactly as
before. Server-side the two are separate flags on
the account and separate gates: `blockState()` is the wide one every other part
of the app asks, `chatBlock()` is the one every chat route asks, and the chat
routes are the only ones allowed to use it. Nothing else may reach `chatBlock()`
and no chat route may skip it — that is what keeps a chat ban from quietly
becoming a full one, or a full one from leaving the room open. Setting one flag
never touches the other, and lifting one never lifts the other; a live timeout
or a full ban outranks the chat ban in what the banned member is told, and the
chat ban is still there when either is lifted. `scripts/test-chat-ban.ts` walks
all of it — both halves of the room shut (including a giveaway claim, which
announces the claimant by name, and including a request that pads itself with
the admin key to try to widen the history window), everything else still open,
and the room handed back when the ban is lifted.

**Moderators** are the third switch on the same card, and the only one that
hands power out rather than taking it away. A moderator gets a bin next to the
react and reply buttons on every chat message and can delete any of them;
everybody else gets it only on their own lines, and `POST /delete` refuses them
anybody else's — including somebody whose flag was taken back — and refuses
somebody barred from the room outright. A delete marks the `["ev", seq]`
entry deleted, so no member's window or poll ever serves it again while the
admin chat dump keeps it, tagged with who deleted it and when; the
`["msg", id]` quote index goes, so the line can no longer be quoted or reacted
to; and a `del` event tells every client already holding it on screen to drop
it. The flag itself is deliberately invisible: it rides on `/status` and
`/login` to the account that holds it and on `/admin/users` to this page, and
nowhere else — no event, no reaction, no profile and no room dump carries it, so
nobody in the chat can work out who the moderators are.
`scripts/test-moderation.ts` walks both halves: the bin works and only for
moderators, and every route another member can read is checked for the flag.

**Deleting a user** takes everything they said with them: their lines in the
room and the quote index behind them, their reactions, quotes of them inside
other people's replies, and both sides of every DM they were in — tung's
included. Nobody else's words go with it, and open windows drop the lines in one
`del` event that lists them, not one event per line. **Clear all applications**
does the same for everybody.

Accounts deleted before that rule left all of it behind, and the panel listed
their conversations as "(gone)". Those are cleared two ways, neither of which
puts anything on a poll: whenever something is already looking at one and has
paid for the read that noticed — the DM dump's list of who somebody talked to,
tung's inbox, or a member trying to open one from their rail — that
conversation is deleted on the spot instead of being shown; and **clear what
deleted accounts left behind** on the Manage users pane does one pass over the
rails, the reaction rows and the quote index, looks each id up once, and clears
everything belonging to ids with no account behind them. Room lines from before
lines recorded their author's id are matched by name, and only by a name a
deleted account's conversations still remember and no living account holds;
anything older than that ages out of the room on its own within two weeks.
`scripts/test-user-purge.ts` deletes an account and checks all of it, then
(given the database path) recreates leftovers the old way and checks each way
they are cleared.

The chat polls `/events` every 4 seconds while the tab is visible, and not at
all while it is hidden. **Every** poll works that way now, which it did not used
to: the room was the only one checking, while the conversation poll (2.5s), the
rail (12s), the pit list (1.5s), a duel being played (1.2s) and a round table
(1.4s) all carried on against a tab nobody was looking at. A member sitting at a
poker table with a conversation open is about a hundred requests a minute, and
before this roughly eighty-five of them continued after they switched tabs and
walked away — every one a KV read somebody is paying for. A tab left open on the
pit overnight was the single most expensive thing the shrine did.

The intervals still tick; they just do not reach the network while
`document.hidden`. Coming back refreshes at once rather than waiting out a
tick — in the chat by kicking the polls off the `visibilitychange` handler, and
in the casino through one `onWake` slot holding whichever view is live, a slot
rather than a list so that re-entering a view cannot pile up handlers for views
that are gone.

**Maintenance** is the switch for when the database should stop being used at
all — the quota is nearly spent, or something needs doing to the data. Turned on
from the panel's **Maintenance** pane, every route but `/admin…` and `/version`
answers `503 {maintenance: true, msg}`, decided at the very top of `handle()`
before anything that reads KV, the IP cap's token lookup included. Checking the
switch costs nothing per request: each running copy of the server holds the
answer in memory and reads `["maint"]` back at most every 30 seconds, so the copy
that flipped it knows at once and any other copy within half a minute. On the
page, whichever request hears it first puts up the lockout screen as **the
shrine is resting**, with tung's message under it if he left one, and stops the
room, the conversations and the casino behind it — but leaves game tabs open,
since those never touch the server. It asks again every 30 seconds rather than
every 5, and lifts the way a timeout does, when `/status` gives a real answer;
the chat embed does the same. Nothing is deleted. `scripts/test-maintenance.ts`.

`scripts/test-*.ts` are standalone `deno run --allow-read` checks; the ones that
read source go through `scripts/shrine-sources.ts` so they keep working when a
chunk moves file. The live ones talk to a server you start yourself, and a
handful want it started with particular dials — each of those says so in its own
header. Two are worth knowing about without
reading them first: `test-limbo-rtp.ts` fires sixty thousand spins to measure
the house edge and therefore needs `CAS_BURST=100000` on the server it is
pointed at (run it against its own process rather than the one the rest of the
suite is using), and `test-apply-flood.ts` fills the pile of unanswered
applications to its ceiling, so it wants `PENDING_MAX=12` or it spends a couple
of minutes doing it two hundred times. `scripts/refresh-games.sh` re-vendors the gn-math loader
stubs, and `tidy-games.js` rewrites the `GAMES` array in
`assets/js/shrine/games-catalog.js`.
