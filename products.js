/*
 * Product-detail "Prices" section.
 * On /pim/products/products-overview/<product_id> EVA doesn't show the
 * product's prices (those live in pricelists, often country-specific).
 * We inject a small card with a pricelist picker that auto-loads the
 * current product's price for the chosen pricelist, via:
 *   1. ListPriceLists                       → pricelist options
 *   2. ListPriceListAdjustments (PriceListID) → the pricelist's adjustments
 *   3. ListPriceListManualInputAdjustments (PriceListAdjustmentID, ProductID)
 *                                            → per-product Value (the price)
 */
(() => {
  const EB = globalThis.__evaBuddy;
  if (!EB) return;
  const escapeHtml = EBPure.escapeHtml;

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
    const res = await EB.evaApiCall("ListPriceLists", {
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
    const res = await EB.evaApiCall("ListPriceListAdjustments", {
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
    const res = await EB.evaApiCall("ListPriceListManualInputAdjustments", {
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
            '<span class="text-primary text-base font-semibold">' + escapeHtml(label) + '</span>' +
          '</div>' +
          '<div class="sm:col-span-2 box-border">' +
            '<span class="text-primary text-base">' + escapeHtml(valStr) + '</span>' + vatNote +
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
        '<span class="text-primary text-base font-semibold">' + escapeHtml(pl.Name || "(unnamed)") + '</span>' +
        ' <span class="text-secondary text-sm">' + escapeHtml(pl.CurrencyID || "") +
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
              '<span class="text-primary text-base">' + escapeHtml(formatMoney(r.value, pl.CurrencyID)) + '</span>' +
              ' <span class="text-secondary text-sm">(' + escapeHtml(label) + ')</span>' +
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
  EB.onTick(maybeInjectProductPrices);
})();
