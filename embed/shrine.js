/* ==========================================================================
   Shrine of Tung — standalone embed
   The whole shrine from one script tag, with no decoy site and no checkout:

     <script src="https://cdn.jsdelivr.net/gh/kanyewest50000/offline-learning@main/embed/shrine.js"></script>

   Paste that into Replit, w3schools, a CodePen, any page that runs a script,
   and the shrine takes the page over. Roughly 90KB gzipped arrives from the
   CDN; this file is the only thing you have to copy.

   Two hosts are in play and they are not interchangeable:

     the CODE   the eight shrine modules, .js, and jsDelivr serves those with
                the right content-type. That is what this file fetches.
     the FILES  the artwork, Tung's originals and the 830 vendored games, all
                .html and .png, which have to come from GitHub Pages. jsDelivr
                serves .html from /gh/ as text/plain, so a game loaded from it
                would arrive as its own source code rather than render.

   window.SHRINE_BASE is what keeps the second one straight: config.js resolves
   every repo path against it instead of against the page, so the shrine can be
   pasted onto any host and still find its files. Set it before the modules.
   ========================================================================== */
(function () {
  "use strict";

  /* has to be read now — document.currentScript is null from a callback */
  var me = document.currentScript;
  var attr = function (n) { try { return (me && me.getAttribute(n)) || ""; } catch (e) { return ""; } };

  /* Where the artwork, the originals and the games are served from. Overridable
     with data-base for a fork or a local dry-run; everything else follows it. */
  var PAGES = attr("data-base") || "https://kanyewest50000.github.io/offline-learning/";
  if (PAGES.charAt(PAGES.length - 1) !== "/") PAGES += "/";
  window.SHRINE_BASE = PAGES;

  /* config first and window last — window.js assembles what the middle six
     hang on Shrine, so the order here is the load order, not a list. */
  var MODS = ["config", "games-catalog", "originals", "chat", "casino", "styles", "markup", "window"];

  /* Where the backend is. Only used here to ask what the current build is;
     config.js resolves this again for itself, and ?api= overrides both so a
     local dry-run does not go asking production what version it is. */
  var API = attr("data-api") || "https://tung.takelearningoffline.deno.net";
  try {
    var apiQ = new URLSearchParams(location.search).get("api");
    if (apiQ) API = String(apiQ);
  } catch (e) {}
  API = API.replace(/\/$/, "");

  /* Mirrors for the code, tried in order. jsDelivr holds a branch URL like
     @main at its edge for hours, and the browser that fetched it holds a copy
     for longer than that — which is how somebody who opened the shrine last
     week is still running last week's shrine, missing whatever has been built
     since. The version tag below is what stops that; see bust(). */
  var CDNS = [
    "https://cdn.jsdelivr.net/gh/kanyewest50000/offline-learning@main/assets/js/shrine/",
    "https://cdn.statically.io/gh/kanyewest50000/offline-learning/main/assets/js/shrine/",
    PAGES + "assets/js/shrine/"
  ];
  /* whatever host handed out this file is the one already known to be reachable
     from here, so it goes first — a fork or a private mirror needs no edit. */
  try {
    if (me && me.src) CDNS.unshift(new URL("../assets/js/shrine/", me.src).href);
  } catch (e) {}
  CDNS = CDNS.filter(function (u, i) { return CDNS.indexOf(u) === i; });

  function fail(why) {
    var m = "shrine: " + why;
    try {
      var d = document.createElement("div");
      d.style.cssText = "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;" +
        "background:#1d1206;color:#c8823c;font:14px system-ui,Segoe UI,Roboto,sans-serif;padding:24px;text-align:center;z-index:2147483647";
      d.textContent = m;
      (document.body || document.documentElement).appendChild(d);
    } catch (e) {}
    if (window.console) console.error(m);
  }

  function ready(fn) {
    if (document.body) fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  function boot() {
    var S = window.Shrine;
    if (!S || typeof S.doc !== "function") { fail("modules loaded but Shrine.doc is missing"); return; }

    /* the login key is per-origin: it is read from, and written to, the
       localStorage of whatever page this was pasted into — never the shrine's
       own. Somebody using an embed logs in there once with their key. */
    var tok = null;
    try { tok = localStorage.getItem("shrine-token-v1"); } catch (e) {}
    var doc = S.doc(tok);

    if (attr("data-mode") === "iframe") {
      /* keeps the host page underneath. No src, so the frame stays same-origin
         and the shrine still reaches the host's localStorage for its key. */
      ready(function () {
        var f = document.createElement("iframe");
        f.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;border:0;z-index:2147483647";
        f.allow = "autoplay; fullscreen; clipboard-read; clipboard-write";
        document.body.appendChild(f);
        var d = f.contentDocument;
        d.open(); d.write(doc); d.close();
      });
      return;
    }
    /* default: the shrine replaces the page it was pasted into. */
    document.open(); document.write(doc); document.close();
  }

  /* The tag that makes a new build a new URL.
     Neither cache in the way can be talked out of holding a file, so the answer
     is not to ask: a different query string is a different thing to a browser,
     so nothing it is already holding can answer for it, and the CDN either
     treats it the same way or has been purged on push (see the workflow in
     .github/workflows/). Deploying is what changes the value, so between
     deploys every cache keeps working exactly as before. */
  var VER = "";
  function bust(u) { return u + "?v=" + encodeURIComponent(VER); }

  /* Ask the backend what is deployed, and do not wait long for the answer: the
     shrine loading a little stale beats it not loading at all, and the hourly
     fallback keeps even that bounded. */
  function withVersion(next) {
    var done = false;
    var go = function (v) {
      if (done) return;
      done = true;
      VER = v || (new Date()).toISOString().slice(0, 13).replace(/[^0-9]/g, "");
      next();
    };
    var t = setTimeout(function () { go(""); }, 2500);
    try {
      fetch(API + "/version", { cache: "no-store" })
        .then(function (r) { return r.json(); })
        .then(function (j) { clearTimeout(t); go(j && j.v ? String(j.v) : ""); })
        .catch(function () { clearTimeout(t); go(""); });
    } catch (e) { clearTimeout(t); go(""); }
  }

  function loadFrom(ci) {
    if (ci >= CDNS.length) { fail("every mirror failed — check the network, or a filter"); return; }
    var base = CDNS[ci], left = MODS.length, dead = false;

    /* appended together rather than one after the next so the eight download in
       parallel; async=false is what still runs them in order once they land. */
    MODS.forEach(function (m) {
      var s = document.createElement("script");
      s.src = bust(base + m + ".js");
      s.async = false;
      s.onload = function () { if (!dead && --left === 0) boot(); };
      s.onerror = function () {
        if (dead) return;
        dead = true;
        /* a half-loaded mirror is not a problem to unpick: every module is an
           IIFE that only assigns onto window.Shrine, so the next mirror's copy
           overwrites whatever landed and the order still holds. */
        loadFrom(ci + 1);
      };
      (document.head || document.documentElement).appendChild(s);
    });
  }

  withVersion(function () { loadFrom(0); });
})();
