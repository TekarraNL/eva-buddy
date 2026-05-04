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

  const isBeyond = /^beyond--/i.test(host);

  const BAR_ID = "eva-env-indicator-bar";
  const FAVICON_ID = "eva-env-indicator-favicon";
  const QR_TIP_ID = "eva-env-qr-tip";
  const TITLE_PREFIX = isBeyond ? "🚀 " : "";

  // -----------------------------------------------------------
  // Top bar
  // -----------------------------------------------------------
  const injectBar = () => {
    if (document.getElementById(BAR_ID)) return;
    const bar = document.createElement("div");
    bar.id = BAR_ID;
    bar.className = `eva-env-${env.key}`;
    bar.title = `EVA ${env.label}${isBeyond ? " (beyond)" : ""} — ${host}`;
    (document.body || document.documentElement).appendChild(bar);
  };

  // -----------------------------------------------------------
  // Favicon
  // -----------------------------------------------------------
  const buildFaviconDataUri = () => {
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none">` +
      `<path d="M0 106.667C0 47.7563 47.7563 0 106.667 0H405.333C464.244 0 512 47.7563 512 106.667V405.333C512 464.244 464.244 512 405.333 512H106.667C47.7563 512 0 464.244 0 405.333V106.667Z" fill="${env.color}"/>` +
      `<path d="M426.01 323.494H474.487L377.533 156.089L280.579 323.494H329.056L329.065 323.478H329.081L353.32 281.627H353.303L377.533 239.791L377.541 239.806L377.545 239.799L377.555 239.829L426.01 323.494Z" fill="#ffffff"/>` +
      `<path d="M207.863 156.104L50.3135 156.104L50.3135 197.161L182.972 197.161L256.34 323.509L353.294 156.104H304.817L256.34 239.806L207.863 156.104Z" fill="#ffffff"/>` +
      `<path d="M231.962 323.509L50.3135 323.509L50.3135 282.452L208.25 282.452L231.962 323.509Z" fill="#ffffff"/>` +
      `<path d="M172.01 219.675L195.265 259.937L50.3135 259.937L50.3135 219.675L172.01 219.675Z" fill="#ffffff"/>` +
      `</svg>`;
    return "data:image/svg+xml;base64," + btoa(svg);
  };
  const FAVICON_HREF = buildFaviconDataUri();

  const setFavicon = () => {
    const head = document.head;
    if (!head) return;
    head
      .querySelectorAll('link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]')
      .forEach((link) => {
        if (link.id !== FAVICON_ID) link.parentNode.removeChild(link);
      });
    let link = document.getElementById(FAVICON_ID);
    if (!link) {
      link = document.createElement("link");
      link.id = FAVICON_ID;
      link.rel = "icon";
      link.type = "image/svg+xml";
      head.appendChild(link);
    }
    if (link.href !== FAVICON_HREF) link.href = FAVICON_HREF;
  };

  // -----------------------------------------------------------
  // Title prefix
  // -----------------------------------------------------------
  const setTitle = () => {
    if (!TITLE_PREFIX) return;
    if (!document.title) return;
    if (!document.title.startsWith(TITLE_PREFIX)) {
      document.title = TITLE_PREFIX + document.title;
    }
  };

  // -----------------------------------------------------------
  // Product → barcode map (built from captured API responses)
  // -----------------------------------------------------------
  const productIndex = new Map(); // key -> { barcode, display_value }

  const indexProducts = (products) => {
    if (!Array.isArray(products)) return;
    for (const p of products) {
      const barcode = p.barcodes && p.barcodes.length ? p.barcodes[0] : null;
      if (!barcode) continue;
      const value = { barcode, display_value: p.display_value || "" };
      const keys = new Set();
      if (p.product_id) keys.add(String(p.product_id));
      if (p.custom_id) keys.add(String(p.custom_id));
      if (p.backend_id) keys.add(String(p.backend_id));
      if (Array.isArray(p.custom_ids)) p.custom_ids.forEach((k) => keys.add(String(k)));
      if (Array.isArray(p.backend_ids)) p.backend_ids.forEach((k) => keys.add(String(k)));
      keys.forEach((k) => productIndex.set(k, value));
    }
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "EVA_ENV_PRODUCTS") return;
    indexProducts(data.products);
  });

  // -----------------------------------------------------------
  // Hover QR tooltip on product list pages
  // -----------------------------------------------------------
  const HOVER_QR_PATHS = [
    /^\/pim\/products\/products-overview(\/|$|\?)/i,
    /^\/stock-management\/availability(\/|$|\?)/i,
    /^\/stock-management\/overview-and-mutations\/stock-overview(\/|$|\?)/i,
  ];
  const isHoverQrPath = () => HOVER_QR_PATHS.some((re) => re.test(location.pathname));

  let tipEl = null;
  const ensureTip = () => {
    if (tipEl && document.body.contains(tipEl)) return tipEl;
    tipEl = document.createElement("div");
    tipEl.id = QR_TIP_ID;
    tipEl.style.display = "none";
    document.body.appendChild(tipEl);
    return tipEl;
  };

  const hideTip = () => {
    if (tipEl) tipEl.style.display = "none";
  };

  const positionTip = (clientX, clientY) => {
    if (!tipEl) return;
    const PAD = 16;
    const rect = tipEl.getBoundingClientRect();
    const w = rect.width || 180;
    const h = rect.height || 200;
    let x = clientX + PAD;
    let y = clientY + PAD;
    if (x + w > window.innerWidth - 4) x = clientX - w - PAD;
    if (y + h > window.innerHeight - 4) y = clientY - h - PAD;
    if (x < 4) x = 4;
    if (y < 4) y = 4;
    tipEl.style.left = x + "px";
    tipEl.style.top = y + "px";
  };

  const showQrFor = (lookupKey, clientX, clientY) => {
    const product = productIndex.get(String(lookupKey));
    if (!product || !product.barcode) {
      hideTip();
      return;
    }
    const tip = ensureTip();
    if (tip.dataset.barcode !== product.barcode) {
      tip.dataset.barcode = product.barcode;
      const svg = window.EvaQr.toSvg(product.barcode, { ecc: 1, border: 2 });
      tip.innerHTML =
        '<div class="eva-qr-img">' + svg + "</div>" +
        '<div class="eva-qr-ean">' + product.barcode + "</div>";
    }
    tip.style.display = "block";
    positionTip(clientX, clientY);
  };

  // Find a product key from a row's content
  const ROW_KEY_CACHE = new WeakMap();

  const extractRowKey = (tr) => {
    if (ROW_KEY_CACHE.has(tr)) return ROW_KEY_CACHE.get(tr);
    let key = null;

    // Prefer the link to /pim/products/products-overview/<product_id>
    const link = tr.querySelector('a[href*="/pim/products/products-overview/"]');
    if (link) {
      const m = link.getAttribute("href").match(/products-overview\/([^/?#]+)/);
      if (m) key = decodeURIComponent(m[1]);
    }

    // Fall back to first/second cell text (custom_id, then product_id)
    if (!key) {
      const cells = tr.querySelectorAll('td [role="gridcell"], td span');
      for (const c of cells) {
        const t = (c.textContent || "").trim();
        if (t && /^[A-Za-z0-9_-]+$/.test(t)) { key = t; break; }
      }
    }

    ROW_KEY_CACHE.set(tr, key);
    return key;
  };

  const onMouseOver = (event) => {
    if (!isHoverQrPath()) return hideTip();
    const tr = event.target.closest && event.target.closest('tr[role="row"]');
    if (!tr || !tr.querySelector("td")) return hideTip(); // skip header rows
    const key = extractRowKey(tr);
    if (!key) return hideTip();
    showQrFor(key, event.clientX, event.clientY);
  };

  const onMouseMove = (event) => {
    if (!tipEl || tipEl.style.display === "none") return;
    const tr = event.target.closest && event.target.closest('tr[role="row"]');
    if (!tr) return hideTip();
    positionTip(event.clientX, event.clientY);
  };

  const onMouseOut = (event) => {
    // Hide when leaving any row entirely
    const to = event.relatedTarget;
    if (!to || !(to.closest && to.closest('tr[role="row"]'))) hideTip();
  };

  document.addEventListener("mouseover", onMouseOver, true);
  document.addEventListener("mousemove", onMouseMove, true);
  document.addEventListener("mouseout", onMouseOut, true);
  window.addEventListener("scroll", hideTip, true);

  // -----------------------------------------------------------
  // Bootstrap + observers
  // -----------------------------------------------------------
  const runAll = () => {
    injectBar();
    setFavicon();
    setTitle();
  };

  if (document.body) {
    runAll();
    startWatching();
  } else {
    const bootstrapObserver = new MutationObserver(() => {
      if (document.body) {
        runAll();
        bootstrapObserver.disconnect();
        startWatching();
      }
    });
    bootstrapObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  function startWatching() {
    if (document.head) {
      new MutationObserver(setFavicon).observe(document.head, {
        childList: true,
        subtree: true,
      });
    }
    const titleEl = document.querySelector("title");
    if (titleEl) {
      new MutationObserver(setTitle).observe(titleEl, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    }
    new MutationObserver(() => {
      if (!document.getElementById(BAR_ID)) injectBar();
    }).observe(document.body, { childList: true });
  }

  // -----------------------------------------------------------
  // Alt-click any numeric ID in the page to copy it to clipboard.
  // Filters: leaf-ish element, text is purely digits (3+ long).
  // -----------------------------------------------------------
  const COPY_FLASH_ID = "eva-copy-flash";
  const showCopyFlash = (el, text) => {
    const rect = el.getBoundingClientRect();
    const flash = document.createElement("div");
    flash.className = COPY_FLASH_ID;
    flash.textContent = "Copied " + text;
    flash.style.left = (rect.left + window.scrollX) + "px";
    flash.style.top = (rect.top + window.scrollY - 30) + "px";
    document.body.appendChild(flash);
    requestAnimationFrame(() => flash.classList.add("eva-show"));
    setTimeout(() => flash.classList.remove("eva-show"), 700);
    setTimeout(() => flash.remove(), 1000);
  };

  document.addEventListener("click", (event) => {
    if (!event.altKey) return;
    const target = event.target;
    if (!target || target.children.length > 0) return;
    const text = (target.textContent || "").trim();
    if (text.length > 30 || !/^[0-9]{3,}$/.test(text)) return;
    if (!navigator.clipboard || !navigator.clipboard.writeText) return;
    navigator.clipboard.writeText(text).then(
      () => showCopyFlash(target, text),
      () => {}
    );
    event.preventDefault();
    event.stopPropagation();
  }, true);

  // -----------------------------------------------------------
  // Popup → content-script bridge: fetch /build.json with the
  // page's session so the popup can show the EVA suite version.
  // -----------------------------------------------------------
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg || msg.type !== "getBuildJson") return;
      fetch("/build.json", { credentials: "same-origin" })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => sendResponse({ ok: true, data }))
        .catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true; // keep channel open for async response
    });
  }
})();
