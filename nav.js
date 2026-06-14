/*
 * Navigation helpers:
 *   - module quick-switch dropdown on the breadcrumb module button
 *   - dashboard search → orders quick-jump
 *   - alt-click any numeric ID to copy it
 */
(() => {
  const EB = globalThis.__evaBuddy;
  if (!EB) return;

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

  // The harvested markup is re-injected via innerHTML later, so strip
  // anything executable: <script> blocks, on* event-handler attributes,
  // and javascript: hrefs.
  const sanitizeSvg = (markup) =>
    String(markup)
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/\s(?:xlink:)?href\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi, "");

  // Harvest EVA's real module icons as we encounter them (dashboard has all
  // ten; every page's breadcrumb has the current one) and cache them so the
  // menu can show real glyphs instead of the colored-letter fallback.
  const harvestModuleIcons = () => {
    let changed = false;
    const grab = (host, name) => {
      if (!name || !MODULE_NAMES.has(name) || moduleIcons[name]) return;
      const svg = host && host.querySelector && host.querySelector("svg");
      if (svg && /<rect[^>]*rx=/.test(svg.outerHTML)) {
        moduleIcons[name] = sanitizeSvg(svg.outerHTML);
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
  // The path is checked per keypress (not at load) so the hijack also works
  // when the user reaches /dashboard/search via SPA navigation.
  // -----------------------------------------------------------
  const DASHBOARD_SEARCH_PATH = /^\/dashboard\/search(\/|\?|$)/i;

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    if (!DASHBOARD_SEARCH_PATH.test(location.pathname)) return;
    const target = e.target;
    if (!target || target.tagName !== "INPUT") return;
    if (target.getAttribute("role") !== "combobox") return;
    const term = EBPure.detectSearchTerm(target.value);
    if (!term) return; // let EVA's default page-search handle it
    e.preventDefault();
    e.stopPropagation();
    location.href = "/orders/orders?limit=25&query=" + encodeURIComponent(term);
  }, true);
})();
