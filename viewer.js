(async () => {
  const headerEl         = document.getElementById("header");
  const endpointEl       = document.getElementById("endpoint");
  const envPillEl        = document.getElementById("env-pill");
  const urlEl            = document.getElementById("url");
  const whenEl           = document.getElementById("when");
  const rowCountEl       = document.getElementById("row-count");
  const filterEl         = document.getElementById("filter");
  const copyAllEl        = document.getElementById("copy-all");
  const toggleRequestEl  = document.getElementById("toggle-request");
  const contentMainEl    = document.getElementById("content");
  const requestPanelEl   = document.getElementById("request-panel");
  const requestHeadersEl = document.getElementById("request-headers");
  const requestPayloadEl = document.getElementById("request-payload");
  const responseBodyEl   = document.getElementById("response-body");

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
  // Header
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
  // Build three row sets: response, request payload, request headers
  // -----------------------------------------------------------
  const responseRows = [];
  flatten(stored.data, "", null, responseRows);
  responseRows.forEach((r, i) => (r.idx = i));
  rowCountEl.textContent =
    responseRows.length + " value" + (responseRows.length === 1 ? "" : "s");

  // Parse the captured request payload, if any. EVA's SDK sends JSON, but
  // fall back to treating the body as a raw string if it doesn't parse.
  let payloadParsed = null;
  const rawRequestBody = stored.requestBody;
  if (rawRequestBody != null) {
    if (typeof rawRequestBody === "string") {
      try { payloadParsed = JSON.parse(rawRequestBody); }
      catch (_) { payloadParsed = rawRequestBody; }
    } else {
      payloadParsed = rawRequestBody;
    }
  }
  const payloadRows = [];
  if (payloadParsed && typeof payloadParsed === "object") {
    flatten(payloadParsed, "", null, payloadRows);
  } else if (payloadParsed != null) {
    payloadRows.push({
      path: "",
      value: payloadParsed,
      kind: typeof payloadParsed,
      display: String(payloadParsed),
      parent: null,
    });
  }
  payloadRows.forEach((r, i) => (r.idx = i));

  const headerRows = [];
  const hdrs = stored.requestHeaders || {};
  Object.keys(hdrs).sort().forEach((k, i) => {
    headerRows.push({
      path: k,
      value: hdrs[k],
      display: String(hdrs[k] == null ? "" : hdrs[k]),
      kind: "string",
      parent: null,
      idx: i,
    });
  });

  // Show toggle only when we actually captured something for the request.
  const hasRequest = headerRows.length > 0 || payloadRows.length > 0;
  toggleRequestEl.hidden = !hasRequest;

  // -----------------------------------------------------------
  // Render
  // -----------------------------------------------------------
  if (responseRows.length === 0) {
    headerEl.hidden = false;
    responseBodyEl.innerHTML = '<div class="empty-state">Response had no leaf values.</div>';
  } else {
    headerEl.hidden = false;
    renderAll();
  }

  function renderAll() {
    const f = filterEl.value;
    renderRowsInto(responseRows, f, responseBodyEl, { actions: true });
    renderRowsInto(headerRows,  f, requestHeadersEl, {
      actions: false,
      emptyMsg: hdrs && Object.keys(hdrs).length ? "No headers match the filter." : "No headers captured.",
    });
    renderRowsInto(payloadRows, f, requestPayloadEl, {
      actions: false,
      emptyMsg: payloadRows.length ? "No payload rows match the filter." : "No payload.",
    });
  }

  // -----------------------------------------------------------
  // Event wiring
  // -----------------------------------------------------------
  filterEl.addEventListener("input", renderAll);

  copyAllEl.addEventListener("click", () => copyVisibleRows(responseRows, filterEl.value));

  toggleRequestEl.addEventListener("click", () => {
    const isShown = !requestPanelEl.hidden;
    requestPanelEl.hidden = isShown;
    contentMainEl.classList.toggle("split", !isShown);
    toggleRequestEl.textContent = isShown ? "Show request" : "Hide request";
    toggleRequestEl.title = isShown
      ? "Show request alongside response"
      : "Hide the request panel";
  });

  // Single delegated click handler — covers response, headers, and payload
  // tables. The {…} and { } action buttons are only rendered for the
  // response panel, so they target stored.data.
  contentMainEl.addEventListener("click", (e) => {
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
        const row = responseRows[idx];
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

  function renderRowsInto(rows, filter, targetEl, opts) {
    opts = opts || {};
    if (rows.length === 0) {
      targetEl.innerHTML =
        '<div class="empty-state mini">' + safe(opts.emptyMsg || "No rows.") + "</div>";
      return;
    }
    const f = (filter || "").trim().toLowerCase();
    const visible = f
      ? rows.filter((r) =>
          (r.path || "").toLowerCase().includes(f) ||
          (typeof r.display === "string" && r.display.toLowerCase().includes(f))
        )
      : rows;

    if (visible.length === 0) {
      targetEl.innerHTML = '<div class="empty-state mini">No rows match the filter.</div>';
      return;
    }

    const showActions = !!opts.actions;
    const trs = visible.map((r) => {
      const actionsCell = showActions
        ? `<td class="actions">
             <button type="button" data-act="raw" data-row-idx="${r.idx}" title="Copy parent object as JSON">{ }</button>
             <button type="button" data-act="outer" title="Copy full response as JSON">{…}</button>
           </td>`
        : "";
      return `<tr>
        <td class="path" data-copy="${safe(r.path)}">${safe(r.path) || "<em>(root)</em>"}</td>
        <td class="value v-${r.kind}" data-copy="${safe(r.display)}">${safe(r.display)}</td>
        ${actionsCell}
      </tr>`;
    }).join("");

    const actionsTh = showActions ? '<th class="actions-th"></th>' : "";
    targetEl.innerHTML = `<table class="kv">
      <thead><tr><th>Path</th><th>Value</th>${actionsTh}</tr></thead>
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
    contentMainEl.innerHTML = '<div class="error-state">' + safe(message) + "</div>";
  }

  function safe(s) {
    return String(s).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[ch]));
  }
})();
