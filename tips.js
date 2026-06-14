/*
 * Row hover tooltips:
 *   - hover-QR on product list pages (QR of the row's EAN, decoded from the
 *     page's own GetProducts / SearchProducts responses)
 *   - order row preview on the orders list (labeled column tooltip)
 * Both togglable from the popup. Mouse events come in via the shared
 * pointer dispatcher in lib.js.
 */
(() => {
  const EB = globalThis.__evaBuddy;
  if (!EB) return;
  const escapeHtml = EBPure.escapeHtml;

  const QR_TIP_ID = "eva-env-qr-tip";
  const ORDER_TIP_ID = "eva-order-tip";

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

  EB.onCapture((cap) => {
    const found = [];
    collectProducts(cap.data, 0, found, new WeakSet());
    if (found.length) indexProducts(found);
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

  // Find a product key from a row's content. No caching: virtualized grids
  // recycle <tr> elements with new content, so a per-element cache could
  // serve up the previous product's QR. The extraction is cheap enough to
  // run on every hover.
  const extractRowKey = (tr) => {
    // Prefer the link to /pim/products/products-overview/<product_id>
    const link = tr.querySelector('a[href*="/pim/products/products-overview/"]');
    if (link) {
      const m = link.getAttribute("href").match(/products-overview\/([^/?#]+)/);
      if (m) return decodeURIComponent(m[1]);
    }

    // Fall back to first/second cell text (custom_id, then product_id)
    const cells = tr.querySelectorAll('[role="gridcell"] span, td span, [role="gridcell"], td');
    for (const c of cells) {
      const t = (c.textContent || "").trim();
      if (t && /^[A-Za-z0-9_-]+$/.test(t)) return t;
    }
    return null;
  };

  // -----------------------------------------------------------
  // Orders list: hover preview
  // -----------------------------------------------------------
  const isOrdersList = () => /^\/orders\/orders\/?$/.test(location.pathname);

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
      items.push("<dt>" + escapeHtml(label) + "</dt><dd>" + escapeHtml(value) + "</dd>");
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

  // Used by the Source Inspector so its tooltip doesn't fight with ours.
  EB.tipsVisible = () =>
    (tipEl && tipEl.style.display !== "none") ||
    (orderTipEl && orderTipEl.style.display !== "none");

  // -----------------------------------------------------------
  // Pointer handlers — drive both hover-QR and order hover preview
  // -----------------------------------------------------------
  EB.onPointer("over", (event) => {
    const tr = event.target.closest && event.target.closest('[role="row"]');
    const onQr = EB.features.hoverQr !== false && isHoverQrPath();
    const onOrders = EB.features.orderPreview !== false && isOrdersList();
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
  });

  EB.onPointer("move", (event) => {
    const qrShown = tipEl && tipEl.style.display !== "none";
    const ordShown = orderTipEl && orderTipEl.style.display !== "none";
    if (!qrShown && !ordShown) return;
    const tr = event.target.closest && event.target.closest('[role="row"]');
    if (!tr) { hideTip(); hideOrderTip(); return; }
    if (qrShown) positionTip(event.clientX, event.clientY);
    if (ordShown) positionOrderTip(event.clientX, event.clientY);
  });

  EB.onPointer("out", (event) => {
    const to = event.relatedTarget;
    if (!to || !(to.closest && to.closest('[role="row"]'))) {
      hideTip(); hideOrderTip();
    }
  });

  EB.onPointer("scroll", () => { hideTip(); hideOrderTip(); });

  // Toggled off from the popup → drop whatever is showing.
  EB.onFeaturesChanged(() => {
    if (EB.features.hoverQr === false) hideTip();
    if (EB.features.orderPreview === false) hideOrderTip();
  });
})();
