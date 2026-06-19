/*
 * Roles & rights → general information: the Functionalities table lists every
 * functionality with a permission dropdown per column (Manage, Create, Edit,
 * View, Delete, Settings, Scripting, Categories) and an info ("looking glass")
 * icon in the last column. Most rows are fully "Off" for a given role.
 *
 * We add a single filter toggle in the table header (the empty cell above the
 * looking-glass column). Clicking it hides every row that is entirely off —
 * a row survives only if at least one permission column has a real value.
 * "Off", a dash ("-"), and empty all count as off; "On" / a scope name
 * ("Financial", …) count as on.
 */
(() => {
  const EB = globalThis.__evaBuddy;
  if (!EB) return;

  const PATH = /^\/people\/roles-rights\/\d+\/general-information/i;
  const OFF = new Set(["", "-", "Off"]);
  const HIDDEN_CLASS = "eva-rr-hidden";
  const BTN_CLASS = "eva-roles-filter-btn";

  const FUNNEL_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"></path></svg>';

  let filterActive = false;

  // The functionalities table = the one whose header carries the permission
  // column names. Locale note: these column headers ("Manage", "Scripting")
  // are English in EVA's admin; if that ever changes this selector needs
  // revisiting, but there's no structural cue to key off instead.
  const findTable = () => {
    const tables = Array.from(document.querySelectorAll("table"));
    return (
      tables.find((t) => {
        const h = (t.tHead && t.tHead.textContent) || "";
        return /Manage/.test(h) && /Scripting/.test(h);
      }) || null
    );
  };

  // The Categories column is informational — it can carry a scope like
  // "Financial" even when the role grants nothing actionable — so it's
  // excluded from the off-check (treated as off). Keyed off the English
  // header text, same as findTable.
  const categoriesIndex = (table) => {
    const headRow = table.tHead && table.tHead.rows[table.tHead.rows.length - 1];
    if (!headRow) return -1;
    return Array.from(headRow.cells).findIndex(
      (c) => (c.textContent || "").replace(/\s+/g, " ").trim().toLowerCase() === "categories"
    );
  };

  const rowIsAllOff = (tr, catIdx) => {
    const tds = Array.from(tr.children);
    if (tds.length < 3) return false;
    // Skip the name cell (first), the looking-glass icon cell (last), and the
    // Categories column; everything else is an actionable permission column.
    for (let i = 1; i < tds.length - 1; i++) {
      if (i === catIdx) continue;
      if (!OFF.has((tds[i].textContent || "").replace(/\s+/g, " ").trim())) return false;
    }
    return true;
  };

  const applyFilter = (table) => {
    if (!table || !table.tBodies[0]) return;
    const catIdx = categoriesIndex(table);
    Array.from(table.tBodies[0].rows).forEach((tr) => {
      if (filterActive && rowIsAllOff(tr, catIdx)) {
        tr.classList.add(HIDDEN_CLASS);
        tr.style.display = "none";
      } else if (tr.classList.contains(HIDDEN_CLASS)) {
        tr.classList.remove(HIDDEN_CLASS);
        tr.style.display = "";
      }
    });
  };

  const syncButton = (btn) => {
    btn.classList.toggle("active", filterActive);
    btn.title = filterActive
      ? "EVA Buddy: showing only functionalities with at least one permission on — click to show all"
      : "EVA Buddy: hide functionalities that are fully off";
    btn.setAttribute("aria-pressed", filterActive ? "true" : "false");
  };

  // The filter button lives in the shared EVA Buddy toolbar (created by
  // roles-compare.js via EB.ensureRolesToolbar). Fall back to a header-cell
  // mount only if that helper isn't available, so this module still works
  // standalone.
  const ensureButton = (table) => {
    let host = null;
    if (typeof EB.ensureRolesToolbar === "function") {
      const bar = EB.ensureRolesToolbar(table);
      host = bar && bar.querySelector(".eva-eb-tools");
    }
    if (!host) {
      const headRow = table.tHead && table.tHead.rows[table.tHead.rows.length - 1];
      host = headRow && headRow.cells[headRow.cells.length - 1];
    }
    if (!host || host.querySelector("." + BTN_CLASS)) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = BTN_CLASS;
    btn.innerHTML = FUNNEL_SVG;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      filterActive = !filterActive;
      syncButton(btn);
      applyFilter(findTable());
    });
    syncButton(btn);
    host.appendChild(btn);
  };

  const tick = () => {
    if (!PATH.test(location.pathname)) {
      // Left the page — drop the remembered filter state so a fresh visit
      // starts unfiltered.
      filterActive = false;
      return;
    }
    const table = findTable();
    if (!table) return;
    ensureButton(table);
    // Stand down while a cross-environment compare is active — that feature
    // controls row visibility (its own "only differences" toggle).
    if (EB._cmpActive) return;
    // Re-apply on every tick so EVA re-renders (sorting, edits) don't strand
    // hidden rows or reveal ones that should stay hidden.
    if (filterActive) applyFilter(table);
  };

  EB.onTick(tick);
})();
