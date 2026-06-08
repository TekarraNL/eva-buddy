(() => {
  const host = location.hostname;

  // -----------------------------------------------------------
  // EVA dark mode (smart invert), toggled from the popup.
  // Apply the cached preference synchronously at document_start so
  // EVA's #root is already flagged before it paints (no light flash).
  // The popup is the source of truth (chrome.storage.local); we mirror
  // it into the page's localStorage for the instant pre-paint read.
  // -----------------------------------------------------------
  const DARK_KEY = "eva-buddy:dark-mode";
  try {
    if (localStorage.getItem(DARK_KEY) === "1") {
      document.documentElement.classList.add("eva-buddy-dark");
    }
  } catch (_) {}
  const applyEvaDark = (on) => {
    document.documentElement.classList.toggle("eva-buddy-dark", !!on);
    try { localStorage.setItem(DARK_KEY, on ? "1" : "0"); } catch (_) {}
  };
  try {
    chrome.storage.local.get(DARK_KEY).then((got) => {
      if (got && DARK_KEY in got) applyEvaDark(!!got[DARK_KEY]);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes[DARK_KEY]) applyEvaDark(!!changes[DARK_KEY].newValue);
    });
  } catch (_) {}

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
  const BAR_LIP_ID = "eva-env-bar-lip";
  const BAR_DROPDOWN_ID = "eva-env-bar-dropdown";
  const FAVICON_ID = "eva-env-indicator-favicon";
  const QR_TIP_ID = "eva-env-qr-tip";
  const TITLE_PREFIX = isBeyond ? "🚀 " : "";

  // Rolling buffer of EVA API responses for the current page (newest first)
  const MAX_CAPTURES = 50;
  const captures = [];
  let captureSeq = 0;

  // -----------------------------------------------------------
  // Source Inspector index: stringified primitive value -> matches.
  // Powers the hover-trace tooltip that shows which captured JSON
  // (endpoint + path) a value on the page came from.
  // -----------------------------------------------------------
  const SRC_MAX_LEN = 200;          // skip huge blobs (HTML, base64, etc.)
  const valueIndex = new Map();     // string -> Array<{endpoint, path, captureId}>

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
    for (const c of captures) indexCapture(c);
  };

  // -----------------------------------------------------------
  // Captured-responses dropdown (anchored under the bar lip)
  // -----------------------------------------------------------
  const dropdownIsOpen = () => !!document.getElementById(BAR_DROPDOWN_ID);

  const formatRelativeTime = (ts) => {
    const diff = Math.max(0, Date.now() - ts);
    if (diff < 1000) return "just now";
    if (diff < 60_000) return Math.floor(diff / 1000) + "s ago";
    if (diff < 3_600_000) return Math.floor(diff / 60_000) + "m ago";
    return Math.floor(diff / 3_600_000) + "h ago";
  };

  const renderDropdown = () => {
    const dd = document.getElementById(BAR_DROPDOWN_ID);
    if (!dd) return;
    if (captures.length === 0) {
      dd.innerHTML = '<div class="eva-dd-empty">No API responses captured yet on this page. Interact with EVA to populate.</div>';
      return;
    }
    const rows = captures.map((c) => {
      const safe = (s) => String(s).replace(/[&<>"']/g, (ch) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
      }[ch]));
      return `<button type="button" class="eva-dd-row" data-cap-id="${c.id}">
        <span class="eva-dd-name">${safe(c.endpoint)}</span>
        <span class="eva-dd-time">${formatRelativeTime(c.timestamp)}</span>
      </button>`;
    }).join("");
    dd.innerHTML =
      `<div class="eva-dd-header">${captures.length} response${captures.length === 1 ? "" : "s"} on this page</div>` +
      `<div class="eva-dd-list">${rows}</div>`;
    dd.querySelectorAll(".eva-dd-row").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = Number(btn.getAttribute("data-cap-id"));
        const cap = captures.find((c) => c.id === id);
        if (cap) openViewer(cap);
        closeDropdown();
      });
    });
  };

  const openDropdown = () => {
    if (dropdownIsOpen()) return;
    const dd = document.createElement("div");
    dd.id = BAR_DROPDOWN_ID;
    document.body.appendChild(dd);
    renderDropdown();
    setTimeout(() => {
      document.addEventListener("click", outsideClickClose, true);
      document.addEventListener("keydown", escClose);
    }, 0);
  };

  const closeDropdown = () => {
    const dd = document.getElementById(BAR_DROPDOWN_ID);
    if (dd) dd.remove();
    document.removeEventListener("click", outsideClickClose, true);
    document.removeEventListener("keydown", escClose);
  };

  const toggleDropdown = () => (dropdownIsOpen() ? closeDropdown() : openDropdown());

  const outsideClickClose = (e) => {
    const dd = document.getElementById(BAR_DROPDOWN_ID);
    if (!dd) return;
    if (dd.contains(e.target)) return;
    const lip = document.getElementById(BAR_LIP_ID);
    if (lip && lip.contains(e.target)) return;
    closeDropdown();
  };

  const escClose = (e) => {
    if (e.key === "Escape") closeDropdown();
  };

  const openViewer = (cap) => {
    try {
      const id = "eva-cap-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
      const url = chrome.runtime.getURL("viewer.html") + "#" + id;
      // Open the window FIRST while the user-gesture token is still valid;
      // popup blockers will eat us if we await anything before window.open.
      const opened = window.open(url, "_blank");
      if (!opened) console.warn("[eva-buddy] viewer window.open returned null (popup blocked?)");
      // Stash the payload in chrome.storage.local (session storage isn't
      // accessible from content scripts by default). The viewer removes the
      // entry after reading so we don't leak data to disk.
      chrome.storage.local.set({
        [id]: {
          endpoint: cap.endpoint,
          url: cap.url,
          timestamp: cap.timestamp,
          data: cap.data,
          requestHeaders: cap.requestHeaders || null,
          requestBody: cap.requestBody || null,
        },
      });
    } catch (err) {
      console.error("[eva-buddy] failed to open viewer:", err);
    }
  };

  // -----------------------------------------------------------
  // Top bar
  // -----------------------------------------------------------
  const injectBar = () => {
    if (document.getElementById(BAR_ID)) return;
    const bar = document.createElement("div");
    bar.id = BAR_ID;
    bar.className = `eva-env-${env.key}`;
    bar.title = `EVA ${env.label}${isBeyond ? " (beyond)" : ""} — ${host}`;

    const lip = document.createElement("button");
    lip.id = BAR_LIP_ID;
    lip.type = "button";
    lip.className = `eva-env-${env.key}`;
    lip.setAttribute("aria-label", "Show captured API responses");
    lip.title = "Captured API responses for this page";
    lip.textContent = "▾";
    lip.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleDropdown();
    });
    bar.appendChild(lip);

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

  // Walk a JSON tree, collect any object that looks like a product (has a
  // barcodes array + at least one id-ish field). Capped depth to keep it cheap.
  const looksLikeProduct = (n) =>
    n && typeof n === "object" &&
    Array.isArray(n.barcodes) && n.barcodes.length > 0 &&
    (n.product_id != null || n.custom_id != null || n.backend_id != null);
  const collectProducts = (node, depth, out, seen) => {
    if (!node || typeof node !== "object" || depth > 8) return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) collectProducts(item, depth + 1, out, seen);
      return;
    }
    if (looksLikeProduct(node)) out.push(node);
    for (const k of Object.keys(node)) collectProducts(node[k], depth + 1, out, seen);
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== "EVA_ENV_API_RESPONSE") return;

    // Add to capture buffer
    captures.unshift({
      id: ++captureSeq,
      endpoint: msg.endpoint,
      url: msg.url,
      timestamp: msg.timestamp,
      data: msg.data,
      requestHeaders: msg.requestHeaders || null,
      requestBody: msg.requestBody || null,
    });
    // Index this capture for the Source Inspector hover-trace.
    indexCapture(captures[0]);
    if (captures.length > MAX_CAPTURES) {
      captures.length = MAX_CAPTURES;
      // Something fell out of the rolling buffer — rebuild the index so
      // stale entries don't linger.
      rebuildValueIndex();
    }
    if (dropdownIsOpen()) renderDropdown();

    // Update product index from any product-shaped objects in the response
    const found = [];
    collectProducts(msg.data, 0, found, new WeakSet());
    if (found.length) indexProducts(found);

    // Stash auth-like headers from this call so we can replay other endpoints.
    if (msg.requestHeaders) {
      const auth = {};
      for (const k of Object.keys(msg.requestHeaders)) {
        if (/^(authorization|auth|eva-|x-)/i.test(k)) auth[k] = msg.requestHeaders[k];
      }
      if (Object.keys(auth).length) lastAuthHeaders = auth;
    }

    // If we're on an order detail page, re-evaluate the return highlight now
    // that we have fresh data — don't wait for the next setInterval tick.
    try { updateReturnHighlight && updateReturnHighlight(); } catch (_) {}
    // And opportunistically fire our own GetReturnOrdersForOrder replay
    // for this order if we haven't already.
    try { maybeReplayReturnFetch && maybeReplayReturnFetch(); } catch (_) {}
    // Inject the Backend ID row on consumer general-info pages once GetUser data lands.
    try { maybeInjectBackendIdRow && maybeInjectBackendIdRow(); } catch (_) {}
  });

  // Auth headers harvested from any captured EVA call; reused to replay
  // endpoints that the current page hasn't loaded on its own.
  let lastAuthHeaders = null;

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
      const cells = tr.querySelectorAll('[role="gridcell"] span, td span, [role="gridcell"], td');
      for (const c of cells) {
        const t = (c.textContent || "").trim();
        if (t && /^[A-Za-z0-9_-]+$/.test(t)) { key = t; break; }
      }
    }

    ROW_KEY_CACHE.set(tr, key);
    return key;
  };

  // -----------------------------------------------------------
  // Orders list: hover preview, capture for prev/next nav
  // Orders detail: prev/next nav buttons
  // -----------------------------------------------------------
  const ORDER_LIST_KEY = "eva-buddy:order-list";
  const ORDER_NAV_ID = "eva-order-nav";
  const ORDER_TIP_ID = "eva-order-tip";

  const isOrdersList = () => /^\/orders\/orders\/?$/.test(location.pathname);
  const isOrderDetail = () => /^\/orders\/orders\/\d+/.test(location.pathname);

  const captureOrderList = () => {
    if (!isOrdersList()) return;
    const links = document.querySelectorAll('a[href^="/orders/orders/"]');
    const ids = [];
    links.forEach((a) => {
      const m = a.getAttribute("href").match(/^\/orders\/orders\/(\d+)/);
      if (m && !ids.includes(m[1])) ids.push(m[1]);
    });
    if (!ids.length) return;
    try {
      localStorage.setItem(ORDER_LIST_KEY, JSON.stringify({ ids, at: Date.now() }));
    } catch (_) {}
  };

  const renderOrderNav = () => {
    const existing = document.getElementById(ORDER_NAV_ID);
    if (!isOrderDetail()) {
      if (existing) existing.remove();
      return;
    }
    if (existing) return;

    let stored = null;
    try { stored = JSON.parse(localStorage.getItem(ORDER_LIST_KEY) || "null"); } catch (_) {}
    if (!stored || !Array.isArray(stored.ids) || !stored.ids.length) return;

    const m = location.pathname.match(/^\/orders\/orders\/(\d+)/);
    if (!m) return;
    const current = m[1];
    const idx = stored.ids.indexOf(current);
    if (idx === -1) return;

    const prevId = idx > 0 ? stored.ids[idx - 1] : null;
    const nextId = idx < stored.ids.length - 1 ? stored.ids[idx + 1] : null;

    const nav = document.createElement("div");
    nav.id = ORDER_NAV_ID;
    nav.innerHTML =
      '<button data-dir="prev"' + (prevId ? "" : " disabled") + ' title="Previous order">←</button>' +
      '<span class="eva-nav-pos">' + (idx + 1) + " / " + stored.ids.length + "</span>" +
      '<button data-dir="next"' + (nextId ? "" : " disabled") + ' title="Next order">→</button>';
    document.body.appendChild(nav);

    nav.addEventListener("click", (e) => {
      const btn = e.target.closest && e.target.closest("button[data-dir]");
      if (!btn || btn.disabled) return;
      const target = btn.dataset.dir === "prev" ? prevId : nextId;
      if (target) location.href = "/orders/orders/" + target;
    });
  };

  let orderTipEl = null;
  const ensureOrderTip = () => {
    if (orderTipEl && document.body.contains(orderTipEl)) return orderTipEl;
    orderTipEl = document.createElement("div");
    orderTipEl.id = ORDER_TIP_ID;
    orderTipEl.style.display = "none";
    document.body.appendChild(orderTipEl);
    return orderTipEl;
  };
  const hideOrderTip = () => {
    if (orderTipEl) orderTipEl.style.display = "none";
  };
  const positionOrderTip = (x, y) => {
    if (!orderTipEl) return;
    const PAD = 16;
    const r = orderTipEl.getBoundingClientRect();
    const w = r.width || 320;
    const h = r.height || 180;
    let nx = x + PAD, ny = y + PAD;
    if (nx + w > window.innerWidth - 4) nx = x - w - PAD;
    if (ny + h > window.innerHeight - 4) ny = y - h - PAD;
    orderTipEl.style.left = Math.max(4, nx) + "px";
    orderTipEl.style.top = Math.max(4, ny) + "px";
  };
  const escapeHtmlChars = (s) =>
    String(s).replace(/[<>&"']/g, (c) =>
      ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c])
    );
  const buildOrderTipHtml = (tr) => {
    const grid = tr.closest('[role="grid"], table');
    const headers = grid
      ? Array.from(grid.querySelectorAll('[role="columnheader"]')).map((h) =>
          (h.textContent || "").trim()
        )
      : [];
    const cells = Array.from(tr.querySelectorAll('[role="gridcell"], td'));
    const items = [];
    cells.forEach((c, i) => {
      const label = headers[i] || "";
      const value = (c.textContent || "").trim().replace(/\s+/g, " ");
      if (!value) return;
      items.push("<dt>" + escapeHtmlChars(label) + "</dt><dd>" + escapeHtmlChars(value) + "</dd>");
    });
    return items.length ? "<dl>" + items.join("") + "</dl>" : null;
  };
  const showOrderTip = (tr, x, y) => {
    if (!isOrdersList()) return hideOrderTip();
    if (!tr.querySelector('[role="gridcell"], td')) return hideOrderTip();
    const html = buildOrderTipHtml(tr);
    if (!html) return hideOrderTip();
    const tip = ensureOrderTip();
    tip.innerHTML = html;
    tip.style.display = "block";
    positionOrderTip(x, y);
  };

  const updateOrderHelpers = () => {
    captureOrderList();
    renderOrderNav();
  };

  // -----------------------------------------------------------
  // Source Inspector hover-trace tooltip
  // After a short idle hover on a leaf text node, look the value up
  // in valueIndex and show every captured (endpoint, path) it matches.
  // -----------------------------------------------------------
  const SOURCE_TIP_ID = "eva-source-tip";
  const SOURCE_HOVER_DELAY = 350; // ms idle before tooltip shows
  let sourceTipEl = null;
  let sourceTimer = null;
  let sourceShownEl = null;
  let sourcePinned = false;       // Shift-locks the tooltip (interactive, scrollable)
  let lastSrcX = 0, lastSrcY = 0;

  const ensureSourceTip = () => {
    if (sourceTipEl && document.body.contains(sourceTipEl)) return sourceTipEl;
    sourceTipEl = document.createElement("div");
    sourceTipEl.id = SOURCE_TIP_ID;
    sourceTipEl.style.display = "none";
    document.body.appendChild(sourceTipEl);
    return sourceTipEl;
  };
  const hideSourceTip = () => {
    if (sourceTipEl) {
      sourceTipEl.style.display = "none";
      sourceTipEl.classList.remove("eva-src-pinned");
    }
    sourceShownEl = null;
    sourcePinned = false;
  };

  const pinSourceTip = () => {
    if (sourcePinned || !sourceShownEl || !sourceTipEl) return;
    sourcePinned = true;
    sourceTipEl.classList.add("eva-src-pinned");
    const header = sourceTipEl.querySelector(".eva-src-header");
    if (header) header.textContent = header.dataset.lockedLabel || header.textContent;
  };
  const positionSourceTip = (x, y) => {
    if (!sourceTipEl) return;
    const PAD = 14;
    const r = sourceTipEl.getBoundingClientRect();
    const w = r.width || 340;
    const h = r.height || 80;
    let nx = x + PAD, ny = y + PAD;
    if (nx + w > window.innerWidth - 4) nx = x - w - PAD;
    if (ny + h > window.innerHeight - 4) ny = y - h - PAD;
    sourceTipEl.style.left = Math.max(4, nx) + "px";
    sourceTipEl.style.top = Math.max(4, ny) + "px";
  };

  // Should we even consider this element a hover-trace target?
  const isOwnUi = (el) => {
    let n = el;
    while (n && n !== document.body) {
      if (n.id && /^eva-/.test(n.id)) return true;
      n = n.parentElement;
    }
    return false;
  };
  const isInteractiveLeaf = (el) => {
    if (!el || !el.tagName) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select" || tag === "button") return true;
    return false;
  };
  const leafText = (el) => {
    // Strict leaf: element has no element children, only text.
    if (!el || el.children.length > 0) return null;
    const t = (el.textContent || "").trim();
    if (!t || t.length > SRC_MAX_LEN) return null;
    return t;
  };

  const tipsAlreadyShown = () =>
    (tipEl && tipEl.style.display !== "none") ||
    (orderTipEl && orderTipEl.style.display !== "none");

  const showSourceTip = (target, x, y) => {
    if (!target) return;
    if (isOwnUi(target) || isInteractiveLeaf(target)) return;
    if (tipsAlreadyShown()) return;
    const text = leafText(target);
    if (!text) return;
    const matches = valueIndex.get(text);
    if (!matches || matches.length === 0) return;
    // Dedupe by endpoint+path (collapse repeat captures of the same call).
    const seen = new Map();
    for (const m of matches) {
      const key = m.endpoint + "|" + m.path;
      if (!seen.has(key)) seen.set(key, m);
    }
    const unique = Array.from(seen.values());
    if (unique.length === 0) return;
    const safe = (s) => String(s).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[ch]));
    const rowsHtml = unique.map((m) =>
      '<div class="eva-src-row">' +
        '<span class="eva-src-ep">' + safe(m.endpoint) + '</span>' +
        '<span class="eva-src-sep"> &rsaquo; </span>' +
        '<span class="eva-src-path">' + safe(m.path || "(root)") + '</span>' +
      '</div>'
    ).join("");
    const noun = unique.length === 1 ? "source" : "sources";
    const previewLabel = unique.length + " " + noun + " · Shift to lock";
    const lockedLabel  = unique.length + " " + noun + " · Locked (Esc to close)";
    const headerHtml =
      '<div class="eva-src-header" data-locked-label="' + safe(lockedLabel) + '">' +
        safe(previewLabel) +
      '</div>';
    const tip = ensureSourceTip();
    tip.innerHTML = headerHtml + rowsHtml;
    tip.style.display = "block";
    tip.scrollTop = 0;
    positionSourceTip(x, y);
    sourceShownEl = target;
  };

  // Listeners — separate from the QR/order tip handlers so the two
  // concerns stay independent.
  document.addEventListener("mouseover", (event) => {
    if (sourcePinned) return; // locked tooltip ignores new hovers
    if (sourceTimer) { clearTimeout(sourceTimer); sourceTimer = null; }
    if (sourceShownEl && sourceShownEl !== event.target) hideSourceTip();
    if (isOwnUi(event.target) || isInteractiveLeaf(event.target)) return;
    const target = event.target;
    sourceTimer = setTimeout(() => {
      sourceTimer = null;
      showSourceTip(target, lastSrcX, lastSrcY);
    }, SOURCE_HOVER_DELAY);
  }, true);
  document.addEventListener("mousemove", (event) => {
    lastSrcX = event.clientX;
    lastSrcY = event.clientY;
    if (sourcePinned) return; // pinned tooltip stays put
    if (sourceShownEl) positionSourceTip(event.clientX, event.clientY);
  }, true);
  document.addEventListener("mouseout", (event) => {
    if (sourcePinned) return;
    if (sourceTimer) { clearTimeout(sourceTimer); sourceTimer = null; }
    const to = event.relatedTarget;
    if (sourceShownEl && (!to || !sourceShownEl.contains(to))) hideSourceTip();
  }, true);
  window.addEventListener("scroll", () => {
    if (sourcePinned) return;
    if (sourceTimer) { clearTimeout(sourceTimer); sourceTimer = null; }
    hideSourceTip();
  }, true);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && sourcePinned) {
      hideSourceTip();
      return;
    }
    if (event.key === "Shift" && !event.repeat && sourceShownEl && !sourcePinned) {
      pinSourceTip();
    }
  }, true);
  document.addEventListener("mousedown", (event) => {
    if (!sourcePinned) return;
    if (sourceTipEl && sourceTipEl.contains(event.target)) return;
    hideSourceTip();
  }, true);

  // -----------------------------------------------------------
  // Mouse handlers — drive both hover-QR and order hover preview
  // -----------------------------------------------------------
  const onMouseOver = (event) => {
    const tr = event.target.closest && event.target.closest('[role="row"]');
    const onQr = isHoverQrPath();
    const onOrders = isOrdersList();
    if (!onQr && !onOrders) {
      hideTip(); hideOrderTip(); return;
    }
    if (!tr || !tr.querySelector('td, [role="gridcell"]')) {
      hideTip(); hideOrderTip(); return;
    }
    if (onQr) {
      const key = extractRowKey(tr);
      if (!key) return hideTip();
      showQrFor(key, event.clientX, event.clientY);
    } else if (onOrders) {
      showOrderTip(tr, event.clientX, event.clientY);
    }
  };

  const onMouseMove = (event) => {
    const qrShown = tipEl && tipEl.style.display !== "none";
    const ordShown = orderTipEl && orderTipEl.style.display !== "none";
    if (!qrShown && !ordShown) return;
    const tr = event.target.closest && event.target.closest('[role="row"]');
    if (!tr) { hideTip(); hideOrderTip(); return; }
    if (qrShown) positionTip(event.clientX, event.clientY);
    if (ordShown) positionOrderTip(event.clientX, event.clientY);
  };

  const onMouseOut = (event) => {
    const to = event.relatedTarget;
    if (!to || !(to.closest && to.closest('[role="row"]'))) {
      hideTip(); hideOrderTip();
    }
  };

  document.addEventListener("mouseover", onMouseOver, true);
  document.addEventListener("mousemove", onMouseMove, true);
  document.addEventListener("mouseout", onMouseOut, true);
  window.addEventListener("scroll", () => { hideTip(); hideOrderTip(); }, true);

  // -----------------------------------------------------------
  // Bootstrap + observers
  // -----------------------------------------------------------
  const runAll = () => {
    injectBar();
    setFavicon();
    setTitle();
    updateOrderHelpers();
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
      updateOrderHelpers();
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
  // Module quick-switch: clicking the breadcrumb module button
  // (next to the EVA logo, which otherwise does nothing) opens a
  // dropdown of all admin modules for fast switching. Works on
  // every admin page.
  // -----------------------------------------------------------
  const MODULES = [
    { name: "Compliance",    href: "/compliance/event-ledger",        color: "#5856D6" },
    { name: "Control room",  href: "/control-room/settings",          color: "#A6DC07" },
    { name: "Financials",    href: "/financials/invoices",            color: "#007AFF" },
    { name: "Orders",        href: "/orders/orders",                  color: "#922DA9" },
    { name: "Organizations", href: "/organizations/organizations",    color: "#FFCC00" },
    { name: "People",        href: "/people/employees",               color: "#FF9500" },
    { name: "PIM",           href: "/pim/products",                   color: "#30B0C7" },
    { name: "Promotions",    href: "/promotions/promotions",          color: "#FF315F" },
    { name: "Stock",         href: "/stock-management/rts",           color: "#A2845E" },
    { name: "Tasks",         href: "/tasks-new/ship-from-store",      color: "#34C759" },
    { name: "Web POS",       pos: true,                               color: "#000000" },
  ];
  const MODULE_MENU_ID = "eva-module-menu";
  const MODULE_ICONS_KEY = "eva-buddy:module-icons";
  const MODULE_NAMES = new Set(MODULES.map((m) => m.name));
  let moduleIcons = {}; // name -> harvested <svg> markup

  try {
    chrome.storage.local.get(MODULE_ICONS_KEY).then((got) => {
      if (got && got[MODULE_ICONS_KEY]) moduleIcons = got[MODULE_ICONS_KEY];
    });
  } catch (_) {}

  // Harvest EVA's real module icons as we encounter them (dashboard has all
  // ten; every page's breadcrumb has the current one) and cache them so the
  // menu can show real glyphs instead of the colored-letter fallback.
  const harvestModuleIcons = () => {
    let changed = false;
    const grab = (host, name) => {
      if (!name || !MODULE_NAMES.has(name) || moduleIcons[name]) return;
      const svg = host && host.querySelector && host.querySelector("svg");
      if (svg && /<rect[^>]*rx=/.test(svg.outerHTML)) {
        moduleIcons[name] = svg.outerHTML.replace(/<script[\s\S]*?<\/script>/gi, "");
        changed = true;
      }
    };
    document.querySelectorAll('#root a[href]').forEach((a) => grab(a, (a.textContent || "").trim()));
    const btn = findModuleButton();
    if (btn) grab(btn, (btn.textContent || "").trim());
    if (changed) {
      try { chrome.storage.local.set({ [MODULE_ICONS_KEY]: moduleIcons }); } catch (_) {}
    }
  };

  const findModuleButton = () => {
    const logo = document.querySelector('a[title="Dashboard"][href*="/dashboard"]');
    if (!logo) return null;
    // Climb from the logo and look for the module button specifically: it has
    // a colored module icon (an <svg> with a rounded <rect>) AND a text label.
    // This avoids matching the profile/avatar button (no rect icon, no text),
    // and returns null on the dashboard where there's no module breadcrumb.
    let el = logo.parentElement;
    for (let i = 0; i < 3 && el; i++, el = el.parentElement) {
      const btns = el.querySelectorAll("button");
      for (const btn of btns) {
        const svg = btn.querySelector("svg");
        if (svg && /<rect[^>]*rx=/.test(svg.outerHTML) && (btn.textContent || "").trim().length > 0) {
          return btn;
        }
      }
    }
    return null;
  };

  const onModuleMenuKey = (e) => { if (e.key === "Escape") closeModuleMenu(); };
  const onModuleMenuOutside = (e) => {
    const m = document.getElementById(MODULE_MENU_ID);
    if (m && !m.contains(e.target)) closeModuleMenu();
  };
  function closeModuleMenu() {
    const m = document.getElementById(MODULE_MENU_ID);
    if (m) m.remove();
    document.removeEventListener("keydown", onModuleMenuKey, true);
    document.removeEventListener("click", onModuleMenuOutside, true);
  }

  const openModuleMenu = (btn) => {
    closeModuleMenu();
    harvestModuleIcons();
    const rect = btn.getBoundingClientRect();
    const menu = document.createElement("div");
    menu.id = MODULE_MENU_ID;
    menu.style.left = Math.round(rect.left) + "px";
    menu.style.top = Math.round(rect.bottom + 6) + "px";
    const curRoot = "/" + (location.pathname.split("/")[1] || "");
    // Web POS lives at /pos/ on the same environment (never the beyond-- host).
    const posHref = location.protocol + "//" +
      location.hostname.replace(/^beyond--/i, "") + "/pos/";

    MODULES.forEach((mod) => {
      const href = mod.pos ? posHref : mod.href;
      const item = document.createElement("button");
      item.type = "button";
      item.className = "eva-module-item";
      const isCurrent = mod.pos
        ? location.pathname.indexOf("/pos") === 0
        : (mod.href === curRoot || mod.href.indexOf(curRoot + "/") === 0);
      if (isCurrent) item.classList.add("current");

      const icon = document.createElement("span");
      icon.className = "eva-module-icon";
      if (mod.pos) {
        const img = document.createElement("img");
        img.src = chrome.runtime.getURL("pos-logo.png");
        img.alt = "";
        icon.appendChild(img);
      } else if (moduleIcons[mod.name]) {
        icon.innerHTML = moduleIcons[mod.name];
      } else {
        icon.classList.add("eva-module-icon-fallback");
        icon.style.backgroundColor = mod.color;
        icon.textContent = mod.name.charAt(0);
      }

      const label = document.createElement("span");
      label.className = "eva-module-label";
      label.textContent = mod.name;

      item.appendChild(icon);
      item.appendChild(label);
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        location.href = href;
      });
      menu.appendChild(item);
    });
    document.body.appendChild(menu);
    requestAnimationFrame(() => menu.classList.add("eva-show"));
    setTimeout(() => {
      document.addEventListener("keydown", onModuleMenuKey, true);
      document.addEventListener("click", onModuleMenuOutside, true);
    }, 0);
  };

  document.addEventListener("click", (e) => {
    const btn = e.target.closest && e.target.closest("button");
    if (!btn || btn !== findModuleButton()) return;
    e.preventDefault();
    e.stopPropagation();
    if (document.getElementById(MODULE_MENU_ID)) closeModuleMenu();
    else openModuleMenu(btn);
  }, true);

  // Opportunistically harvest icons on load (and shortly after, once the SPA
  // has rendered the breadcrumb / dashboard tiles).
  setTimeout(harvestModuleIcons, 1500);
  setTimeout(harvestModuleIcons, 4000);

  // -----------------------------------------------------------
  // Dashboard search → orders quick-jump
  //
  // EVA's dashboard search only navigates between admin pages. If the user
  // types something that looks like an order display ID or a customer email
  // and presses Enter, jump straight to /orders/orders with the term applied
  // as a search via the `?query=` parameter that EVA's orders list honors.
  // -----------------------------------------------------------
  const DASHBOARD_SEARCH_PATH = /^\/dashboard\/search(\/|\?|$)/i;

  const detectSearchTerm = (raw) => {
    const t = (raw || "").trim();
    if (!t) return null;
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return t; // email
    if (/^[0-9]+$/.test(t)) return t;                    // numeric ID
    return null;
  };

  if (DASHBOARD_SEARCH_PATH.test(location.pathname)) {
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const target = e.target;
      if (!target || target.tagName !== "INPUT") return;
      if (target.getAttribute("role") !== "combobox") return;
      const term = detectSearchTerm(target.value);
      if (!term) return; // let EVA's default page-search handle it
      e.preventDefault();
      e.stopPropagation();
      location.href = "/orders/orders?limit=25&query=" + encodeURIComponent(term);
    }, true);
  }

  // -----------------------------------------------------------
  // Order detail: highlight the "Related orders" tab when this
  // order is marked as returned/refunded. We read it from the
  // captured GetOrder API response (reliable), with a tight DOM
  // fallback so the highlight still appears on the order-details
  // tab during the brief window before captures arrive.
  // -----------------------------------------------------------
  const ORDER_DETAIL_PATH = /^\/orders\/orders\/(\d+)(\/|$)/i;

  // Strings in *captured* fields are pretty controlled — match "return" or
  // "refund" anywhere as a word.
  const isReturnishField = (text) =>
    typeof text === "string" && /\b(return|refund)/i.test(text);

  // DOM text is noisy — only match short exact labels EVA uses for status.
  const RETURN_LABELS = [
    /^Order Returned$/i,
    /^Partially Returned$/i,
    /^Refunded$/i,
    /^Order Refunded$/i,
  ];
  const isReturnLabel = (text) => {
    const t = (text || "").trim();
    return t.length > 0 && t.length < 30 && RETURN_LABELS.some((re) => re.test(t));
  };

  // Walk an order-object up to a few levels deep looking for return signals.
  // Handles snake_case + nested status objects + arrays of related items.
  const orderObjectIsReturnFlagged = (root) => {
    const STATUS_KEY_RE = /status|type|state|reason|kind|label|name/i;
    const RETURN_KEY_RE = /return|refund/i;

    const walk = (node, depth) => {
      if (!node || typeof node !== "object" || depth > 5) return false;
      if (Array.isArray(node)) {
        for (const c of node) if (walk(c, depth + 1)) return true;
        return false;
      }
      for (const k of Object.keys(node)) {
        const v = node[k];
        // 1. Boolean flag (is_returned, has_return_lines, IsReturned, …)
        if (RETURN_KEY_RE.test(k) && v === true) return true;
        // 2. String status/type/name field whose value mentions return/refund
        if (typeof v === "string" && STATUS_KEY_RE.test(k) && isReturnishField(v)) {
          return true;
        }
        // 3. Non-empty array under a return-related key (e.g. return_lines[])
        if (Array.isArray(v) && v.length > 0 && RETURN_KEY_RE.test(k)) return true;
        // 4. Recurse into nested objects/arrays
        if (v && typeof v === "object") {
          if (walk(v, depth + 1)) return true;
        }
      }
      return false;
    };

    return walk(root, 0);
  };

  const findOrderById = (node, orderId, depth, seen) => {
    if (!node || typeof node !== "object" || depth > 6 || seen.has(node)) return null;
    seen.add(node);
    if (!Array.isArray(node)) {
      if (
        (node.id != null && String(node.id) === orderId) ||
        (node.order_id != null && String(node.order_id) === orderId) ||
        (node.OrderID != null && String(node.OrderID) === orderId)
      ) {
        return node;
      }
    }
    const keys = Array.isArray(node) ? node.map((_, i) => i) : Object.keys(node);
    for (const k of keys) {
      const f = findOrderById(node[k], orderId, depth + 1, seen);
      if (f) return f;
    }
    return null;
  };

  const responseHasAnyArrayItem = (data) => {
    const seen = new WeakSet();
    const walk = (node, depth) => {
      if (!node || typeof node !== "object" || depth > 4 || seen.has(node)) return false;
      seen.add(node);
      if (Array.isArray(node)) return node.length > 0;
      for (const k of Object.keys(node)) {
        if (walk(node[k], depth + 1)) return true;
      }
      return false;
    };
    return walk(data, 0);
  };

  const orderHasReturnInCaptures = (orderId) => {
    for (const cap of captures) {
      if (!cap || !cap.data) continue;
      const ep = (cap.endpoint || "").toLowerCase();
      // Definitive endpoint: any items in this response == this order has returns
      if (ep === "getreturnordersfororder") {
        if (responseHasAnyArrayItem(cap.data)) return true;
        continue;
      }
      if (!ep.includes("order")) continue;
      const order = findOrderById(cap.data, orderId, 0, new WeakSet());
      if (order && orderObjectIsReturnFlagged(order)) return true;
    }
    return false;
  };

  const orderHasReturnInDom = () => {
    if (!document.body) return false;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      if (isReturnLabel(n.nodeValue)) return true;
    }
    return false;
  };

  function updateReturnHighlight() {
    const m = location.pathname.match(ORDER_DETAIL_PATH);
    if (!m) return;
    const orderId = m[1];
    const link = document.querySelector(
      `a[href$="/orders/orders/${orderId}/related-orders"]`
    );
    if (!link) return;
    const returned =
      orderHasReturnInCaptures(orderId) || orderHasReturnInDom();
    link.classList.toggle("eva-has-return", returned);
  }
  setInterval(updateReturnHighlight, 1000);

  // Fire GetReturnOrdersForOrder ourselves so the dot appears on /order-details
  // without the user having to click into /related-orders first.
  const replayedOrders = new Set();
  function maybeReplayReturnFetch() {
    const m = location.pathname.match(ORDER_DETAIL_PATH);
    if (!m) return;
    const orderId = m[1];
    if (replayedOrders.has(orderId)) return;
    if (!lastAuthHeaders) return; // wait for first captured call
    replayedOrders.add(orderId);
    const apiHost = location.hostname.replace(/^beyond--/i, "");
    const apiUrl = `https://api.${apiHost}/message/GetReturnOrdersForOrder`;
    window.postMessage({
      source: "EVA_BUDDY_REPLAY_FETCH",
      url: apiUrl,
      method: "POST",
      headers: { "Content-Type": "application/json", ...lastAuthHeaders },
      body: JSON.stringify({ OrderID: orderId }),
    }, "*");
  }

  // -----------------------------------------------------------
  // Consumer general-info: inject Backend ID as a new row.
  // GetUser returns the field but EVA's UI doesn't surface it.
  // -----------------------------------------------------------
  const CONSUMER_GI_PATH = /^\/people\/consumers\/(\d+)\/general-info(\/|$|\?)/i;
  const BACKEND_ID_KEYS = ["BackendID", "backend_id", "backendId", "BackendId"];
  const USER_ID_KEYS = ["ID", "id", "UserID", "user_id", "userId"];

  function findUserBackendId(data, userId) {
    const seen = new WeakSet();
    let fallback = null;
    const walk = (node, depth) => {
      if (!node || typeof node !== "object" || depth > 6 || seen.has(node)) return null;
      seen.add(node);
      if (!Array.isArray(node)) {
        const beKey = BACKEND_ID_KEYS.find((k) => node[k] != null);
        if (beKey) {
          // Prefer the object whose ID matches the URL's consumer ID.
          const idKey = USER_ID_KEYS.find((k) => node[k] != null);
          if (idKey && String(node[idKey]) === userId) return node[beKey];
          if (fallback == null) fallback = node[beKey];
        }
      }
      const keys = Array.isArray(node) ? node.map((_, i) => i) : Object.keys(node);
      for (const k of keys) {
        const r = walk(node[k], depth + 1);
        if (r != null) return r;
      }
      return null;
    };
    const matched = walk(data, 0);
    return matched != null ? matched : fallback;
  }

  function getBackendIdFromCaptures(userId) {
    for (const cap of captures) {
      if (!cap || !cap.data) continue;
      const ep = (cap.endpoint || "").toLowerCase();
      if (!ep.includes("getuser")) continue;
      const val = findUserBackendId(cap.data, userId);
      if (val != null) return String(val);
    }
    return null;
  }

  const escapeHtmlSimple = (s) =>
    String(s).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[ch]));

  function maybeInjectBackendIdRow() {
    const m = location.pathname.match(CONSUMER_GI_PATH);
    if (!m) return;
    const userId = m[1];

    // Find the General information rows list inside the card.
    const heading = Array.from(document.querySelectorAll("h2")).find(
      (h) => /general information/i.test((h.textContent || "").trim())
    );
    if (!heading) return;
    const card = heading.closest('[class*="rounded-lg"]') || heading.parentElement;
    if (!card) return;
    const list = Array.from(card.querySelectorAll("div")).find(
      (d) => d.className === "flex flex-col gap-5 w-full"
    );
    if (!list) return;
    if (list.querySelector('[data-eva-buddy="backend-id-row"]')) return;

    const value = getBackendIdFromCaptures(userId);
    if (value == null) return;

    const row = document.createElement("div");
    row.className = "sm:grid sm:grid-cols-3 sm:gap-5 leading-none box-border";
    row.setAttribute("data-eva-buddy", "backend-id-row");
    row.innerHTML =
      '<div class="font-semibold text-wrap break-words box-border">' +
        '<span class="text-primary text-base font-semibold">Backend ID</span>' +
      "</div>" +
      '<div class="sm:col-span-2 box-border">' +
        '<span class="text-primary text-base">' + escapeHtmlSimple(value) + "</span>" +
      "</div>";
    list.appendChild(row);
  }
  setInterval(maybeInjectBackendIdRow, 1000);

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
  const evaApiCall = (endpoint, body, extraHeaders, opts) =>
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
  // Popup → content-script bridge
  // -----------------------------------------------------------

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
        evaApiCall("GetProductDetail", { ID: backendId }, { "eva-ids-mode": "ExternalIDs" })
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

  // -----------------------------------------------------------
  // Product-detail "Prices" section
  // -----------------------------------------------------------
  // On /pim/products/products-overview/<product_id> EVA doesn't show the
  // product's prices (those live in pricelists, often country-specific).
  // We inject a small card with a pricelist picker that auto-loads the
  // current product's price for the chosen pricelist, via:
  //   1. ListPriceLists                       → pricelist options
  //   2. ListPriceListAdjustments (PriceListID) → the pricelist's adjustments
  //   3. ListPriceListManualInputAdjustments (PriceListAdjustmentID, ProductID)
  //                                            → per-product Value (the price)
  const PRODUCT_DETAIL_PATH = /^\/pim\/products\/products-overview\/(\d+)(?:\/|$)/;
  const LAST_PRICELIST_KEY = "evaBuddyLastPriceList";

  let priceListsCache = null;                   // [{ID, Name, CurrencyID, IncludingVat, IsActive, ...}]
  const priceListAdjustmentsCache = new Map();  // priceListId -> [{ID, Name, ...}]

  function getProductIdFromUrl() {
    const m = location.pathname.match(PRODUCT_DETAIL_PATH);
    return m ? m[1] : null;
  }

  function readLastPriceListId() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(LAST_PRICELIST_KEY, (v) =>
          resolve(v && v[LAST_PRICELIST_KEY] ? String(v[LAST_PRICELIST_KEY]) : null)
        );
      } catch (_) { resolve(null); }
    });
  }

  async function fetchPriceLists() {
    if (priceListsCache) return priceListsCache;
    const res = await evaApiCall("ListPriceLists", {
      PageConfig: { Filter: { IsActive: true }, Limit: 200, SortDirection: 0, Start: 0 },
    });
    if (res.status === 200 && res.data && res.data.Result && Array.isArray(res.data.Result.Page)) {
      priceListsCache = res.data.Result.Page;
      return priceListsCache;
    }
    return null;
  }

  async function fetchAdjustmentsForPriceList(priceListId) {
    if (priceListAdjustmentsCache.has(priceListId)) return priceListAdjustmentsCache.get(priceListId);
    const res = await evaApiCall("ListPriceListAdjustments", {
      PageConfig: { Filter: { PriceListID: priceListId }, Limit: 200, SortDirection: 0, Start: 0 },
    });
    if (res.status === 200 && res.data && res.data.Result && Array.isArray(res.data.Result.Page)) {
      const list = res.data.Result.Page;
      priceListAdjustmentsCache.set(priceListId, list);
      return list;
    }
    return null;
  }

  async function fetchManualPricesForProduct(adjustmentId, productId) {
    const res = await evaApiCall("ListPriceListManualInputAdjustments", {
      PageConfig: {
        Filter: { PriceListAdjustmentID: adjustmentId, ProductID: productId, IsActive: true },
        Limit: 50, SortDirection: 0, Start: 0,
      },
    });
    if (res.status === 200 && res.data && res.data.Result && Array.isArray(res.data.Result.Page)) {
      return res.data.Result.Page; // [{Value, EffectiveDate, ExpireDate, ProductID, ...}]
    }
    return null;
  }

  function formatMoney(value, currency) {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "EUR" }).format(value);
    } catch (_) {
      return (value == null ? "" : value) + (currency ? " " + currency : "");
    }
  }

  function setPriceBody(section, html) {
    const body = section.querySelector('[data-eb-price-body]');
    if (body) body.innerHTML = html;
  }

  async function loadAndRenderPrice(section, productId, priceListId) {
    setPriceBody(section, '<span class="text-secondary">Loading…</span>');
    const adjustments = await fetchAdjustmentsForPriceList(priceListId);
    if (!adjustments) {
      setPriceBody(section, '<span class="text-secondary">Couldn\'t load adjustments for this pricelist.</span>');
      return;
    }
    if (!adjustments.length) {
      setPriceBody(section, '<span class="text-secondary">No adjustments configured for this pricelist.</span>');
      return;
    }
    const results = await Promise.all(
      adjustments.map(async (adj) => ({
        adjustment: adj,
        prices: (await fetchManualPricesForProduct(adj.ID, productId)) || [],
      }))
    );
    const rows = [];
    for (const r of results) for (const p of r.prices) rows.push({ adj: r.adjustment, price: p });
    if (!rows.length) {
      setPriceBody(section, '<span class="text-secondary">No price set for this product in this pricelist.</span>');
      return;
    }
    const pl = (priceListsCache || []).find((p) => String(p.ID) === String(priceListId));
    const currency = pl && pl.CurrencyID;
    const vatNote = pl ? (pl.IncludingVat ? ' <span class="text-secondary text-sm">(incl. VAT)</span>'
                                          : ' <span class="text-secondary text-sm">(excl. VAT)</span>') : "";
    const html = rows.map((r) => {
      const label = r.adj.Label || r.adj.Name || "Manual price";
      const valStr = formatMoney(r.price.Value, currency);
      return (
        '<div class="sm:grid sm:grid-cols-3 sm:gap-5 leading-none box-border">' +
          '<div class="font-semibold text-wrap break-words box-border">' +
            '<span class="text-primary text-base font-semibold">' + escapeHtmlSimple(label) + '</span>' +
          '</div>' +
          '<div class="sm:col-span-2 box-border">' +
            '<span class="text-primary text-base">' + escapeHtmlSimple(valStr) + '</span>' + vatNote +
          '</div>' +
        '</div>'
      );
    }).join("");
    setPriceBody(section, html);
  }

  function buildPricesSection(productId) {
    const card = document.createElement("div");
    card.setAttribute("data-eva-buddy", "product-prices");
    card.setAttribute("data-eb-product-id", productId);
    card.className = "bg-surface border border-default rounded-lg p-5 flex flex-col gap-5 w-full";
    card.innerHTML =
      '<div class="flex items-center justify-between gap-3">' +
        '<h2 class="text-primary text-lg font-semibold">Prices</h2>' +
        '<div class="flex items-center gap-2">' +
          '<select data-eb-pricelist-select aria-label="Pricelist" ' +
                  'class="text-primary text-base px-2 py-1 rounded border border-default bg-surface"></select>' +
          '<button data-eb-show-all type="button" ' +
                  'class="text-primary text-base px-2 py-1 rounded border border-default bg-surface cursor-pointer">' +
            'Show all</button>' +
        '</div>' +
      '</div>' +
      '<div data-eb-price-body class="flex flex-col gap-3 text-primary text-base">' +
        '<span class="text-secondary">Loading pricelists…</span>' +
      '</div>';
    return card;
  }

  async function populatePricesSection(section, productId) {
    const select = section.querySelector('[data-eb-pricelist-select]');
    const pls = await fetchPriceLists();
    if (!pls) {
      setPriceBody(section, '<span class="text-secondary">Waiting for EVA session…</span>');
      return; // leave dataset.ebPopulated unset so the poll retries
    }
    if (!pls.length) {
      setPriceBody(section, '<span class="text-secondary">No active pricelists.</span>');
      section.dataset.ebPopulated = "1";
      return;
    }
    const sorted = [...pls].sort((a, b) => String(a.Name || "").localeCompare(String(b.Name || "")));
    const last = await readLastPriceListId();
    const defaultPl = (last && sorted.find((p) => String(p.ID) === last)) || sorted[0];

    select.innerHTML = "";
    for (const pl of sorted) {
      const opt = document.createElement("option");
      opt.value = String(pl.ID);
      opt.textContent = (pl.Name || "(unnamed)") + (pl.CurrencyID ? " · " + pl.CurrencyID : "");
      if (String(pl.ID) === String(defaultPl.ID)) opt.selected = true;
      select.appendChild(opt);
    }
    section.dataset.ebPopulated = "1";

    select.addEventListener("change", () => {
      const plid = select.value;
      try { chrome.storage.local.set({ [LAST_PRICELIST_KEY]: plid }); } catch (_) {}
      loadAndRenderPrice(section, section.getAttribute("data-eb-product-id"), plid);
    });

    const showAllBtn = section.querySelector('[data-eb-show-all]');
    if (showAllBtn) {
      showAllBtn.addEventListener("click", () => {
        loadAndRenderAllPrices(section, section.getAttribute("data-eb-product-id"));
      });
    }

    try { chrome.storage.local.set({ [LAST_PRICELIST_KEY]: String(defaultPl.ID) }); } catch (_) {}
    loadAndRenderPrice(section, productId, String(defaultPl.ID));
  }

  // Show every active pricelist with this product's price (or "no price").
  // Fans out: ListPriceListAdjustments (cached per pricelist) → for each
  // adjustment, ListPriceListManualInputAdjustments (per product). Up to
  // N pricelists × M adjustments parallel requests — fine for typical sizes.
  async function loadAndRenderAllPrices(section, productId) {
    const pls = priceListsCache || (await fetchPriceLists());
    if (!pls) {
      setPriceBody(section, '<span class="text-secondary">Couldn\'t load pricelists.</span>');
      return;
    }
    setPriceBody(section, '<span class="text-secondary">Loading all pricelists…</span>');
    const sorted = [...pls].sort((a, b) => String(a.Name || "").localeCompare(String(b.Name || "")));
    const perPricelist = await Promise.all(sorted.map(async (pl) => {
      const adjustments = await fetchAdjustmentsForPriceList(pl.ID);
      if (!adjustments || !adjustments.length) return { pl, rows: [] };
      const perAdj = await Promise.all(adjustments.map(async (adj) => ({
        adj,
        prices: (await fetchManualPricesForProduct(adj.ID, productId)) || [],
      })));
      const rows = [];
      for (const r of perAdj) for (const p of r.prices) rows.push({ adj: r.adj, value: p.Value });
      return { pl, rows };
    }));

    // Sanity-check we're still rendering for the same product (user may
    // have navigated to a different product mid-flight).
    if (section.getAttribute("data-eb-product-id") !== productId) return;

    const html = perPricelist.flatMap(({ pl, rows }) => {
      const head =
        '<span class="text-primary text-base font-semibold">' + escapeHtmlSimple(pl.Name || "(unnamed)") + '</span>' +
        ' <span class="text-secondary text-sm">' + escapeHtmlSimple(pl.CurrencyID || "") +
        (pl.IncludingVat ? " · incl. VAT" : " · excl. VAT") + '</span>';
      if (!rows.length) {
        return [
          '<div class="sm:grid sm:grid-cols-3 sm:gap-5 leading-none box-border">' +
            '<div class="font-semibold text-wrap break-words box-border">' + head + '</div>' +
            '<div class="sm:col-span-2 box-border"><span class="text-secondary">no price</span></div>' +
          '</div>'
        ];
      }
      return rows.map((r) => {
        const label = r.adj.Label || r.adj.Name || "Manual price";
        return (
          '<div class="sm:grid sm:grid-cols-3 sm:gap-5 leading-none box-border">' +
            '<div class="font-semibold text-wrap break-words box-border">' + head + '</div>' +
            '<div class="sm:col-span-2 box-border">' +
              '<span class="text-primary text-base">' + escapeHtmlSimple(formatMoney(r.value, pl.CurrencyID)) + '</span>' +
              ' <span class="text-secondary text-sm">(' + escapeHtmlSimple(label) + ')</span>' +
            '</div>' +
          '</div>'
        );
      });
    }).join("");
    setPriceBody(section, html || '<span class="text-secondary">No pricelists.</span>');
  }

  function findPricesAnchor() {
    // Prefer a card with a "General" / "Details" heading so we land
    // among the product-info cards. Fall back to the first rounded card.
    const headings = Array.from(document.querySelectorAll("h1, h2, h3"));
    const h = headings.find((el) => /^(general|details|product\s+information)/i.test((el.textContent || "").trim()));
    if (h) {
      const card = h.closest('[class*="rounded-lg"]');
      if (card && card.parentElement) return card;
    }
    const card = document.querySelector('[class*="rounded-lg"]');
    return (card && card.parentElement) ? card : null;
  }

  function maybeInjectProductPrices() {
    const productId = getProductIdFromUrl();
    if (!productId) {
      const existing = document.querySelector('[data-eva-buddy="product-prices"]');
      if (existing) existing.remove();
      return;
    }
    let section = document.querySelector('[data-eva-buddy="product-prices"]');
    if (section && section.getAttribute("data-eb-product-id") !== productId) {
      section.remove();
      section = null;
    }
    if (!section) {
      const anchor = findPricesAnchor();
      if (!anchor) return;
      section = buildPricesSection(productId);
      anchor.parentElement.insertBefore(section, anchor.nextSibling);
      populatePricesSection(section, productId);
      return;
    }
    // Re-attempt populate if it bailed early (e.g. no auth captured yet).
    if (section.dataset.ebPopulated !== "1") {
      populatePricesSection(section, productId);
    }
  }
  setInterval(maybeInjectProductPrices, 1000);

  // -----------------------------------------------------------
  // Price-list CSV bulk upload.
  // EVA has a built-in xlsx upload on price-list adjustments but it
  // chokes on anything more than a few hundred rows. When that button
  // shows, we dock a "CSV" button next to it; clicking it opens a modal
  // that streams an arbitrary-size UTF-8 CSV through
  // CreatePriceListManualInputAdjustment one row at a time, so the
  // server is never asked to chew a giant payload.
  // -----------------------------------------------------------
  const PRICE_CSV_BTN_CLASS = "eva-price-csv-btn";
  const PRICE_CSV_MODAL_ID = "eva-price-csv-modal";
  const PRICELIST_PATH_RE = /^\/financials\/price-lists\/(\d+)(\/|$)/i;
  const ADJUSTMENT_URL_RE = /\/adjustments\/(\d+)/i;

  const isPriceListPage = () => PRICELIST_PATH_RE.test(location.pathname);

  // EVA's upload button is an icon-only button: <svg name="lyra-upload">
  // <use href=".../icon-defs.svg#upload"> — no text, no aria-label. We match
  // either the SVG name or the use-href, then walk up to the wrapping button.
  const findEvaUploadButtons = () => {
    if (!isPriceListPage()) return [];
    const matches = new Set();
    document.querySelectorAll('svg[name="lyra-upload"]').forEach((svg) => {
      const btn = svg.closest("button");
      if (btn && !btn.classList.contains(PRICE_CSV_BTN_CLASS)) matches.add(btn);
    });
    document.querySelectorAll('use[href*="#upload"], use[xlink\\:href*="#upload"]').forEach((u) => {
      const btn = u.closest("button");
      if (btn && !btn.classList.contains(PRICE_CSV_BTN_CLASS)) matches.add(btn);
    });
    return Array.from(matches);
  };

  // From a button, walk up looking for the adjustment id this button belongs to.
  // EVA renders adjustments as collapsible cards on the price-list page; if the
  // button lives in such a card, links/inputs near it carry /adjustments/<id>.
  // Fallback: the current URL when the modal route is active.
  const findAdjustmentIdForButton = (btn) => {
    let p = btn;
    for (let i = 0; i < 12 && p; i++) {
      const link = p.querySelector && p.querySelector('a[href*="/adjustments/"]');
      if (link) {
        const m = link.getAttribute("href").match(ADJUSTMENT_URL_RE);
        if (m) return m[1];
      }
      const inpId = p.id || "";
      const dataId = (p.dataset && (p.dataset.adjustmentId || p.dataset.id)) || "";
      if (/^\d{8,}$/.test(dataId)) return dataId;
      p = p.parentElement;
    }
    const m = location.pathname.match(ADJUSTMENT_URL_RE);
    return m ? m[1] : null;
  };

  const ensurePriceCsvButtons = () => {
    // Remove orphans (parent or EVA button gone)
    document.querySelectorAll("." + PRICE_CSV_BTN_CLASS).forEach((b) => {
      if (!b.dataset.ebTwinId) return;
      const twin = document.getElementById(b.dataset.ebTwinId);
      if (!twin || !document.contains(twin)) b.remove();
    });
    const evaButtons = findEvaUploadButtons();
    evaButtons.forEach((evaBtn) => {
      // Already paired?
      const next = evaBtn.nextElementSibling;
      if (next && next.classList && next.classList.contains(PRICE_CSV_BTN_CLASS)) return;
      const adjId = findAdjustmentIdForButton(evaBtn);
      if (!adjId) return;
      // Stable id so we can find the twin again
      if (!evaBtn.id) evaBtn.id = "eva-xlsx-" + Math.random().toString(36).slice(2, 8);
      const ours = document.createElement("button");
      ours.className = PRICE_CSV_BTN_CLASS;
      ours.type = "button";
      ours.title = "EVA Buddy: bulk-upload prices via UTF-8 CSV (experimental — verify a small batch first)";
      // Same dimensions as EVA's icon button (a small square) so the row
      // doesn't shift; "CSV" inside is the label.
      ours.innerHTML = '<span class="eva-price-csv-btn-label">CSV</span>';
      ours.dataset.ebTwinId = evaBtn.id;
      ours.dataset.adjId = adjId;
      ours.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Resolve the target adjustment at click time. Prefer the captured
        // ListPriceListManualInputAdjustments filter (matches the adjustment
        // the user has open right now); fall back to the DOM-walked id.
        const detected = findActiveAdjustmentId() || adjId;
        openPriceCsvModal(detected);
      });
      evaBtn.parentElement.insertBefore(ours, evaBtn.nextSibling);
    });
  };

  // -------- CSV parsing --------
  const parsePriceCsv = (text) => {
    // Strip UTF-8 BOM
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    // Sniff delimiter on the first physical line — tab beats comma if present
    const firstLine = text.split(/\r?\n/, 1)[0] || "";
    const delim = firstLine.includes("\t") && firstLine.split("\t").length > firstLine.split(",").length
      ? "\t" : ",";
    const lines = [];
    let row = [];
    let field = "";
    let inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') inQ = false;
        else field += c;
      } else {
        if (c === '"') inQ = true;
        else if (c === delim) { row.push(field); field = ""; }
        else if (c === "\r" || c === "\n") {
          if (c === "\r" && text[i + 1] === "\n") i++;
          row.push(field); field = "";
          if (row.length > 1 || row[0] !== "") lines.push(row);
          row = [];
        } else field += c;
      }
    }
    if (field !== "" || row.length) { row.push(field); if (row.length > 1 || row[0] !== "") lines.push(row); }
    if (!lines.length) return { delim, header: [], objects: [] };
    const header = lines[0].map((h) => h.trim());
    const objects = lines.slice(1).map((line) => {
      const o = {};
      header.forEach((h, i) => (o[h] = (line[i] != null ? String(line[i]).trim() : "")));
      return o;
    });
    return { delim, header, objects };
  };

  // Case-insensitive column lookup with common aliases
  const pickCol = (row, candidates) => {
    const keys = Object.keys(row);
    for (const cand of candidates) {
      const k = keys.find((x) => x.toLowerCase() === cand.toLowerCase());
      if (k && row[k] !== "") return row[k];
    }
    return "";
  };

  // Accept many incoming date formats and normalise to ISO 8601 UTC.
  // Supports: yyyy-mm-dd, yyyy-mm-ddTHH:MM(:SS)?Z?, yyyy-mm-dd HH:MM(:SS)?,
  //           dd/mm/yyyy(?: HH:MM(:SS)?)?, dd-mm-yyyy(?: HH:MM(:SS)?)?
  // Whitespace inside the value is collapsed first so "31-12-9000  00:00:00"
  // (with the double space some EVA exports produce) parses cleanly.
  const normaliseDate = (s) => {
    s = String(s).trim().replace(/\s+/g, " ");
    if (!s) return null;
    // Already ISO 8601 with a T separator — pass through
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s;
    // ISO date only
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s + "T00:00:00Z";
    const pad = (v, fb) => String(v == null ? (fb || 0) : v).padStart(2, "0");
    // ISO date + space + time
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2}) (\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
    if (m) {
      const [, y, mo, d, hh, mm, ss] = m;
      return y + "-" + pad(mo) + "-" + pad(d) + "T" + pad(hh) + ":" + pad(mm) + ":" + pad(ss) + "Z";
    }
    // dd-mm-yyyy or dd/mm/yyyy, optionally followed by HH:MM(:SS)
    m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?: (\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
    if (m) {
      const [, d, mo, y, hh, mm, ss] = m;
      const time = hh != null ? pad(hh) + ":" + pad(mm) + ":" + pad(ss) : "00:00:00";
      return y + "-" + pad(mo) + "-" + pad(d) + "T" + time + "Z";
    }
    return s;
  };

  // The page itself fires ListPriceListManualInputAdjustments when an
  // adjustment is expanded, with PriceListAdjustmentID in the request filter.
  // That's the most reliable source of truth for "which adjustment is this
  // user currently looking at" — more reliable than walking the DOM. We read
  // it straight off the latest capture (newest-first ordering).
  const findActiveAdjustmentId = () => {
    for (const cap of captures) {
      if (cap.endpoint !== "ListPriceListManualInputAdjustments") continue;
      if (!cap.requestBody) continue;
      let body;
      try { body = JSON.parse(cap.requestBody); } catch (_) { continue; }
      const pc = body && body.PageConfig;
      // EVA's filter object is sometimes "Filter", sometimes "Filters" — try both.
      const f = pc && (pc.Filter || pc.Filters);
      const id = f && f.PriceListAdjustmentID;
      if (id) return String(id);
    }
    return null;
  };

  // Build one CreatePriceListManualInputAdjustment body for a single CSV row.
  // The CSV's `ID` column is intentionally IGNORED — the adjustment ID comes
  // from the page's most recent ListPriceListManualInputAdjustments call so
  // we always target whatever adjustment the user has open.
  const buildAdjBody = (row, adjId) => {
    const bid    = pickCol(row, ["BackendID", "Backend ID", "ProductBackendID", "ProductID"]);
    const price  = pickCol(row, ["Price", "Value"]);
    const eff    = pickCol(row, ["EffectiveDate", "Effective Date", "StartDate", "From"]);
    const exp    = pickCol(row, ["ExpireDate", "Expire Date", "EndDate", "Until", "To"]);
    if (!adjId)            return { error: "No active adjustment detected" };
    if (!bid)              return { error: "Missing BackendID" };
    if (price === "")      return { error: "Missing Price" };
    const valNum = Number(String(price).replace(",", "."));
    if (!isFinite(valNum)) return { error: 'Price not numeric: "' + price + '"' };
    const body = {
      PriceListAdjustmentID: adjId,
      // ProductID + EVA-IDs-Mode: Hybrid lets us pass the BackendID here and
      // have EVA resolve it server-side — no per-row GetProductDetail needed.
      ProductID: bid,
      Value: valNum,
    };
    if (eff) body.EffectiveDate = normaliseDate(eff);
    if (exp) body.ExpireDate    = normaliseDate(exp);
    return { body };
  };

  const escapeHtmlPC = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));

  const openPriceCsvModal = (defaultAdjId) => {
    // Close any existing
    const old = document.getElementById(PRICE_CSV_MODAL_ID);
    if (old) old.remove();

    const overlay = document.createElement("div");
    overlay.id = PRICE_CSV_MODAL_ID;
    overlay.innerHTML =
      '<div class="eva-csv-card">' +
        '<header class="eva-csv-head">' +
          '<div>' +
            '<strong>EVA Buddy · CSV price upload <span class="eva-csv-exp">experimental</span></strong>' +
            '<span class="eva-csv-sub">Adjustment ' + escapeHtmlPC(defaultAdjId) + '</span>' +
          '</div>' +
          '<button type="button" class="eva-csv-close" aria-label="Close">×</button>' +
        '</header>' +
        '<div class="eva-csv-body">' +
          '<div class="eva-csv-banner">⚠️ Experimental. Try a small batch first and confirm the prices land before running a large upload.</div>' +
          // Pick step
          '<section class="eva-csv-step step-pick">' +
            '<p>Pick a UTF-8 CSV. Expected columns: ' +
              '<code>BackendID</code>, <code>Price</code>, ' +
              '<code>EffectiveDate</code>, <code>ExpireDate</code> (optional). ' +
              'Any <code>ID</code> column in the CSV is ignored — EVA Buddy targets the adjustment shown above.' +
            '</p>' +
            '<p class="eva-csv-hint">Comma or tab delimited. Decimal comma is fine. Dates as <code>yyyy-mm-dd</code> or <code>dd/mm/yyyy</code>.</p>' +
            '<label class="eva-csv-file-btn">' +
              '<input type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" />' +
              'Choose CSV…' +
            '</label>' +
          '</section>' +
          // Preview step
          '<section class="eva-csv-step step-preview" hidden>' +
            '<p class="eva-csv-preview-summary"></p>' +
            '<div class="eva-csv-preview-wrap"><table class="eva-csv-preview"></table></div>' +
            '<div class="eva-csv-actions">' +
              '<button type="button" class="eva-csv-pick-again">Pick another file</button>' +
              '<button type="button" class="eva-csv-start">Start upload</button>' +
            '</div>' +
          '</section>' +
          // Progress step
          '<section class="eva-csv-step step-progress" hidden>' +
            '<div class="eva-csv-bar"><div class="eva-csv-bar-fill"></div></div>' +
            '<p class="eva-csv-progress-text"></p>' +
            '<div class="eva-csv-actions">' +
              '<button type="button" class="eva-csv-pause">Pause</button>' +
              '<button type="button" class="eva-csv-cancel">Cancel</button>' +
            '</div>' +
            '<details class="eva-csv-errs" hidden>' +
              '<summary class="eva-csv-errs-summary"></summary>' +
              '<ol class="eva-csv-errs-list"></ol>' +
            '</details>' +
          '</section>' +
          // Done step
          '<section class="eva-csv-step step-done" hidden>' +
            '<p class="eva-csv-done-text"></p>' +
            '<details class="eva-csv-errs eva-csv-errs-final" hidden>' +
              '<summary class="eva-csv-errs-summary"></summary>' +
              '<ol class="eva-csv-errs-list"></ol>' +
            '</details>' +
            '<div class="eva-csv-actions">' +
              '<button type="button" class="eva-csv-copy-errs" hidden>Copy errors</button>' +
              '<button type="button" class="eva-csv-close-done">Close</button>' +
            '</div>' +
          '</section>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    const $ = (sel) => overlay.querySelector(sel);
    const $$ = (sel) => overlay.querySelectorAll(sel);
    const setStep = (name) => {
      $$(".eva-csv-step").forEach((s) => (s.hidden = true));
      $(".step-" + name).hidden = false;
    };

    const state = {
      defaultAdjId,
      rows: [],
      header: [],
      successCount: 0,
      errors: [],
      paused: false,
      cancelled: false,
      processedCount: 0,
    };

    const close = () => overlay.remove();
    $(".eva-csv-close").addEventListener("click", close);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

    $('.eva-csv-file-btn input[type="file"]').addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const { header, objects } = parsePriceCsv(text);
        state.header = header;
        state.rows   = objects;
        $(".eva-csv-preview-summary").textContent =
          objects.length + " row" + (objects.length === 1 ? "" : "s") +
          " · columns: " + header.join(", ");
        const previewRows = objects.slice(0, 5);
        const table = $(".eva-csv-preview");
        table.innerHTML =
          "<thead><tr>" + header.map((h) => "<th>" + escapeHtmlPC(h) + "</th>").join("") + "</tr></thead>" +
          "<tbody>" +
            previewRows.map((r) =>
              "<tr>" + header.map((h) => "<td>" + escapeHtmlPC(r[h] || "") + "</td>").join("") + "</tr>"
            ).join("") +
          "</tbody>";
        setStep("preview");
      } catch (err) {
        alert("Couldn't read CSV: " + err);
      }
    });

    $(".eva-csv-pick-again").addEventListener("click", () => {
      $('.eva-csv-file-btn input[type="file"]').value = "";
      setStep("pick");
    });

    $(".eva-csv-start").addEventListener("click", () => {
      setStep("progress");
      runUpload(state, overlay).catch((err) => {
        console.error("[eva-buddy] CSV upload crashed:", err);
        alert("Upload crashed: " + err);
      });
    });

    $(".eva-csv-pause").addEventListener("click", (e) => {
      state.paused = !state.paused;
      e.currentTarget.textContent = state.paused ? "Resume" : "Pause";
    });
    $(".eva-csv-cancel").addEventListener("click", () => { state.cancelled = true; });
    $(".eva-csv-close-done").addEventListener("click", close);

    $(".eva-csv-copy-errs").addEventListener("click", () => {
      const tsv = "row\tmessage\tdata\n" + state.errors.map((e) =>
        e.rowNum + "\t" + (e.msg || "") + "\t" + JSON.stringify(e.data || {})
      ).join("\n");
      try { navigator.clipboard.writeText(tsv); } catch (_) {}
    });
  };

  const runUpload = async (state, overlay) => {
    const $ = (sel) => overlay.querySelector(sel);
    const progText = $(".eva-csv-progress-text");
    const barFill  = $(".eva-csv-bar-fill");
    const errsDet  = $(".step-progress .eva-csv-errs");
    const errsSum  = errsDet.querySelector(".eva-csv-errs-summary");
    const errsOl   = errsDet.querySelector(".eva-csv-errs-list");

    const total = state.rows.length;
    const started = Date.now();
    const renderProgress = () => {
      const done = state.processedCount;
      const pct = total ? (done / total) * 100 : 0;
      barFill.style.width = pct.toFixed(2) + "%";
      const elapsed = (Date.now() - started) / 1000;
      const rate = done > 0 ? elapsed / done : 0;
      const remaining = rate * (total - done);
      const eta = remaining > 0 ? " · ~" + formatDuration(remaining) + " left" : "";
      progText.textContent =
        "Processing " + done + " / " + total +
        " · " + state.successCount + " ok · " + state.errors.length + " errors" +
        eta;
      if (state.errors.length) {
        errsDet.hidden = false;
        errsSum.textContent = state.errors.length + " error" + (state.errors.length === 1 ? "" : "s");
        errsOl.innerHTML = state.errors.slice(-50).map((e) =>
          "<li><strong>Row " + e.rowNum + "</strong>: " + escapeHtmlPC(e.msg) + "</li>"
        ).join("");
      }
    };

    for (let i = 0; i < total; i++) {
      if (state.cancelled) break;
      while (state.paused) {
        await new Promise((r) => setTimeout(r, 200));
        if (state.cancelled) break;
      }
      if (state.cancelled) break;

      const row = state.rows[i];
      // Re-resolve adjustment ID per row: the user may have expanded a
      // different adjustment between picking the file and starting. Snapshot
      // is state.defaultAdjId; latest signal wins if present.
      const targetAdjId = findActiveAdjustmentId() || state.defaultAdjId;
      const built = buildAdjBody(row, targetAdjId);
      if (built.error) {
        state.errors.push({ rowNum: i + 2, msg: built.error, data: row });
      } else {
        try {
          // Hybrid mode tells EVA to treat ProductID's value as a BackendID
          // when it doesn't match an internal ID. PriceListAdjustmentID stays
          // as EVA's internal numeric ID (no lookup needed for that one).
          const res = await evaApiCall(
            "CreatePriceListManualInputAdjustment",
            built.body,
            {
              "eva-ids-mode": "Hybrid",
              "eva-user-agent": "EVA-Buddy/1.7.0",
            }
          );
          if (res && res.status >= 200 && res.status < 300) {
            state.successCount++;
          } else {
            const apiErr =
              (res && res.data && (
                (res.data.Error && (res.data.Error.Message || res.data.Error.Code)) ||
                res.data.Message || res.data.message
              )) ||
              (res && res.error) ||
              ("HTTP " + (res && res.status));
            state.errors.push({ rowNum: i + 2, msg: String(apiErr), data: row });
          }
        } catch (err) {
          state.errors.push({ rowNum: i + 2, msg: String(err), data: row });
        }
      }
      state.processedCount = i + 1;
      // Throttle UI re-renders: every row up to 100, then every 10
      if (i < 100 || i % 10 === 0 || i === total - 1) renderProgress();
    }

    // Done step
    const cancelled = state.cancelled;
    const doneText = (cancelled ? "Cancelled. " : "Done. ") +
      state.successCount + " of " + total + " uploaded · " + state.errors.length + " errors";
    $(".eva-csv-done-text").textContent = doneText;
    if (state.errors.length) {
      const finalDet  = $(".eva-csv-errs-final");
      const finalSum  = finalDet.querySelector(".eva-csv-errs-summary");
      const finalOl   = finalDet.querySelector(".eva-csv-errs-list");
      finalDet.hidden = false;
      finalSum.textContent = "Show " + state.errors.length + " error" + (state.errors.length === 1 ? "" : "s");
      finalOl.innerHTML = state.errors.map((e) =>
        "<li><strong>Row " + e.rowNum + "</strong>: " + escapeHtmlPC(e.msg) + "</li>"
      ).join("");
      $(".eva-csv-copy-errs").hidden = false;
    }
    $(".step-progress").hidden = true;
    $(".step-done").hidden = false;
  };

  const formatDuration = (sec) => {
    sec = Math.round(sec);
    if (sec < 60) return sec + "s";
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (m < 60) return m + "m " + s + "s";
    const h = Math.floor(m / 60);
    return h + "h " + (m % 60) + "m";
  };

  // Keep our CSV button paired with EVA's xlsx button as the SPA re-renders.
  setInterval(ensurePriceCsvButtons, 1000);

  // -----------------------------------------------------------
  // EVA Buddy filter section — a collapsible card injected as the top
  // entry of EVA's right-hand filter panel on /orders/orders.
  // Currently houses one tri-state: open-balance filter.
  //
  // How a toggle changes results:
  //   1. We update our in-memory state and persist to chrome.storage.local.
  //   2. We postMessage the new state to the page-world (page-hook), which
  //      injects MinOpenAmountInTax / MaxOpenAmountInTax into the next
  //      SearchOrders body — fields EVA's URL parser doesn't understand
  //      but the API accepts.
  //   3. We trigger an EVA refetch by clicking its "Search filters" /
  //      "Search" control; falling back to a URL nudge if that fails.
  // -----------------------------------------------------------
  const EB_FILTER_SECTION_ID = "eva-buddy-filter-section";
  const EB_FILTER_STORAGE_KEY = "eva-buddy:order-filters";

  const isOrdersListPath = () =>
    /^\/orders\/orders(\/|$|\?)/i.test(location.pathname);

  // Default state. Mutated in place — the section UI re-renders from this.
  const ebOrderFilters = {
    // Mutually exclusive: 0 = N/A, 1 = customer owes, 2 = refund owed
    openBalance: 0,
    collapsed: false,
  };

  // Load persisted state on bootstrap.
  try {
    chrome.storage.local.get(EB_FILTER_STORAGE_KEY).then((got) => {
      const saved = got && got[EB_FILTER_STORAGE_KEY];
      if (saved && typeof saved === "object") Object.assign(ebOrderFilters, saved);
      syncFiltersToPageWorld();
      const sec = document.getElementById(EB_FILTER_SECTION_ID);
      if (sec) renderEbFilterSection(sec);
    });
  } catch (_) {}

  const persistEbFilters = () => {
    try {
      chrome.storage.local.set({ [EB_FILTER_STORAGE_KEY]: ebOrderFilters });
    } catch (_) {}
  };

  // Bridge runtime filter state into the page world via localStorage —
  // synchronous in both directions, so when EVA fires fetch right after our
  // pushState the page-hook reads the up-to-date value. (postMessage is
  // delivered on a microtask and would race the fetch.)
  const EB_ORDER_FILTERS_RUNTIME_KEY = "eva-buddy:order-filters-runtime";
  const syncFiltersToPageWorld = () => {
    try {
      localStorage.setItem(
        EB_ORDER_FILTERS_RUNTIME_KEY,
        JSON.stringify({ openBalance: ebOrderFilters.openBalance })
      );
    } catch (_) {}
  };

  // Trigger EVA to fire a fresh SearchOrders. The "Search" icon button and
  // unknown URL params don't re-trigger EVA's router — but a change to
  // `start` (or any param it tracks) does, when combined with a popstate
  // dispatch. We flip start to a different value and immediately back to 0
  // so the user always lands on page 1 with the new results.
  const triggerEvaRefetch = () => {
    try {
      const u = new URL(location.href);
      const curStart = parseInt(u.searchParams.get("start") || "0", 10) || 0;
      // Pick a different value so the push actually changes URL state.
      u.searchParams.set("start", curStart === 0 ? "1" : "0");
      history.pushState(null, "", u.toString());
      window.dispatchEvent(new PopStateEvent("popstate"));
      // Then come back to start=0 for the final view.
      setTimeout(() => {
        const u2 = new URL(location.href);
        u2.searchParams.set("start", "0");
        history.pushState(null, "", u2.toString());
        window.dispatchEvent(new PopStateEvent("popstate"));
      }, 180);
    } catch (_) {}
  };

  const escapeHtmlEb = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));

  const renderEbFilterSection = (section) => {
    const ob = ebOrderFilters.openBalance | 0;
    const isActive = (n) => (ob === n ? "eb-active" : "");
    const collapsed = !!ebOrderFilters.collapsed;
    section.innerHTML =
      '<div class="eb-filter-card">' +
        '<button class="eb-filter-header" type="button" aria-expanded="' +
          (collapsed ? "false" : "true") + '">' +
          '<span class="eb-filter-icon">' + (collapsed ? "+" : "−") + '</span>' +
          '<span class="eb-filter-title">EVA Buddy filters</span>' +
        '</button>' +
        '<div class="eb-filter-body"' + (collapsed ? ' hidden' : '') + '>' +
          '<div class="eb-filter-row">' +
            '<div class="eb-filter-row-label">Open balance</div>' +
            '<div class="eb-filter-row-hint">Fields EVA\'s sidebar can\'t set — uses Min/MaxOpenAmountInTax on the API.</div>' +
            '<div class="eb-filter-tristate" role="listbox">' +
              '<button data-eb-ob="1" class="' + isActive(1) + '" type="button" role="option" aria-selected="' + (ob === 1) + '">Customer owes</button>' +
              '<button data-eb-ob="2" class="' + isActive(2) + '" type="button" role="option" aria-selected="' + (ob === 2) + '">Refund owed</button>' +
              '<button data-eb-ob="0" class="' + isActive(0) + '" type="button" role="option" aria-selected="' + (ob === 0) + '">N/A</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    section.querySelector(".eb-filter-header").addEventListener("click", () => {
      ebOrderFilters.collapsed = !ebOrderFilters.collapsed;
      persistEbFilters();
      renderEbFilterSection(section);
    });
    section.querySelectorAll("[data-eb-ob]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const v = Number(btn.dataset.ebOb) | 0;
        if (ebOrderFilters.openBalance === v) return;
        ebOrderFilters.openBalance = v;
        persistEbFilters();
        renderEbFilterSection(section);
        syncFiltersToPageWorld();
        triggerEvaRefetch();
      });
    });
  };

  // Find EVA's right-hand filter panel — anchored by the "Filters" h2 at the
  // top of the sidebar. The cards container is the scrollable ancestor with
  // an `overflow-y-auto` class; that's the panel we mount inside.
  const findEvaFilterPanel = () => {
    const h2 = Array.from(document.querySelectorAll("h2")).find(
      (h) => (h.textContent || "").trim() === "Filters" &&
             h.getBoundingClientRect().x > 700
    );
    if (!h2) return null;
    let p = h2;
    for (let i = 0; i < 12 && p; i++) {
      const cls = (p.className || "").toString();
      if (/\boverflow-y-auto\b/.test(cls)) return p;
      p = p.parentElement;
    }
    return null;
  };

  const ensureEbFilterSection = () => {
    if (!isOrdersListPath()) {
      const existing = document.getElementById(EB_FILTER_SECTION_ID);
      if (existing) existing.remove();
      return;
    }
    if (document.getElementById(EB_FILTER_SECTION_ID)) return;
    const panel = findEvaFilterPanel();
    if (!panel) return;
    const section = document.createElement("div");
    section.id = EB_FILTER_SECTION_ID;
    section.className = "mb-4";
    // Insert immediately after the heading row (a direct child of the panel
    // that contains the "Filters" h2). Falls back to the very top if not
    // found, so we always end up at least at the top of the cards.
    const headerRow = Array.from(panel.children).find(
      (c) => c.querySelector && c.querySelector("h2") &&
             (c.querySelector("h2").textContent || "").trim() === "Filters"
    );
    if (headerRow && headerRow.nextSibling) {
      panel.insertBefore(section, headerRow.nextSibling);
    } else {
      panel.insertBefore(section, panel.firstChild);
    }
    renderEbFilterSection(section);
    syncFiltersToPageWorld();
  };

  setInterval(ensureEbFilterSection, 1000);
})();
