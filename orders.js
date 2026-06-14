/*
 * Orders helpers:
 *   - "Related orders" tab highlight on order detail when the order has
 *     any return attached (captured data + replayed GetReturnOrdersForOrder)
 *   - EVA Buddy filter section on /orders/orders (open-balance tri-state,
 *     injected into SearchOrders bodies by page-hook.js)
 */
(() => {
  const EB = globalThis.__evaBuddy;
  if (!EB) return;

  // The prev/next order pill was removed in 1.8.0 — clean up its stored list.
  try { localStorage.removeItem("eva-buddy:order-list"); } catch (_) {}

  // -----------------------------------------------------------
  // Order detail: highlight the "Related orders" tab when this
  // order is marked as returned/refunded. We read it from the
  // captured GetOrder API response (reliable), with a tight DOM
  // fallback so the highlight still appears on the order-details
  // tab during the brief window before captures arrive.
  // -----------------------------------------------------------
  const ORDER_DETAIL_PATH = /^\/orders\/orders\/(\d+)(\/|$)/i;

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
    for (const cap of EB.captures) {
      if (!cap || !cap.data) continue;
      const ep = (cap.endpoint || "").toLowerCase();
      // Definitive endpoint: any items in this response == this order has returns
      if (ep === "getreturnordersfororder") {
        if (responseHasAnyArrayItem(cap.data)) return true;
        continue;
      }
      if (!ep.includes("order")) continue;
      const order = findOrderById(cap.data, orderId, 0, new WeakSet());
      if (order && EBPure.orderObjectIsReturnFlagged(order)) return true;
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
  EB.onTick(updateReturnHighlight);

  // Fire GetReturnOrdersForOrder ourselves so the dot appears on /order-details
  // without the user having to click into /related-orders first.
  const replayedOrders = new Set();
  function maybeReplayReturnFetch() {
    const m = location.pathname.match(ORDER_DETAIL_PATH);
    if (!m) return;
    const orderId = m[1];
    if (replayedOrders.has(orderId)) return;
    const authHeaders = EB.getAuthHeaders();
    if (!authHeaders) return; // wait for first captured call
    replayedOrders.add(orderId);
    const apiHost = location.hostname.replace(/^beyond--/i, "");
    const apiUrl = `https://api.${apiHost}/message/GetReturnOrdersForOrder`;
    window.postMessage({
      source: "EVA_BUDDY_REPLAY_FETCH",
      url: apiUrl,
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ OrderID: orderId }),
    }, "*");
  }

  // Re-evaluate as soon as fresh data lands — don't wait for the next tick.
  EB.onCapture(() => {
    try { updateReturnHighlight(); } catch (_) {}
    try { maybeReplayReturnFetch(); } catch (_) {}
  });

  // -----------------------------------------------------------
  // EVA Buddy filter section — a collapsible card injected as the top
  // entry of EVA's right-hand filter panel on /orders/orders.
  // Currently houses one tri-state: open-balance filter.
  //
  // How a toggle changes results:
  //   1. We update our in-memory state and persist to chrome.storage.local.
  //   2. We mirror the new state into localStorage, which the page-world
  //      hook reads synchronously to inject MinOpenAmountInTax /
  //      MaxOpenAmountInTax into the next SearchOrders body — fields EVA's
  //      URL parser doesn't understand but the API accepts.
  //   3. We trigger an EVA refetch via a URL `start` nudge.
  // -----------------------------------------------------------
  const EB_FILTER_SECTION_ID = "eva-buddy-filter-section";
  const EB_FILTER_STORAGE_KEY = "eva-buddy:order-filters";

  // Strict equality — we only ever want to mount on /orders/orders (the list
  // view), not on order details (/orders/orders/<id>) and definitely not on
  // any other module's "X overview with right-hand filter panel" pages like
  // /stock-management/purchase-orders. A regex prefix-match would risk that.
  const isOrdersListPath = () => {
    const p = location.pathname.replace(/\/$/, "");
    return p === "/orders/orders";
  };

  // Default state. Mutated in place — the section UI re-renders from this.
  // Collapsed by default so the section stays out of the way until needed;
  // expanding/collapsing it persists per user.
  const ebOrderFilters = {
    // Mutually exclusive: 0 = N/A, 1 = customer owes, 2 = refund owed
    openBalance: 0,
    collapsed: true,
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

  // Find EVA's right-hand filter panel — locale-independent. The panel is the
  // top-most ancestor in the right-side column whose class includes
  // `overflow-y-auto`. We anchor on a structural cue (any h2 in the right
  // ~third of the viewport that has a Tailwind text-3xl class), then walk up.
  // We *don't* match on translated strings like "Filters" or "Status" so this
  // works on Dutch / French / German EVA installs too. The URL check in
  // `ensureEbFilterSection` is what restricts mounting to /orders/orders.
  const findEvaFilterPanel = () => {
    const anchor = Array.from(document.querySelectorAll("h2")).find((h) => {
      if (h.getBoundingClientRect().x <= 700) return false;
      const cls = (h.className || "").toString();
      return /\btext-3xl\b/.test(cls); // EVA's right-sidebar title styling
    });
    if (!anchor) return null;
    let p = anchor;
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

  // Runs every tick and immediately on route changes (mount + teardown).
  EB.onTick(ensureEbFilterSection);
})();
