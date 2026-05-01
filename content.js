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
    attachExplosionTrigger(bar);
    (document.body || document.documentElement).appendChild(bar);
  };

  // -----------------------------------------------------------
  // Easter egg: 10 quick clicks on the bar -> page explodes
  // -----------------------------------------------------------
  const CLICK_WINDOW_MS = 1200;
  const CLICKS_TO_DETONATE = 10;
  let clickCount = 0;
  let lastClickAt = 0;

  const attachExplosionTrigger = (bar) => {
    bar.addEventListener("click", (e) => {
      e.stopPropagation();
      const now = Date.now();
      if (now - lastClickAt > CLICK_WINDOW_MS) clickCount = 0;
      lastClickAt = now;
      clickCount++;
      if (clickCount >= CLICKS_TO_DETONATE) {
        clickCount = 0;
        (Math.random() < 0.5 ? triggerExplosion : flyOffPage)();
      }
    });
  };

  const triggerExplosion = () => {
    if (document.getElementById("eva-explosion-style")) return; // already detonated

    const w = window.innerWidth;
    const h = window.innerHeight;
    const cx = w / 2;
    const cy = h / 2;
    const SVG_NS = "http://www.w3.org/2000/svg";

    // ---- inject keyframes ----
    const style = document.createElement("style");
    style.id = "eva-explosion-style";
    style.textContent = `
      @keyframes eva-shake-violently {
        0%   { transform: translate(0,0) rotate(0); }
        10%  { transform: translate(-8px, 4px)  rotate(-1deg); }
        20%  { transform: translate(10px,-5px)  rotate(1.2deg); }
        30%  { transform: translate(-12px,7px)  rotate(-1.5deg); }
        40%  { transform: translate(14px,-3px)  rotate(1.5deg); }
        50%  { transform: translate(-16px,6px)  rotate(-2deg); }
        60%  { transform: translate(12px,-8px)  rotate(2deg); }
        70%  { transform: translate(-10px,5px)  rotate(-1.5deg); }
        80%  { transform: translate(8px,-4px)   rotate(1deg); }
        90%  { transform: translate(-4px,2px)   rotate(-0.5deg); }
        100% { transform: translate(0,0) rotate(0); }
      }
      html.eva-exploding { overflow: hidden !important; }
      html.eva-exploding > body { overflow: hidden !important; }
    `;
    document.head.appendChild(style);

    document.documentElement.classList.add("eva-exploding");
    document.documentElement.style.animation = "eva-shake-violently 0.8s ease-in-out";

    // ---- cracks (jagged lines from center) ----
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("width", w);
    svg.setAttribute("height", h);
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.style.cssText =
      "position:fixed;inset:0;z-index:2147483646;pointer-events:none;opacity:0;transition:opacity 0.25s ease-out;";

    const numCracks = 14;
    for (let i = 0; i < numCracks; i++) {
      const angle = (i / numCracks) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
      const length = Math.max(w, h) * (0.7 + Math.random() * 0.4);
      let d = `M ${cx} ${cy}`;
      let x = cx, y = cy;
      const segments = 5;
      for (let j = 1; j <= segments; j++) {
        const dist = (length / segments) * j;
        const segAngle = angle + (Math.random() - 0.5) * 0.5;
        x = cx + Math.cos(segAngle) * dist;
        y = cy + Math.sin(segAngle) * dist;
        d += ` L ${x} ${y}`;
      }
      const outer = document.createElementNS(SVG_NS, "path");
      outer.setAttribute("d", d);
      outer.setAttribute("stroke", "#000");
      outer.setAttribute("stroke-width", String(2 + Math.random() * 3));
      outer.setAttribute("fill", "none");
      outer.setAttribute("stroke-linecap", "round");
      svg.appendChild(outer);
      const inner = document.createElementNS(SVG_NS, "path");
      inner.setAttribute("d", d);
      inner.setAttribute("stroke", "rgba(255,255,255,0.7)");
      inner.setAttribute("stroke-width", "1");
      inner.setAttribute("fill", "none");
      svg.appendChild(inner);
    }
    document.body.appendChild(svg);
    requestAnimationFrame(() => (svg.style.opacity = "1"));

    // ---- white flash ----
    setTimeout(() => {
      const flash = document.createElement("div");
      flash.style.cssText =
        "position:fixed;inset:0;z-index:2147483647;background:#fff;pointer-events:none;opacity:0;";
      document.body.appendChild(flash);
      flash.animate(
        [{ opacity: 0 }, { opacity: 1, offset: 0.4 }, { opacity: 0 }],
        { duration: 280, easing: "ease-out" }
      );
      setTimeout(() => flash.remove(), 280);
    }, 280);

    // ---- particle burst ----
    setTimeout(() => {
      const overlay = document.createElement("div");
      overlay.style.cssText =
        "position:fixed;inset:0;z-index:2147483645;pointer-events:none;";
      const colors = ["#ff6b35", "#f7931e", "#ffd23f", "#ee4035", "#ffffff", "#ffaa00"];
      for (let i = 0; i < 110; i++) {
        const p = document.createElement("div");
        const angle = Math.random() * Math.PI * 2;
        const speed = 200 + Math.random() * 750;
        const dx = Math.cos(angle) * speed;
        const dy = Math.sin(angle) * speed + 80; // slight gravity bias
        const size = 4 + Math.random() * 18;
        const color = colors[Math.floor(Math.random() * colors.length)];
        p.style.cssText =
          "position:absolute;border-radius:50%;" +
          `left:${cx}px;top:${cy}px;` +
          `width:${size}px;height:${size}px;` +
          `margin-left:${-size / 2}px;margin-top:${-size / 2}px;` +
          `background:${color};box-shadow:0 0 ${size}px ${color};`;
        p.animate(
          [
            { transform: "translate(0,0) rotate(0)", opacity: 1 },
            {
              transform: `translate(${dx}px, ${dy}px) rotate(${Math.random() * 720}deg)`,
              opacity: 0,
            },
          ],
          {
            duration: 1200 + Math.random() * 1500,
            easing: "cubic-bezier(.2,.65,.4,1)",
            fill: "forwards",
          }
        );
        overlay.appendChild(p);
      }
      document.body.appendChild(overlay);
    }, 350);

    // ---- fade to black ----
    setTimeout(() => {
      const fader = document.createElement("div");
      fader.style.cssText =
        "position:fixed;inset:0;z-index:2147483644;background:#000;opacity:0;pointer-events:none;transition:opacity 2.2s ease-in;";
      document.body.appendChild(fader);
      requestAnimationFrame(() => (fader.style.opacity = "1"));
    }, 1700);

    // ---- reload ----
    setTimeout(() => location.reload(), 5000);
  };

  // Variant 2: animate every visible UI chunk flying off-screen
  const flyOffPage = () => {
    if (document.getElementById("eva-explosion-style")) return;

    // Marker so we can't double-trigger
    const marker = document.createElement("style");
    marker.id = "eva-explosion-style";
    document.head.appendChild(marker);

    const w = window.innerWidth;
    const h = window.innerHeight;
    const cx = w / 2;
    const cy = h / 2;

    // Lock scroll so flying elements don't extend the document
    document.documentElement.style.overflow = "hidden";
    if (document.body) document.body.style.overflow = "hidden";

    // Selectors for elements that read as "UI chunks"
    const sel = [
      "tr", "li", "button", "a", "img", "svg",
      "h1", "h2", "h3", "h4", "h5", "h6",
      "p", "label", "input", "select", "textarea",
      '[role="button"]', '[role="row"]', '[role="gridcell"]',
      '[class*="badge"]', '[class*="chip"]', '[class*="tag"]',
      '[class*="button"]', '[class*="card"]', '[class*="pill"]',
    ].join(",");

    const skipIds = new Set([BAR_ID, QR_TIP_ID]);

    const candidates = Array.from(document.querySelectorAll(sel)).filter((el) => {
      if (skipIds.has(el.id)) return false;
      if (el.closest(`#${BAR_ID}, #${QR_TIP_ID}`)) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return false;
      if (r.bottom < 0 || r.top > h || r.right < 0 || r.left > w) return false;
      // Skip near-fullscreen containers
      if (r.width > w * 0.9 && r.height > h * 0.9) return false;
      return true;
    });

    // Keep only outermost candidates so we don't double-animate nested elements
    const candidateSet = new Set(candidates);
    const flyers = candidates.filter((el) => {
      let p = el.parentElement;
      while (p) {
        if (candidateSet.has(p)) return false;
        p = p.parentElement;
      }
      return true;
    });

    flyers.forEach((el) => {
      const r = el.getBoundingClientRect();
      const ecx = r.left + r.width / 2;
      const ecy = r.top + r.height / 2;

      // Outward unit vector from screen center, plus jitter
      let dx = ecx - cx;
      let dy = ecy - cy;
      const baseDist = Math.sqrt(dx * dx + dy * dy);
      if (baseDist < 1) {
        const a = Math.random() * Math.PI * 2;
        dx = Math.cos(a);
        dy = Math.sin(a);
      } else {
        dx /= baseDist;
        dy /= baseDist;
      }
      dx += (Math.random() - 0.5) * 0.6;
      dy += (Math.random() - 0.5) * 0.6;

      const flyDist = Math.max(w, h) * (0.9 + Math.random() * 0.6);
      const tx = dx * flyDist;
      const ty = dy * flyDist + 240; // gravity bias
      const rotate = (Math.random() - 0.5) * 720;
      const delay = Math.random() * 350;
      const duration = 1200 + Math.random() * 1400;

      el.style.willChange = "transform, opacity";
      el.animate(
        [
          { transform: "translate(0,0) rotate(0deg)", opacity: 1 },
          {
            transform: `translate(${tx}px, ${ty}px) rotate(${rotate}deg)`,
            opacity: 0,
          },
        ],
        {
          duration,
          delay,
          easing: "cubic-bezier(.45,.05,.95,.55)",
          fill: "forwards",
        }
      );
    });

    // Fade what's left to black
    setTimeout(() => {
      const fader = document.createElement("div");
      fader.style.cssText =
        "position:fixed;inset:0;z-index:2147483644;background:#000;opacity:0;pointer-events:none;transition:opacity 1.5s ease-in;";
      document.body.appendChild(fader);
      requestAnimationFrame(() => (fader.style.opacity = "1"));
    }, 2200);

    setTimeout(() => location.reload(), 5000);
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
  // Hover QR tooltip on products-overview pages
  // -----------------------------------------------------------
  const isProductsOverview = () =>
    /\/pim\/products\/products-overview(\/|$|\?)/i.test(location.pathname);

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
    if (!isProductsOverview()) return hideTip();
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
})();
