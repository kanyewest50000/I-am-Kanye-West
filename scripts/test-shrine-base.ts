// Shrine.BASE — where the shrine looks for its own files.
//
// The artwork, Tung's originals and the 830 vendored games are repo files, and
// every module that builds one of those URLs resolves it against Shrine.BASE.
// Served from our own pages that is the page's folder, which is what it has
// always been. Pasted into somebody else's page by embed/shrine.js it is set
// to our Pages URL instead, because location.href is then their host, where
// none of these files exist — and a catalog quietly resolving 777 entries onto
// a stranger's domain is the failure this base exists to prevent.
//
// So: the default must not move (case A), the override must be obeyed (B, C, D),
// and the modules must still load without config.js (E) — which the tests in
// this directory do, with a stub Shrine that has only LBL on it.

import { ROOT, SHRINE_FILES, readShrineFile } from "./shrine-sources.ts";

const PAGES = "https://kanyewest50000.github.io/offline-learning/";
const DENO = "https://tung.takelearningoffline.deno.net";

function must(ok: unknown, msg: string) {
  if (!ok) throw new Error(msg);
}

const sources = await Promise.all(SHRINE_FILES.map(readShrineFile));

/** Run the whole shrine against a fake page and hand back window.Shrine. */
// deno-lint-ignore no-explicit-any
function boot(href: string, shrineBase?: string): any {
  const store: Record<string, string> = {};
  // deno-lint-ignore no-explicit-any
  const win: any = {};
  win.window = win;
  win.localStorage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = String(v); },
    removeItem: (k: string) => { delete store[k]; },
  };
  win.document = { write() {}, open() {}, close() {} };
  if (shrineBase !== undefined) win.SHRINE_BASE = shrineBase;

  const u = new URL(href);
  const loc = {
    href, search: u.search, hash: u.hash, origin: u.origin, protocol: u.protocol,
    host: u.host, hostname: u.hostname, port: u.port, pathname: u.pathname,
  };
  new Function("window", "location", "localStorage", "document", sources.join("\n;\n"))(
    win, loc, win.localStorage, win.document,
  );
  return win.Shrine;
}

/** Every host the assembled shrine document actually points at. */
function hostsIn(doc: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of doc.match(/https?:\/\/[a-z0-9.\-]+/gi) ?? []) {
    const h = m.replace(/^https?:\/\//, "");
    out[h] = (out[h] ?? 0) + 1;
  }
  return out;
}

/** The repo URLs every module builds, which all have to sit under the base. */
// deno-lint-ignore no-explicit-any
function repoUrls(S: any): string[] {
  return [
    S.TUNG_IMG, S.TUNGGOD_IMG, S.BANK_IMG, S.BANK_RARE_IMG,
    // deno-lint-ignore no-explicit-any
    ...S.ORIGINALS.map((g: any) => g.u),
    // deno-lint-ignore no-explicit-any
    ...S.GAMES.map((g: any) => g.u),
  ];
}

// ---- A. the default has not moved -----------------------------------------
// The shrine on its own site, with nothing set. This is the case that must
// behave exactly as it did before the base became a value.
{
  const S = boot(`${PAGES}index.html`);
  must(S.BASE === PAGES, `default base should be the page's folder, got ${S.BASE}`);
  must(
    S.TUNG_IMG === `${PAGES}assets/tungtungtungsahur.png`,
    `artwork must resolve beside the page, got ${S.TUNG_IMG}`,
  );
  must(
    S.ORIGINALS[0].u === `${PAGES}games/tung/flappy.html`,
    `originals must resolve beside the page, got ${S.ORIGINALS[0].u}`,
  );
  const off = repoUrls(S).filter((u) => !u.startsWith(PAGES));
  must(off.length === 0, `default must keep every repo URL on the site: ${off[0]}`);

  // a query string or a fragment on the page is not part of the base
  const q = boot(`${PAGES}index.html?tab=2#frag`);
  must(q.BASE === PAGES, `query and hash must not reach the base, got ${q.BASE}`);
}

// ---- B. the override is obeyed --------------------------------------------
// The embed case: pasted on a host that has none of these files.
{
  const S = boot("https://my-project.replit.dev/index.html", PAGES);
  must(S.BASE === PAGES, `SHRINE_BASE must set the base, got ${S.BASE}`);

  const off = repoUrls(S).filter((u) => !u.startsWith(PAGES));
  must(off.length === 0, `every repo URL must follow the base: ${off[0]}`);
  must(S.GAMES.length > 800, `expected the full catalog, got ${S.GAMES.length}`);

  const remapped = S.GAMES.filter((g: { u: string }) => g.u.includes("/games/g/"));
  must(remapped.length > 700, `gn-math entries must be remapped, got ${remapped.length}`);

  // the game frame's base is baked into the emitted client as a literal, so it
  // has to be checked in the string rather than on the object
  must(
    S.CHAT_JS.includes(JSON.stringify(`${PAGES}games/g/`)),
    "the emitted chat client must carry the based game-frame URL",
  );

  // nothing in the finished document may point back at the host it was pasted
  // into — that is the whole failure this is here to catch
  const doc: string = S.doc("");
  must(!doc.includes("replit.dev"), "the shrine document leaked the embedding host");
  const allowed = new Set([
    "kanyewest50000.github.io",     // the repo's own files
    "tung.takelearningoffline.deno.net", // the backend
    "cuhsd.instructure.com",        // the cloak favicon
    "www.w3.org",                   // svg namespaces
    // The chess piece sets, and the ONLY third-party host the shrine reaches
    // for. It is a fallback, never the first choice: each board looks in
    // games/tung/pieces/<theme>/ first and only asks this one if the repo has
    // no copy, because a school filter is far more likely to swallow
    // chess.com than to swallow our own Pages site. If neither answers the
    // board draws glyphs. Anything else appearing in this list is the bug this
    // check exists to catch.
    "images.chesscomfiles.com",
  ]);
  const strays = Object.keys(hostsIn(doc)).filter((h) => !allowed.has(h));
  must(strays.length === 0, `unexpected host in the shrine document: ${strays.join(", ")}`);

  // the piece set is tried OUR copy first and chess.com second, never the
  // other way round — a remote-first board is one a blocked network breaks
  const probe = S.CASINO_JS.slice(S.CASINO_JS.indexOf("function pcProbe("));
  const ours = probe.indexOf("PIECES_BASE");
  const theirs = probe.indexOf("PIECE_REMOTE");
  must(ours > 0 && theirs > 0, "the probe must know about both sources");
  must(ours < theirs, "the repo's own piece set must be tried before chess.com's");
  must(
    S.PIECES_BASE.startsWith(PAGES),
    `the piece set must resolve against the base, got ${S.PIECES_BASE}`,
  );
  must(doc.includes(DENO), "the shrine document must still reach the backend");
}

// ---- C. a base is a folder, with or without the slash ----------------------
// Without this, "…/offline-learning" resolves as a sibling and every path
// lands a level too high — silently, and on URLs that still look plausible.
{
  const S = boot("https://w3schools.com/tryit.html", "https://kanyewest50000.github.io/offline-learning");
  must(S.BASE === PAGES, `a base missing its slash must be completed, got ${S.BASE}`);
  must(
    S.TUNG_IMG === `${PAGES}assets/tungtungtungsahur.png`,
    `paths must not climb out of the base, got ${S.TUNG_IMG}`,
  );
}

// ---- D. ?base= wins, for a one-off test without editing anything ----------
{
  const S = boot(
    `https://host.example/p.html?base=${encodeURIComponent(PAGES)}`,
    "https://wrong.example/",
  );
  must(S.BASE === PAGES, `?base= must beat the global, got ${S.BASE}`);
}

// ---- E. the modules still stand up without config.js ----------------------
// Several tests in this directory run chat.js alone against a stub Shrine that
// carries only LBL. Reading Shrine.BASE off that gives undefined, and
// new URL(path, undefined) throws — so each module falls back to the page.
{
  const stubbed = ["assets/js/shrine/games-catalog.js", "assets/js/shrine/originals.js", "assets/js/shrine/chat.js"];
  for (const name of stubbed) {
    const src = await readShrineFile(name);
    // deno-lint-ignore no-explicit-any
    const win: any = { Shrine: { LBL: { POPUP: "p", ORIGINALS: "o", WEB_VEIL: "w" } } };
    win.window = win;
    try {
      new Function("window", "location", src)(win, { href: "https://example.test/p/page.html", search: "" });
    } catch (e) {
      throw new Error(`${name} must load without config.js: ${e instanceof Error ? e.message : e}`);
    }
  }
}

// ---- F. the embed keeps code and files on the right hosts -----------------
// jsDelivr serves .html from /gh/ as text/plain, so a game fetched from it
// arrives as its own source instead of rendering. Code may come from a CDN;
// the files may not.
{
  const embed = await Deno.readTextFile(`${ROOT}/embed/shrine.js`);
  must(embed.includes("window.SHRINE_BASE"), "the embed must set the base before the modules load");
  must(embed.includes(PAGES), "the embed must default its base to our Pages URL");
  must(embed.includes("s.async = false"), "the modules must keep their load order");

  // the base the embed hands over must not be a CDN
  const base = embed.match(/data-base"\)\s*\|\|\s*"([^"]+)"/);
  must(!!base, "could not find the embed's default base");
  must(
    !/jsdelivr|statically/i.test(base![1]),
    `the base must not be a CDN — .html would arrive as text/plain: ${base![1]}`,
  );

  // and the module list has to stay in step with the real load order
  for (const f of SHRINE_FILES) {
    const name = f.split("/").pop()!.replace(/\.js$/, "");
    must(embed.includes(`"${name}"`), `embed/shrine.js is missing the ${name} module`);
  }
}

// ---- G. a push has to reach somebody who already loaded the shrine ---------
// The embed loads from a branch URL, which jsDelivr holds at its edge for
// hours and the browser holds for longer. Nothing about that can be asked
// nicely, so every module URL carries the current build and a new deployment
// is simply a new URL. Two halves have to stay true: the embed must tag the
// URLs, and the backend must answer with something that changes — and answer
// it uncached, or the tag itself goes stale and pins everything to whatever it
// last said.
{
  const embed = await Deno.readTextFile(`${ROOT}/embed/shrine.js`);

  // Run the thing rather than read it. A regex is happy with a bust() that
  // hands back the URL it was given; only watching what the embed appends to
  // the page says whether a deploy will actually reach anybody.
  const srcsFrom = async function (version: string | null): Promise<string[]> {
    const srcs: string[] = [];
    const script = { src: "", async: true, onload: null, onerror: null };
    const head = { appendChild: (s: { src: string }) => { srcs.push(s.src); } };
    // deno-lint-ignore no-explicit-any
    const doc: any = {
      currentScript: { src: "https://cdn.example/embed/shrine.js", getAttribute: () => "" },
      createElement: () => ({ ...script }),
      head,
      addEventListener: () => {},
    };
    // deno-lint-ignore no-explicit-any
    const win: any = { console, SHRINE_BASE: "" };
    win.window = win;
    const fetchStub = () =>
      version === null
        ? Promise.reject(new Error("no backend"))
        : Promise.resolve({ json: () => Promise.resolve({ v: version }) });
    new Function(
      "window", "document", "location", "fetch", "setTimeout", "clearTimeout",
      "URL", "URLSearchParams", "encodeURIComponent", "Date", "console",
      embed,
    )(
      win, doc, { search: "", href: "https://host.example/" }, fetchStub,
      (fn: () => void, _ms: number) => setTimeout(fn, 100000), clearTimeout,
      URL, URLSearchParams, encodeURIComponent, Date, console,
    );
    // withVersion resolves off a promise, so let the microtasks drain
    for (let i = 0; i < 8 && !srcs.length; i++) await new Promise((r) => setTimeout(r, 5));
    return srcs;
  };

  const tagged = await srcsFrom("build-abc123");
  must(tagged.length === SHRINE_FILES.length,
    `the embed must append every module, got ${tagged.length}`);
  for (const u of tagged) {
    must(u.includes("?v=build-abc123"),
      `every module URL must carry the build the backend reported, got ${u}`);
  }
  // two builds must not be able to name the same URL, or the browser answers
  // the second one out of what it kept from the first
  const other = await srcsFrom("build-def456");
  must(!other.some((u) => tagged.includes(u)),
    "a new build must produce URLs the old build never used");

  // and with no backend to ask it still loads, still tagged with something
  // that moves on its own
  const blind = await srcsFrom(null);
  must(blind.length === SHRINE_FILES.length,
    `the shrine must still load when /version cannot be reached, got ${blind.length}`);
  const hour = new Date().toISOString().slice(0, 13).replace(/[^0-9]/g, "");
  for (const u of blind) {
    must(u.includes("?v=" + hour), `the fallback tag must be the current hour, got ${u}`);
  }

  must(/cache:\s*"no-store"/.test(embed),
    "the version request must not be served out of the browser's own cache");

  const server = await Deno.readTextFile(`${ROOT}/server.ts`);
  const route = server.slice(server.indexOf('path === "/version"'));
  must(
    route.indexOf('"cache-control": "no-store') > 0 && route.indexOf('"cache-control": "no-store') < 400,
    "/version must be served uncached, or the cache-buster is itself cached",
  );
  must(/DENO_DEPLOYMENT_ID/.test(server), "the build id must come from the deployment");
  must(/\{ v: BUILD \}/.test(server), "/version must answer { v }, which is what the embed reads");
}

console.log(
  "shrine base: ok — and the embed tags every module with the current build, so a deploy " +
    "reaches a browser that already cached the old one",
);
