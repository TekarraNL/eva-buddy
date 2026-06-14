/*
 * Page chrome: EVA dark mode, the colored env stripe + lip (with live
 * capture count), the captured-responses dropdown (grouped by endpoint,
 * filterable, clearable), the tinted favicon, and the 🚀 title prefix.
 */
(() => {
  const EB = globalThis.__evaBuddy;
  if (!EB) return;
  const env = EB.env;
  const escapeHtml = EBPure.escapeHtml;

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

  const BAR_ID = "eva-env-indicator-bar";
  const BAR_LIP_ID = "eva-env-bar-lip";
  const BAR_DROPDOWN_ID = "eva-env-bar-dropdown";
  const FAVICON_ID = "eva-env-indicator-favicon";
  const TITLE_PREFIX = EB.isBeyond ? "🚀 " : "";

  // -----------------------------------------------------------
  // Captured-responses dropdown (anchored under the bar lip)
  // -----------------------------------------------------------
  const dropdownIsOpen = () => !!document.getElementById(BAR_DROPDOWN_ID);
  let ddFilter = ""; // persists while the dropdown is open

  const formatRelativeTime = (ts) => {
    const diff = Math.max(0, Date.now() - ts);
    if (diff < 1000) return "just now";
    if (diff < 60_000) return Math.floor(diff / 1000) + "s ago";
    if (diff < 3_600_000) return Math.floor(diff / 60_000) + "m ago";
    return Math.floor(diff / 3_600_000) + "h ago";
  };

  const renderDdList = () => {
    const dd = document.getElementById(BAR_DROPDOWN_ID);
    if (!dd) return;
    const list = dd.querySelector(".eva-dd-list");
    const title = dd.querySelector(".eva-dd-title");
    if (!list || !title) return;

    const total = EB.captures.length;
    title.textContent = total + " response" + (total === 1 ? "" : "s") + " on this page";

    if (total === 0) {
      list.innerHTML = '<div class="eva-dd-empty">No API responses captured yet on this page. Interact with EVA to populate.</div>';
      return;
    }

    // Group repeat calls by endpoint; captures are newest-first, so the
    // first capture we see per endpoint is the one a click opens.
    const groups = new Map(); // endpoint -> { endpoint, count, newest }
    for (const c of EB.captures) {
      let g = groups.get(c.endpoint);
      if (!g) { g = { endpoint: c.endpoint, count: 0, newest: c }; groups.set(c.endpoint, g); }
      g.count++;
    }

    const f = ddFilter.trim().toLowerCase();
    const visible = Array.from(groups.values()).filter(
      (g) => !f || g.endpoint.toLowerCase().includes(f)
    );
    if (visible.length === 0) {
      list.innerHTML = '<div class="eva-dd-empty">No endpoints match the filter.</div>';
      return;
    }

    list.innerHTML = visible.map((g) =>
      `<button type="button" class="eva-dd-row" data-cap-id="${g.newest.id}">
        <span class="eva-dd-name">${escapeHtml(g.endpoint)}${g.count > 1 ? '<span class="eva-dd-count">×' + g.count + "</span>" : ""}</span>
        <span class="eva-dd-time">${formatRelativeTime(g.newest.timestamp)}</span>
      </button>`
    ).join("");
    list.querySelectorAll(".eva-dd-row").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = Number(btn.getAttribute("data-cap-id"));
        const cap = EB.captures.find((c) => c.id === id);
        if (cap) EB.openViewer(cap);
        closeDropdown();
      });
    });
  };

  const openDropdown = () => {
    if (dropdownIsOpen()) return;
    const dd = document.createElement("div");
    dd.id = BAR_DROPDOWN_ID;
    dd.innerHTML =
      '<div class="eva-dd-header">' +
        '<span class="eva-dd-title"></span>' +
        '<button type="button" class="eva-dd-clear" title="Forget all captured responses for this page">Clear</button>' +
      "</div>" +
      '<div class="eva-dd-toolbar">' +
        '<input type="search" class="eva-dd-filter" placeholder="Filter endpoints…" autocomplete="off" />' +
      "</div>" +
      '<div class="eva-dd-list"></div>';
    document.body.appendChild(dd);

    const filterInput = dd.querySelector(".eva-dd-filter");
    filterInput.value = ddFilter;
    filterInput.addEventListener("input", () => {
      ddFilter = filterInput.value;
      renderDdList();
    });
    dd.querySelector(".eva-dd-clear").addEventListener("click", (e) => {
      e.stopPropagation();
      EB.clearCaptures();
    });

    renderDdList();
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

  // -----------------------------------------------------------
  // Top bar + lip (lip shows the live capture count)
  // -----------------------------------------------------------
  const updateLip = () => {
    const lip = document.getElementById(BAR_LIP_ID);
    if (!lip) return;
    const n = EB.captures.length;
    lip.innerHTML = "▾" + (n ? ' <span class="eva-lip-count">' + n + "</span>" : "");
  };

  const injectBar = () => {
    if (document.getElementById(BAR_ID)) return;
    const bar = document.createElement("div");
    bar.id = BAR_ID;
    bar.className = `eva-env-${env.key}`;
    bar.title = `EVA ${env.label}${EB.isBeyond ? " (beyond)" : ""} — ${EB.host}`;

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
    updateLip();
  };

  EB.onCapture(() => {
    updateLip();
    if (dropdownIsOpen()) renderDdList();
  });
  EB.onCapturesCleared(() => {
    updateLip();
    if (dropdownIsOpen()) renderDdList();
  });

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
  // Bootstrap + observers
  // -----------------------------------------------------------
  EB.onReady(() => {
    injectBar();
    setFavicon();
    setTitle();

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
  });
})();
