/*
 * EVA Buddy core. Loads first (after qrcode.js/pure.js); every other content
 * script hangs off globalThis.__evaBuddy (EB). Owns the cross-cutting
 * plumbing so features don't each re-implement it:
 *   - environment detection (test/acc/prod + beyond)
 *   - feature flags (popup toggles, chrome.storage.local backed)
 *   - one shared ~1s scheduler tick + SPA route-change detection
 *   - one shared document-level pointer dispatcher (mouseover/move/out/scroll)
 */
(() => {
  const host = location.hostname;

  let env = null;
  if (/\.test\.eva-online\.cloud$/i.test(host)) {
    env = { key: "test", label: "TEST", color: "#16a34a" };
  } else if (/\.acc\.eva-online\.cloud$/i.test(host)) {
    env = { key: "acc", label: "ACCEPTANCE", color: "#f97316" };
  } else if (/\.prod\.eva-online\.cloud$/i.test(host)) {
    env = { key: "prod", label: "PRODUCTION", color: "#dc2626" };
  }
  if (!env) return;

  const EB = {
    env,
    host,
    isBeyond: /^beyond--/i.test(host),
    VERSION: (() => {
      try { return chrome.runtime.getManifest().version; } catch (_) { return "0.0.0"; }
    })(),
  };
  globalThis.__evaBuddy = EB;

  // -----------------------------------------------------------
  // Feature flags. Defaults all-on; the popup writes the same key.
  // Features read EB.features synchronously and can subscribe to changes.
  // -----------------------------------------------------------
  const FEATURES_KEY = "eva-buddy:features";
  EB.features = { sourceInspector: true, hoverQr: true, orderPreview: true };
  const featureFns = [];
  EB.onFeaturesChanged = (fn) => featureFns.push(fn);
  const notifyFeatures = () => {
    for (const fn of featureFns) { try { fn(EB.features); } catch (_) {} }
  };
  try {
    chrome.storage.local.get(FEATURES_KEY).then((got) => {
      const saved = got && got[FEATURES_KEY];
      if (saved && typeof saved === "object") {
        Object.assign(EB.features, saved);
        notifyFeatures();
      }
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes[FEATURES_KEY]) return;
      const v = changes[FEATURES_KEY].newValue;
      if (v && typeof v === "object") {
        Object.assign(EB.features, v);
        notifyFeatures();
      }
    });
  } catch (_) {}

  // -----------------------------------------------------------
  // onReady: run once document.body exists (we inject at document_start).
  // -----------------------------------------------------------
  const readyFns = [];
  let bodyReady = !!document.body;
  EB.onReady = (fn) => {
    if (bodyReady) { try { fn(); } catch (_) {} }
    else readyFns.push(fn);
  };
  if (!bodyReady) {
    const bootObserver = new MutationObserver(() => {
      if (!document.body) return;
      bodyReady = true;
      bootObserver.disconnect();
      for (const fn of readyFns.splice(0)) { try { fn(); } catch (_) {} }
    });
    bootObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  // -----------------------------------------------------------
  // Scheduler + SPA route detection.
  // onTick(fn): runs every ~1s AND immediately after a route change — this
  //   replaces the per-feature setIntervals; each fn keeps its own path
  //   gating + teardown logic, but mount/unmount now reacts instantly to
  //   navigations we can observe (our own pushState calls, popstate) and
  //   within a tick for EVA-initiated SPA navs.
  // onRouteChange(fn): runs only when location.href changed.
  // -----------------------------------------------------------
  const tickFns = [];
  const routeFns = [];
  EB.onTick = (fn) => tickFns.push(fn);
  EB.onRouteChange = (fn) => routeFns.push(fn);

  let lastHref = location.href;
  const runTicks = () => {
    for (const fn of tickFns) { try { fn(); } catch (_) {} }
  };
  const checkRoute = () => {
    if (location.href === lastHref) return false;
    lastHref = location.href;
    for (const fn of routeFns) { try { fn(); } catch (_) {} }
    runTicks();
    return true;
  };
  setInterval(() => { if (!checkRoute()) runTicks(); }, 1000);
  window.addEventListener("popstate", () => { try { checkRoute(); } catch (_) {} });
  // Patching history in the isolated world only sees our own pushState /
  // replaceState calls (e.g. the orders-filter URL nudge) — EVA's router runs
  // in the MAIN world. Its navigations are picked up by the 1s tick above.
  ["pushState", "replaceState"].forEach((m) => {
    const orig = history[m];
    if (typeof orig !== "function") return;
    history[m] = function () {
      const r = orig.apply(this, arguments);
      try { checkRoute(); } catch (_) {}
      return r;
    };
  });

  // -----------------------------------------------------------
  // Shared pointer dispatcher — one set of capture-phase listeners for the
  // hot mouse paths, fanned out to the features that need them (hover tips,
  // source inspector) instead of each installing their own.
  // -----------------------------------------------------------
  const pointerFns = { over: [], move: [], out: [], scroll: [] };
  EB.onPointer = (type, fn) => {
    if (pointerFns[type]) pointerFns[type].push(fn);
  };
  const dispatch = (list, e) => {
    for (const fn of list) { try { fn(e); } catch (_) {} }
  };
  document.addEventListener("mouseover", (e) => dispatch(pointerFns.over, e), true);
  document.addEventListener("mousemove", (e) => dispatch(pointerFns.move, e), true);
  document.addEventListener("mouseout", (e) => dispatch(pointerFns.out, e), true);
  window.addEventListener("scroll", (e) => dispatch(pointerFns.scroll, e), true);

  // -----------------------------------------------------------
  // Misc shared utils
  // -----------------------------------------------------------
  // Is this element part of EVA Buddy's own injected UI?
  EB.isOwnUi = (el) => {
    let n = el;
    while (n && n !== document.body) {
      if (n.id && /^eva-/.test(n.id)) return true;
      n = n.parentElement;
    }
    return false;
  };
})();
