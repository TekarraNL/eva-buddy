/*
 * Capture layer: receives every EVA API response forwarded by page-hook.js,
 * keeps the rolling buffer + Source Inspector value index, harvests auth
 * headers for replay, and exposes evaApiCall / openViewer to the features.
 */
(() => {
  const EB = globalThis.__evaBuddy;
  if (!EB) return;

  // Rolling buffer of EVA API responses for the current page (newest first)
  const MAX_CAPTURES = 50;
  const captures = [];
  let captureSeq = 0;
  EB.captures = captures;

  // -----------------------------------------------------------
  // Source Inspector index: stringified primitive value -> matches.
  // Powers the hover-trace tooltip that shows which captured JSON
  // (endpoint + path) a value on the page came from.
  //
  // Eviction is lazy: entries are tagged with their captureId and lookups
  // filter against the live-capture set, so we don't pay a full index
  // rebuild on every capture once the buffer is at MAX. A real rebuild
  // only happens after enough captures have been evicted to matter.
  // -----------------------------------------------------------
  const SRC_MAX_LEN = 200;          // skip huge blobs (HTML, base64, etc.)
  EB.SRC_MAX_LEN = SRC_MAX_LEN;
  const valueIndex = new Map();     // string -> Array<{endpoint, path, captureId}>
  const liveCaptureIds = new Set();
  const REBUILD_AFTER_EVICTIONS = 25;
  let evictedSinceRebuild = 0;

  const inspectorOn = () => EB.features.sourceInspector !== false;

  const indexCapture = (cap) => {
    const walk = (node, path) => {
      if (node === null || node === undefined) return;
      const t = typeof node;
      if (t === "object") {
        if (Array.isArray(node)) {
          for (let i = 0; i < node.length; i++) {
            walk(node[i], (path || "") + "[" + i + "]");
          }
        } else {
          for (const k of Object.keys(node)) {
            walk(node[k], path ? path + "." + k : k);
          }
        }
        return;
      }
      // primitive: number / string / bool
      const s = String(node);
      if (s.length > SRC_MAX_LEN) return;
      if (!s.trim()) return;
      let list = valueIndex.get(s);
      if (!list) { list = []; valueIndex.set(s, list); }
      list.push({ endpoint: cap.endpoint, path: path || "", captureId: cap.id });
    };
    walk(cap.data, "");
  };

  const rebuildValueIndex = () => {
    valueIndex.clear();
    evictedSinceRebuild = 0;
    if (!inspectorOn()) return;
    for (const c of captures) indexCapture(c);
  };

  // Lookup for the Source Inspector: only matches from captures that are
  // still in the buffer.
  EB.lookupValue = (s) => {
    const list = valueIndex.get(s);
    if (!list || !list.length) return null;
    const live = list.filter((m) => liveCaptureIds.has(m.captureId));
    return live.length ? live : null;
  };

  // Rebuild (or clear) the index when the popup toggles the inspector.
  EB.onFeaturesChanged(() => {
    if (inspectorOn()) {
      if (valueIndex.size === 0 && captures.length) rebuildValueIndex();
    } else {
      valueIndex.clear();
    }
  });

  // -----------------------------------------------------------
  // Subscriptions
  // -----------------------------------------------------------
  const captureFns = [];
  const clearedFns = [];
  EB.onCapture = (fn) => captureFns.push(fn);          // fn(cap) per intake
  EB.onCapturesCleared = (fn) => clearedFns.push(fn);

  EB.clearCaptures = () => {
    captures.length = 0;
    liveCaptureIds.clear();
    valueIndex.clear();
    evictedSinceRebuild = 0;
    for (const fn of clearedFns) { try { fn(); } catch (_) {} }
  };

  // Auth headers harvested from any captured EVA call; reused to replay
  // endpoints that the current page hasn't loaded on its own.
  let lastAuthHeaders = null;
  EB.getAuthHeaders = () => lastAuthHeaders;

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== "EVA_ENV_API_RESPONSE") return;

    // Add to capture buffer
    const cap = {
      id: ++captureSeq,
      endpoint: msg.endpoint,
      url: msg.url,
      timestamp: msg.timestamp,
      data: msg.data,
      requestHeaders: msg.requestHeaders || null,
      requestBody: msg.requestBody || null,
    };
    captures.unshift(cap);
    liveCaptureIds.add(cap.id);
    if (inspectorOn()) indexCapture(cap);
    if (captures.length > MAX_CAPTURES) {
      const removed = captures.splice(MAX_CAPTURES);
      for (const r of removed) liveCaptureIds.delete(r.id);
      evictedSinceRebuild += removed.length;
      // Lookups filter on liveCaptureIds, so stale entries are invisible;
      // sweep them out for real once enough have piled up.
      if (evictedSinceRebuild >= REBUILD_AFTER_EVICTIONS) rebuildValueIndex();
    }

    // Stash auth-like headers from this call so we can replay other endpoints.
    if (msg.requestHeaders) {
      const auth = {};
      for (const k of Object.keys(msg.requestHeaders)) {
        if (/^(authorization|auth|eva-|x-)/i.test(k)) auth[k] = msg.requestHeaders[k];
      }
      if (Object.keys(auth).length) lastAuthHeaders = auth;
    }

    for (const fn of captureFns) { try { fn(cap); } catch (_) {} }
  });

  // -----------------------------------------------------------
  // Authenticated EVA API call (via the page-hook request/response
  // bridge), using auth headers harvested from real EVA calls.
  // -----------------------------------------------------------
  let apiReqSeq = 0;
  const pendingApiCalls = new Map();
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== "EVA_BUDDY_API_RESULT") return;
    const cb = pendingApiCalls.get(msg.reqId);
    if (cb) { pendingApiCalls.delete(msg.reqId); cb(msg); }
  });

  // opts: { async: true } → POSTs to /async-message/<endpoint> instead of /message/<endpoint>
  //       { timeoutMs: <n> } → override the default 12 s timeout
  EB.evaApiCall = (endpoint, body, extraHeaders, opts) =>
    new Promise((resolve) => {
      if (!lastAuthHeaders) { resolve({ status: 0, error: "no-auth" }); return; }
      const reqId = "eva-api-" + (++apiReqSeq);
      const apiBase = "https://api." + location.hostname.replace(/^beyond--/i, "");
      const path = (opts && opts.async) ? "/async-message/" : "/message/";
      const headers = Object.assign(
        {},
        lastAuthHeaders,
        { "content-type": "application/json" },
        extraHeaders || {}
      );
      const timeoutMs = (opts && opts.timeoutMs) || 12000;
      const timer = setTimeout(() => {
        if (pendingApiCalls.has(reqId)) {
          pendingApiCalls.delete(reqId);
          resolve({ status: 0, error: "timeout" });
        }
      }, timeoutMs);
      pendingApiCalls.set(reqId, (res) => { clearTimeout(timer); resolve(res); });
      window.postMessage({
        source: "EVA_BUDDY_API_REQUEST",
        reqId,
        url: apiBase + path + endpoint,
        method: "POST",
        headers,
        body: JSON.stringify(body),
      }, "*");
    });

  // -----------------------------------------------------------
  // Viewer launcher — opens viewer.html in a new tab with the capture
  // stashed in chrome.storage.local (removed by the viewer after reading).
  // opts.filter pre-fills the viewer's filter box (Source Inspector jump).
  // -----------------------------------------------------------
  EB.openViewer = (cap, opts) => {
    try {
      const id = "eva-cap-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
      const url = chrome.runtime.getURL("viewer.html") + "#" + id;
      // Open the window FIRST while the user-gesture token is still valid;
      // popup blockers will eat us if we await anything before window.open.
      const opened = window.open(url, "_blank");
      if (!opened) console.warn("[eva-buddy] viewer window.open returned null (popup blocked?)");
      chrome.storage.local.set({
        [id]: {
          endpoint: cap.endpoint,
          url: cap.url,
          timestamp: cap.timestamp,
          data: cap.data,
          requestHeaders: cap.requestHeaders || null,
          requestBody: cap.requestBody || null,
          filter: (opts && opts.filter) || null,
        },
      });
    } catch (err) {
      console.error("[eva-buddy] failed to open viewer:", err);
    }
  };
})();
