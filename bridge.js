/*
 * Popup → content-script bridge: serves /build.json for the version chip
 * and resolves products by backend ID for the popup's lookup field.
 */
(() => {
  const EB = globalThis.__evaBuddy;
  if (!EB) return;

  // Cache /build.json so subsequent popup opens are instant and we're not
  // racing the popup's open against a cold fetch.
  let buildJsonCache = null;
  let buildJsonPromise = null;
  const ensureBuildJson = () => {
    if (buildJsonCache) return Promise.resolve(buildJsonCache);
    if (buildJsonPromise) return buildJsonPromise;
    buildJsonPromise = fetch("/build.json", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { buildJsonCache = data; return data; })
      .catch(() => null);
    return buildJsonPromise;
  };
  // Prefetch on bootstrap so the cache is warm before the user opens the popup.
  try { ensureBuildJson(); } catch (_) {}

  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg) return;

      // Fetch /build.json with the page session (for the popup version chip).
      if (msg.type === "getBuildJson") {
        ensureBuildJson()
          .then((data) => sendResponse({ ok: true, data }))
          .catch((err) => sendResponse({ ok: false, error: String(err) }));
        return true;
      }

      // Resolve a product by backend ID via GetProductDetail (ExternalIDs mode).
      if (msg.type === "lookupProductByBackendId") {
        const backendId = String(msg.backendId || "").trim();
        if (!backendId) { sendResponse({ ok: false, error: "Empty backend ID" }); return; }
        EB.evaApiCall("GetProductDetail", { ID: backendId }, { "eva-ids-mode": "ExternalIDs" })
          .then(async (res) => {
            // Stash the raw response so the popup can open it in the JSON
            // viewer for debugging (shown on failure or via Shift+Enter).
            let viewerId = null;
            if (res.data != null) {
              viewerId = "eva-cap-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
              try {
                await chrome.storage.local.set({
                  [viewerId]: {
                    endpoint: "GetProductDetail",
                    url: "https://api." + location.hostname.replace(/^beyond--/i, "") +
                         "/message/GetProductDetail  (ID: " + backendId + ", ExternalIDs)",
                    timestamp: Date.now(),
                    data: res.data,
                  },
                });
              } catch (_) { viewerId = null; }
            }

            if (res.error === "no-auth") {
              sendResponse({ ok: false, error: "Open or refresh an EVA page first so the extension can authenticate." });
            } else if (res.error === "timeout") {
              sendResponse({ ok: false, error: "Lookup timed out.", viewerId });
            } else if (res.status === 200 && res.data && res.data.Result) {
              const pid = res.data.Result.product_id != null
                ? res.data.Result.product_id
                : res.data.Result.ID;
              if (pid != null) sendResponse({ ok: true, productId: String(pid), origin: location.origin, viewerId });
              else sendResponse({ ok: false, error: "No product_id in response", viewerId });
            } else if (res.data && res.data.Error) {
              sendResponse({ ok: false, error: res.data.Error.Message || "Not found", viewerId });
            } else {
              sendResponse({ ok: false, error: "Lookup failed (HTTP " + res.status + ")", viewerId });
            }
          });
        return true;
      }
    });
  }
})();
