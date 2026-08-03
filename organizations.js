/*
 * Organizations overview: EVA's list table (ID / Name / Backend ID / Country /
 * Type) doesn't show each org's Status, but the ListOrganizationUnitsDetailed
 * response carries it as a number. We capture that response, map ID → Status,
 * and append a "Status" column to the table showing the numeric value per row.
 */
(() => {
  const EB = globalThis.__evaBuddy;
  if (!EB) return;

  const PATH = /^\/organizations\/organizations\/?$/i; // the list view only
  const HEAD_MARK = "eva-ou-status-head";
  const CELL_MARK = "eva-ou-status-cell";

  const statusById = new Map(); // org ID (string) -> numeric Status

  // Walk a captured response and record every org item's Status. Org items
  // carry ID + numeric Status + BackendID, which keeps us off unrelated nodes.
  const collectStatuses = (data) => {
    const seen = new WeakSet();
    const walk = (node, depth) => {
      if (!node || typeof node !== "object" || depth > 6 || seen.has(node)) return;
      seen.add(node);
      if (Array.isArray(node)) {
        for (const item of node) walk(item, depth + 1);
        return;
      }
      if (node.ID != null && typeof node.Status === "number" && "BackendID" in node) {
        statusById.set(String(node.ID), node.Status);
      }
      for (const k of Object.keys(node)) walk(node[k], depth + 1);
    };
    walk(data, 0);
  };

  EB.onCapture((cap) => {
    if ((cap.endpoint || "").toLowerCase() !== "listorganizationunitsdetailed") return;
    collectStatuses(cap.data);
    // Fill the column promptly rather than waiting for the next tick.
    try { ensureStatusColumn(); } catch (_) {}
  });

  const findTable = () => {
    const tables = Array.from(document.querySelectorAll("table"));
    return tables.find((t) => {
      const h = (t.tHead && t.tHead.textContent) || "";
      return /Name/.test(h) && /Backend ID/.test(h) && /Type/.test(h);
    }) || null;
  };

  function ensureStatusColumn() {
    if (!PATH.test(location.pathname)) return;
    const table = findTable();
    if (!table || !table.tHead || !table.tHead.rows[0] || !table.tBodies[0]) return;

    // Header — append once, cloning the last header cell's styling so it looks
    // native, then overriding its label.
    const headRow = table.tHead.rows[0];
    if (!headRow.querySelector("." + HEAD_MARK)) {
      const proto = headRow.cells[headRow.cells.length - 1];
      const th = document.createElement(proto.tagName);
      th.className = proto.className;
      th.classList.add(HEAD_MARK);
      th.setAttribute("data-eva-buddy", "status-col");
      th.textContent = "Status";
      headRow.appendChild(th);
    }

    // Body — one cell per row, keyed off the row's ID (first cell).
    Array.from(table.tBodies[0].rows).forEach((row) => {
      if (!row.children.length) return;
      const id = (row.children[0].textContent || "").trim();
      let cell = row.querySelector("." + CELL_MARK);
      if (!cell) {
        const proto = row.children[row.children.length - 1];
        cell = document.createElement(proto.tagName);
        cell.className = proto.className;
        cell.classList.add(CELL_MARK);
        cell.setAttribute("data-eva-buddy", "status-col");
        row.appendChild(cell);
      }
      const status = statusById.get(id);
      const txt = status == null ? "–" : String(status);
      if (cell.textContent !== txt) cell.textContent = txt;
    });
  }

  // Re-apply on every tick so EVA's re-renders (sorting, pagination, filters)
  // don't strand the column.
  EB.onTick(() => { try { ensureStatusColumn(); } catch (_) {} });
})();
