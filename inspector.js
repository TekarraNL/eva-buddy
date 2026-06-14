/*
 * Source Inspector hover-trace tooltip.
 * After a short idle hover on a leaf text node, look the value up in the
 * capture index and show every captured (endpoint, path) it matches.
 * Shift locks the tooltip; while locked, clicking a row opens that capture
 * in the JSON viewer with the filter pre-set to the matched path.
 * Togglable from the popup (Features → Source Inspector).
 */
(() => {
  const EB = globalThis.__evaBuddy;
  if (!EB) return;
  const escapeHtml = EBPure.escapeHtml;

  const SOURCE_TIP_ID = "eva-source-tip";
  const SOURCE_HOVER_DELAY = 350; // ms idle before tooltip shows
  let sourceTipEl = null;
  let sourceTimer = null;
  let sourceShownEl = null;
  let sourcePinned = false;       // Shift-locks the tooltip (interactive, scrollable)
  let lastSrcX = 0, lastSrcY = 0;

  const enabled = () => EB.features.sourceInspector !== false;

  const ensureSourceTip = () => {
    if (sourceTipEl && document.body.contains(sourceTipEl)) return sourceTipEl;
    sourceTipEl = document.createElement("div");
    sourceTipEl.id = SOURCE_TIP_ID;
    sourceTipEl.style.display = "none";
    // While pinned, a row click jumps to the JSON viewer at that path.
    sourceTipEl.addEventListener("click", (e) => {
      if (!sourcePinned) return;
      const row = e.target.closest && e.target.closest(".eva-src-row");
      if (!row) return;
      const capId = Number(row.getAttribute("data-cap-id"));
      let cap = EB.captures.find((c) => c.id === capId);
      // The capture may have been evicted since the tooltip rendered —
      // fall back to the newest capture of the same endpoint.
      if (!cap) cap = EB.captures.find((c) => c.endpoint === row.getAttribute("data-ep"));
      if (!cap) return;
      EB.openViewer(cap, { filter: row.getAttribute("data-path") || "" });
      hideSourceTip();
    });
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
    if (!t || t.length > EB.SRC_MAX_LEN) return null;
    return t;
  };

  const showSourceTip = (target, x, y) => {
    if (!enabled()) return;
    if (!target) return;
    if (EB.isOwnUi(target) || isInteractiveLeaf(target)) return;
    if (EB.tipsVisible && EB.tipsVisible()) return;
    const text = leafText(target);
    if (!text) return;
    const matches = EB.lookupValue(text);
    if (!matches || matches.length === 0) return;
    // Dedupe by endpoint+path (collapse repeat captures of the same call),
    // keeping the newest capture per pair so a click opens current data.
    const seen = new Map();
    for (const m of matches) {
      const key = m.endpoint + "|" + m.path;
      seen.set(key, m); // entries are oldest→newest, so the last one wins
    }
    const unique = Array.from(seen.values());
    if (unique.length === 0) return;
    const rowsHtml = unique.map((m) =>
      '<div class="eva-src-row" data-cap-id="' + m.captureId + '"' +
        ' data-ep="' + escapeHtml(m.endpoint) + '"' +
        ' data-path="' + escapeHtml(m.path || "") + '"' +
        ' title="Open in viewer">' +
        '<span class="eva-src-ep">' + escapeHtml(m.endpoint) + "</span>" +
        '<span class="eva-src-sep"> &rsaquo; </span>' +
        '<span class="eva-src-path">' + escapeHtml(m.path || "(root)") + "</span>" +
      "</div>"
    ).join("");
    const noun = unique.length === 1 ? "source" : "sources";
    const previewLabel = unique.length + " " + noun + " · Shift to lock";
    const lockedLabel  = unique.length + " " + noun + " · Locked · click a row to open · Esc closes";
    const headerHtml =
      '<div class="eva-src-header" data-locked-label="' + escapeHtml(lockedLabel) + '">' +
        escapeHtml(previewLabel) +
      "</div>";
    const tip = ensureSourceTip();
    tip.innerHTML = headerHtml + rowsHtml;
    tip.style.display = "block";
    tip.scrollTop = 0;
    positionSourceTip(x, y);
    sourceShownEl = target;
  };

  // Pointer wiring — via the shared dispatcher in lib.js.
  EB.onPointer("over", (event) => {
    if (!enabled()) return;
    if (sourcePinned) return; // locked tooltip ignores new hovers
    if (sourceTimer) { clearTimeout(sourceTimer); sourceTimer = null; }
    if (sourceShownEl && sourceShownEl !== event.target) hideSourceTip();
    if (EB.isOwnUi(event.target) || isInteractiveLeaf(event.target)) return;
    const target = event.target;
    sourceTimer = setTimeout(() => {
      sourceTimer = null;
      showSourceTip(target, lastSrcX, lastSrcY);
    }, SOURCE_HOVER_DELAY);
  });
  EB.onPointer("move", (event) => {
    lastSrcX = event.clientX;
    lastSrcY = event.clientY;
    if (sourcePinned) return; // pinned tooltip stays put
    if (sourceShownEl) positionSourceTip(event.clientX, event.clientY);
  });
  EB.onPointer("out", (event) => {
    if (sourcePinned) return;
    if (sourceTimer) { clearTimeout(sourceTimer); sourceTimer = null; }
    const to = event.relatedTarget;
    if (sourceShownEl && (!to || !sourceShownEl.contains(to))) hideSourceTip();
  });
  EB.onPointer("scroll", () => {
    if (sourcePinned) return;
    if (sourceTimer) { clearTimeout(sourceTimer); sourceTimer = null; }
    hideSourceTip();
  });
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

  // Toggled off from the popup → drop whatever is showing.
  EB.onFeaturesChanged(() => {
    if (!enabled()) {
      if (sourceTimer) { clearTimeout(sourceTimer); sourceTimer = null; }
      hideSourceTip();
    }
  });
})();
