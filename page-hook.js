/*
 * Runs in the page's MAIN world. Hooks fetch / XHR to capture every JSON
 * response from EVA's /message/<endpoint> API and forwards a slim event to
 * the content script via window.postMessage.
 *
 * Two consumers in content.js:
 *   - product-index builder (for hover-QR)
 *   - response capture buffer (for the bar-lip dropdown / viewer)
 */
(function () {
  "use strict";

  var TAG = "EVA_ENV_API_RESPONSE";

  function endpointName(url) {
    if (!url) return "";
    var m = String(url).match(/\/message\/([^/?#]+)/i);
    return m ? m[1] : "";
  }

  // Order-list filters set by EVA Buddy's right-panel section. We can't use
  // window.postMessage as the bridge — its listener fires async, so when EVA
  // synchronously calls fetch right after our content-script's pushState
  // trigger, the filter state would still be stale. localStorage is shared
  // across the isolated and main worlds at the same origin, and reads are
  // synchronous, so we use it as the runtime bridge.
  var EB_ORDER_FILTERS_KEY = "eva-buddy:order-filters-runtime";
  function readEbOrderFilters() {
    try {
      var raw = window.localStorage && window.localStorage.getItem(EB_ORDER_FILTERS_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) { return null; }
  }

  function applyEbFiltersToSearchOrdersBody(bodyStr) {
    if (!bodyStr || typeof bodyStr !== "string") return bodyStr;
    var f = readEbOrderFilters();
    var ob = f && (f.openBalance | 0);
    if (!ob) return bodyStr;
    try {
      var parsed = JSON.parse(bodyStr);
      // Mutually exclusive — only one fires at a time.
      if (ob === 1) {
        parsed.MinOpenAmountInTax = 0.01;
        delete parsed.MaxOpenAmountInTax;
      } else if (ob === 2) {
        parsed.MaxOpenAmountInTax = -0.01;
        delete parsed.MinOpenAmountInTax;
      }
      return JSON.stringify(parsed);
    } catch (_) {
      return bodyStr;
    }
  }

  function send(url, endpoint, data, requestHeaders, requestBody) {
    if (!endpoint) return;
    try {
      window.postMessage({
        source: TAG,
        endpoint: endpoint,
        url: url,
        timestamp: Date.now(),
        data: data,
        requestHeaders: requestHeaders || null,
        requestBody: typeof requestBody === "string" ? requestBody : null,
      }, "*");
    } catch (_) {}
  }

  function collectHeadersFromArg(arg) {
    var out = {};
    try {
      if (arg && arg.headers && typeof arg.headers.forEach === "function") {
        arg.headers.forEach(function (v, k) { out[k] = v; });
      } else if (arg && typeof arg === "object") {
        if (arg instanceof Headers || (arg.constructor && arg.constructor.name === "Headers")) {
          arg.forEach(function (v, k) { out[k] = v; });
        } else {
          for (var k in arg) {
            if (Object.prototype.hasOwnProperty.call(arg, k)) out[k] = arg[k];
          }
        }
      }
    } catch (_) {}
    return out;
  }

  // ---- fetch hook ----
  var origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function () {
      var url = "";
      var headers = {};
      // Body capture has two paths:
      //   - bodyStr: known synchronously (init.body is a string)
      //   - bodyPromise: needs an async clone+text() (arg0 is a Request)
      // We pick whichever one applies and combine it with the response read.
      var bodyStr = null;
      var bodyPromise = null;
      var fetchArgs = arguments;
      var arg0 = arguments[0];
      var init = arguments[1];
      try {
        url = (arg0 && (arg0.url || arg0)) || "";
        // Headers can live on a Request object (arg0) and/or init.headers (arg1)
        if (arg0 && arg0.headers) {
          var h0 = collectHeadersFromArg(arg0);
          for (var k0 in h0) headers[k0] = h0[k0];
        }
        if (init && init.headers) {
          var hi = collectHeadersFromArg({ headers: init.headers });
          for (var ki in hi) headers[ki] = hi[ki];
        }
        if (init && typeof init.body === "string") {
          // Simple shape: fetch(url, { body: "…json…" })
          bodyStr = init.body;
        } else if (arg0 && typeof arg0.clone === "function" && arg0.body) {
          // Request-object shape: fetch(new Request(url, { body: "…json…" }))
          // — the body is a ReadableStream so we have to clone and drain it.
          try { bodyPromise = arg0.clone().text(); } catch (_) {}
        }
      } catch (_) {}

      // -------- EVA Buddy body rewrite for SearchOrders --------
      // Two flavours depending on how EVA called fetch:
      //   (a) init.body is a string → mutate in place, continue sync.
      //   (b) arg0 is a Request → must clone+text() async, rebuild Request.
      var isSearchOrders = String(url).indexOf("/message/SearchOrders") !== -1;
      if (isSearchOrders) {
        try {
          if (bodyStr != null) {
            var rewrittenStr = applyEbFiltersToSearchOrdersBody(bodyStr);
            if (rewrittenStr !== bodyStr) {
              var newInit = {};
              for (var k in init) newInit[k] = init[k];
              newInit.body = rewrittenStr;
              fetchArgs = [arg0, newInit];
              bodyStr = rewrittenStr;
            }
          } else if (arg0 && typeof arg0.clone === "function" && arg0.body) {
            // Request-object path. Return a Promise from clone+rewrite+refetch.
            var origReq = arg0;
            var origInit = init;
            var origUrl = String(url);
            var headersForObs = headers;
            return origReq.clone().text().then(function (originalBody) {
              var rewritten = applyEbFiltersToSearchOrdersBody(originalBody);
              var finalReq;
              if (rewritten === originalBody) {
                finalReq = origReq;
              } else {
                // Try the convenient Request(input, init) form first; fall back
                // to a full property-by-property rebuild if the browser refuses.
                try {
                  finalReq = new Request(origReq, { body: rewritten });
                } catch (_) {
                  var hdrs2 = new Headers(origReq.headers);
                  hdrs2.delete("content-length");
                  finalReq = new Request(origReq.url, {
                    method: origReq.method,
                    headers: hdrs2,
                    body: rewritten,
                    credentials: origReq.credentials,
                    mode: origReq.mode,
                    cache: origReq.cache,
                    redirect: origReq.redirect,
                    referrer: origReq.referrer,
                    referrerPolicy: origReq.referrerPolicy,
                    integrity: origReq.integrity,
                    keepalive: origReq.keepalive
                  });
                }
              }
              var p2 = origFetch.call(window, finalReq, origInit);
              // Manual observation for this code path so the viewer still sees
              // the (rewritten) request body and the response.
              p2.then(function (resp) {
                try {
                  var ct = resp.headers.get("content-type") || "";
                  if (ct.indexOf("json") === -1) return;
                  resp.clone().json().then(function (data) {
                    send(origUrl, "SearchOrders", data, headersForObs, rewritten);
                  }).catch(function () {});
                } catch (_) {}
              }).catch(function () {});
              return p2;
            });
          }
        } catch (_) {}
      }

      var name = endpointName(url);
      var p = origFetch.apply(this, fetchArgs);
      if (name) {
        p.then(function (resp) {
          try {
            var ct = resp.headers.get("content-type") || "";
            if (ct.indexOf("json") === -1) return;
            resp.clone().json().then(function (data) {
              var finish = function (rb) {
                send(String(url), name, data, headers, rb);
              };
              if (bodyStr != null) {
                finish(bodyStr);
              } else if (bodyPromise) {
                bodyPromise.then(finish, function () { finish(null); });
              } else {
                finish(null);
              }
            }).catch(function () {});
          } catch (_) {}
        }).catch(function () {});
      }
      return p;
    };
  }

  // ---- XHR hook ----
  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  var origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__evaUrl = url;
    this.__evaHdrs = {};
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    try {
      if (!this.__evaHdrs) this.__evaHdrs = {};
      this.__evaHdrs[name] = String(value);
    } catch (_) {}
    return origSetHeader.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    var xhr = this;
    try { if (typeof body === "string") xhr.__evaBody = body; } catch (_) {}
    var url = xhr.__evaUrl || "";
    var name = endpointName(url);
    if (name) {
      xhr.addEventListener("load", function () {
        try {
          var ct = (xhr.getResponseHeader && xhr.getResponseHeader("content-type")) || "";
          var data = null;
          if (xhr.responseType === "json") {
            data = xhr.response;
          } else if (xhr.responseType === "" || xhr.responseType === "text") {
            var text = xhr.responseText;
            if (text && (ct.indexOf("json") !== -1 || text.charAt(0) === "{")) {
              try { data = JSON.parse(text); } catch (_) {}
            }
          }
          if (data != null) {
            send(String(url), name, data, xhr.__evaHdrs || {}, xhr.__evaBody || null);
          }
        } catch (_) {}
      });
    }
    return origSend.apply(this, arguments);
  };

  // ---- Replay bridge ---------------------------------------------------
  // Content script asks us to fire an authenticated fetch against EVA's
  // API. We use the page-world fetch (which the SDK has primed for CORS)
  // and the auth headers it has captured from real EVA calls.
  window.addEventListener("message", function (e) {
    if (e.source !== window) return;
    var msg = e.data;
    if (!msg || msg.source !== "EVA_BUDDY_REPLAY_FETCH") return;
    try {
      window.fetch(msg.url, {
        method: msg.method || "POST",
        credentials: "include",
        headers: msg.headers || {},
        body: msg.body,
      });
    } catch (_) {}
  });

  // ---- Request/response bridge ----------------------------------------
  // Like the replay bridge, but returns the result to the content script,
  // correlated by reqId. Used for on-demand lookups (e.g. product by
  // backend ID) where we need the response back.
  window.addEventListener("message", function (e) {
    if (e.source !== window) return;
    var msg = e.data;
    if (!msg || msg.source !== "EVA_BUDDY_API_REQUEST") return;
    var reqId = msg.reqId;
    var reply = function (payload) {
      payload.source = "EVA_BUDDY_API_RESULT";
      payload.reqId = reqId;
      try { window.postMessage(payload, "*"); } catch (_) {}
    };
    try {
      window.fetch(msg.url, {
        method: msg.method || "POST",
        credentials: "include",
        headers: msg.headers || {},
        body: msg.body,
      }).then(function (r) {
        return r.text().then(function (t) {
          var data = null; try { data = JSON.parse(t); } catch (_) {}
          reply({ status: r.status, data: data });
        });
      }).catch(function (err) {
        reply({ status: 0, error: String(err) });
      });
    } catch (err) {
      reply({ status: 0, error: String(err) });
    }
  });
})();
