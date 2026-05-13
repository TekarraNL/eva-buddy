(async () => {
  const headerEl    = document.getElementById("header");
  const endpointEl  = document.getElementById("endpoint");
  const envPillEl   = document.getElementById("env-pill");
  const urlEl       = document.getElementById("url");
  const whenEl      = document.getElementById("when");
  const rowCountEl  = document.getElementById("row-count");
  const filterEl    = document.getElementById("filter");
  const copyAllEl   = document.getElementById("copy-all");
  const contentEl   = document.getElementById("content");

  const id = location.hash.replace(/^#/, "");
  if (!id) {
    showError("No capture id in URL.");
    return;
  }

  // Retry the storage read briefly: when the viewer window opens, the writer
  // tab is racing to set chrome.storage.local and may not have landed yet.
  let stored;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const got = await chrome.storage.local.get(id);
      stored = got[id];
    } catch (err) {
      showError("Could not read from chrome.storage.local: " + err);
      return;
    }
    if (stored) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  if (!stored) {
    showError("No capture data found for id " + id + ".");
    return;
  }
  // Delete the entry after we've grabbed it so storage stays effectively
  // in-memory (no on-disk leak of API responses).
  chrome.storage.local.remove(id).catch(() => {});

  // -----------------------------------------------------------
  // Render header
  // -----------------------------------------------------------
  document.title = stored.endpoint + " · EVA response";
  endpointEl.textContent = stored.endpoint || "(unknown endpoint)";

  const env = detectEnv(stored.url);
  if (env) {
    envPillEl.textContent = env;
    envPillEl.classList.add(env);
  } else {
    envPillEl.hidden = true;
  }

  urlEl.textContent = stored.url || "";
  whenEl.textContent = formatTimestamp(stored.timestamp);

  // -----------------------------------------------------------
  // Flatten JSON to path/value rows
  // -----------------------------------------------------------
  const rows = [];
  flatten(stored.data, "", null, rows);
  rows.forEach((r, i) => (r.idx = i));
  rowCountEl.textContent = rows.length + " value" + (rows.length === 1 ? "" : "s");

  if (rows.length === 0) {
    headerEl.hidden = false;
    contentEl.innerHTML = '<div class="empty-state">Response had no leaf values.</div>';
    return;
  }

  headerEl.hidden = false;
  renderTable(rows, "");

  filterEl.addEventListener("input", () => renderTable(rows, filterEl.value));
  copyAllEl.addEventListener("click", () => copyVisibleRows(rows, filterEl.value));

  // Single delegated click handler for the table — survives re-renders.
  contentEl.addEventListener("click", (e) => {
    const td = e.target.closest("td[data-copy]");
    if (td) {
      const text = td.getAttribute("data-copy");
      copyToClipboard(text, "Copied " + (td.classList.contains("path") ? "path" : "value"));
      return;
    }
    const btn = e.target.closest(".actions button");
    if (btn) {
      e.stopPropagation();
      const act = btn.getAttribute("data-act");
      if (act === "outer") {
        copyToClipboard(JSON.stringify(stored.data, null, 2), "Copied full response");
        return;
      }
      if (act === "raw") {
        const idx = Number(btn.getAttribute("data-row-idx"));
        const row = rows[idx];
        if (!row) return;
        const target = row.parent != null ? row.parent : row.value;
        copyToClipboard(JSON.stringify(target, null, 2), "Copied parent");
      }
    }
  });

  // -----------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------
  function flatten(node, path, parent, out) {
    if (node === null) {
      out.push({ path, value: null, kind: "null", display: "null", parent });
      return;
    }
    const t = typeof node;
    if (t !== "object") {
      out.push({ path, value: node, kind: t, display: String(node), parent });
      return;
    }
    if (Array.isArray(node)) {
      if (node.length === 0) {
        out.push({ path, value: [], kind: "empty", display: "[ ]", parent });
        return;
      }
      for (let i = 0; i < node.length; i++) {
        flatten(node[i], (path ? path : "") + "[" + i + "]", node, out);
      }
      return;
    }
    const keys = Object.keys(node);
    if (keys.length === 0) {
      out.push({ path, value: {}, kind: "empty", display: "{ }", parent });
      return;
    }
    for (const k of keys) {
      const childPath = path ? path + "." + k : k;
      flatten(node[k], childPath, node, out);
    }
  }

  function renderTable(rows, filter) {
    const f = (filter || "").trim().toLowerCase();
    const visible = f
      ? rows.filter((r) =>
          (r.path || "").toLowerCase().includes(f) ||
          (typeof r.display === "string" && r.display.toLowerCase().includes(f))
        )
      : rows;

    if (visible.length === 0) {
      contentEl.innerHTML = '<div class="empty-state">No rows match the filter.</div>';
      return;
    }

    const safe = (s) => String(s).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[ch]));

    const trs = visible.map((r) => {
      return `<tr>
        <td class="path" data-copy="${safe(r.path)}">${safe(r.path) || "<em>(root)</em>"}</td>
        <td class="value v-${r.kind}" data-copy="${safe(r.display)}">${safe(r.display)}</td>
        <td class="actions">
          <button type="button" data-act="raw" data-row-idx="${r.idx}" title="Copy parent object as JSON">{ }</button>
          <button type="button" data-act="outer" title="Copy full response as JSON">{…}</button>
        </td>
      </tr>`;
    }).join("");

    contentEl.innerHTML = `<table class="kv">
      <thead><tr><th>Path</th><th>Value</th><th class="actions-th"></th></tr></thead>
      <tbody>${trs}</tbody>
    </table>`;
  }

  function detectEnv(url) {
    if (!url) return null;
    if (/\.test\.eva-online\.cloud/i.test(url)) return "test";
    if (/\.acc\.eva-online\.cloud/i.test(url))  return "acc";
    if (/\.prod\.eva-online\.cloud/i.test(url)) return "prod";
    return null;
  }

  function formatTimestamp(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    return d.toLocaleString();
  }

  function copyToClipboard(text, message) {
    try {
      navigator.clipboard.writeText(text).then(() => flash(message || "Copied"));
    } catch (_) {}
  }

  function copyVisibleRows(rows, filter) {
    const f = (filter || "").trim().toLowerCase();
    const visible = f
      ? rows.filter((r) =>
          (r.path || "").toLowerCase().includes(f) ||
          (typeof r.display === "string" && r.display.toLowerCase().includes(f))
        )
      : rows;
    const tsv = visible.map((r) => (r.path || "") + "\t" + r.display).join("\n");
    copyToClipboard(tsv, "Copied " + visible.length + " row" + (visible.length === 1 ? "" : "s"));
  }

  function flash(message) {
    const el = document.createElement("div");
    el.className = "copy-flash";
    el.textContent = message;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    setTimeout(() => el.classList.remove("show"), 900);
    setTimeout(() => el.remove(), 1200);
  }

  function showError(message) {
    headerEl.hidden = true;
    contentEl.innerHTML = '<div class="error-state">' + message + '</div>';
  }
})();
