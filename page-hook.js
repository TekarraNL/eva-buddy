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

  function send(url, endpoint, data, requestHeaders) {
    if (!endpoint) return;
    try {
      window.postMessage({
        source: TAG,
        endpoint: endpoint,
        url: url,
        timestamp: Date.now(),
        data: data,
        requestHeaders: requestHeaders || null,
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
      try {
        var arg0 = arguments[0];
        url = (arg0 && (arg0.url || arg0)) || "";
        // Headers can live on a Request object (arg0) and/or init.headers (arg1)
        if (arg0 && arg0.headers) {
          var h0 = collectHeadersFromArg(arg0);
          for (var k0 in h0) headers[k0] = h0[k0];
        }
        var init = arguments[1];
        if (init && init.headers) {
          var hi = collectHeadersFromArg({ headers: init.headers });
          for (var ki in hi) headers[ki] = hi[ki];
        }
      } catch (_) {}
      var name = endpointName(url);
      var p = origFetch.apply(this, arguments);
      if (name) {
        p.then(function (resp) {
          try {
            var ct = resp.headers.get("content-type") || "";
            if (ct.indexOf("json") === -1) return;
            resp.clone().json().then(function (data) {
              send(String(url), name, data, headers);
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
  XMLHttpRequest.prototype.send = function () {
    var xhr = this;
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
          if (data != null) send(String(url), name, data, xhr.__evaHdrs || {});
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
})();
