/*
 * Runs in the page's MAIN world. Hooks fetch / XHR to capture EVA product list
 * responses (anything with a "Products" array) and forwards just the fields we
 * need to the content script via window.postMessage.
 */
(function () {
  "use strict";

  var TAG = "EVA_ENV_PRODUCTS";

  function extract(payload) {
    if (!payload || typeof payload !== "object") return null;
    var products = payload.Products || (payload.Result && payload.Result.Products);
    if (!Array.isArray(products) || products.length === 0) return null;

    var slim = [];
    for (var i = 0; i < products.length; i++) {
      var p = products[i] || {};
      slim.push({
        product_id: p.product_id != null ? String(p.product_id) : null,
        custom_id: p.custom_id != null ? String(p.custom_id) : null,
        backend_id: p.backend_id != null ? String(p.backend_id) : null,
        custom_ids: Array.isArray(p.custom_ids) ? p.custom_ids.map(String) : null,
        backend_ids: Array.isArray(p.backend_ids) ? p.backend_ids.map(String) : null,
        barcodes: Array.isArray(p.barcodes) ? p.barcodes.map(String) : [],
        display_value: p.display_value || "",
      });
    }
    return slim;
  }

  function tryParse(text) {
    try { return JSON.parse(text); } catch (_) { return null; }
  }

  function send(products) {
    if (!products) return;
    window.postMessage({ source: TAG, products: products }, "*");
  }

  // ---- fetch hook ----
  var origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function () {
      var p = origFetch.apply(this, arguments);
      p.then(function (resp) {
        try {
          var ct = resp.headers.get("content-type") || "";
          if (ct.indexOf("json") === -1) return;
          resp.clone().json().then(function (data) {
            send(extract(data));
          }).catch(function () {});
        } catch (_) {}
      }).catch(function () {});
      return p;
    };
  }

  // ---- XHR hook ----
  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__evaUrl = url;
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    var xhr = this;
    xhr.addEventListener("load", function () {
      try {
        var ct = (xhr.getResponseHeader && xhr.getResponseHeader("content-type")) || "";
        var text = null;
        if (xhr.responseType === "" || xhr.responseType === "text") {
          text = xhr.responseText;
        } else if (xhr.responseType === "json") {
          send(extract(xhr.response));
          return;
        }
        if (text && (ct.indexOf("json") !== -1 || text.charAt(0) === "{")) {
          var parsed = tryParse(text);
          send(extract(parsed));
        }
      } catch (_) {}
    });
    return origSend.apply(this, arguments);
  };
})();
