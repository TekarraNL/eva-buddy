/*
 * Pure helpers shared by the content scripts and the node:test suite.
 * No DOM, no chrome.* APIs in here — that's what keeps it testable with
 * plain `node --test`. Exposed as globalThis.EBPure in the browser and
 * via module.exports under node.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.EBPure = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const escapeHtml = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[ch]));

  // -------- CSV parsing --------
  const parsePriceCsv = (text) => {
    // Strip UTF-8 BOM
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    // Sniff delimiter on the first physical line — tab beats comma if present
    const firstLine = text.split(/\r?\n/, 1)[0] || "";
    const delim = firstLine.includes("\t") && firstLine.split("\t").length > firstLine.split(",").length
      ? "\t" : ",";
    const lines = [];
    let row = [];
    let field = "";
    let inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') inQ = false;
        else field += c;
      } else {
        if (c === '"') inQ = true;
        else if (c === delim) { row.push(field); field = ""; }
        else if (c === "\r" || c === "\n") {
          if (c === "\r" && text[i + 1] === "\n") i++;
          row.push(field); field = "";
          if (row.length > 1 || row[0] !== "") lines.push(row);
          row = [];
        } else field += c;
      }
    }
    if (field !== "" || row.length) { row.push(field); if (row.length > 1 || row[0] !== "") lines.push(row); }
    if (!lines.length) return { delim, header: [], objects: [] };
    const header = lines[0].map((h) => h.trim());
    const objects = lines.slice(1).map((line) => {
      const o = {};
      header.forEach((h, i) => (o[h] = (line[i] != null ? String(line[i]).trim() : "")));
      return o;
    });
    return { delim, header, objects };
  };

  // Case-insensitive column lookup with common aliases
  const pickCol = (row, candidates) => {
    const keys = Object.keys(row);
    for (const cand of candidates) {
      const k = keys.find((x) => x.toLowerCase() === cand.toLowerCase());
      if (k && row[k] !== "") return row[k];
    }
    return "";
  };

  // Accept many incoming date formats and normalise to ISO 8601 UTC.
  // Supports: yyyy-mm-dd, yyyy-mm-ddTHH:MM(:SS)?Z?, yyyy-mm-dd HH:MM(:SS)?,
  //           dd/mm/yyyy(?: HH:MM(:SS)?)?, dd-mm-yyyy(?: HH:MM(:SS)?)?
  // Whitespace inside the value is collapsed first so "31-12-9000  00:00:00"
  // (with the double space some EVA exports produce) parses cleanly.
  const normaliseDate = (s) => {
    s = String(s).trim().replace(/\s+/g, " ");
    if (!s) return null;
    // Already ISO 8601 with a T separator — pass through
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s;
    // ISO date only
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s + "T00:00:00Z";
    const pad = (v, fb) => String(v == null ? (fb || 0) : v).padStart(2, "0");
    // ISO date + space + time
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2}) (\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
    if (m) {
      const [, y, mo, d, hh, mm, ss] = m;
      return y + "-" + pad(mo) + "-" + pad(d) + "T" + pad(hh) + ":" + pad(mm) + ":" + pad(ss) + "Z";
    }
    // dd-mm-yyyy or dd/mm/yyyy, optionally followed by HH:MM(:SS)
    m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?: (\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
    if (m) {
      const [, d, mo, y, hh, mm, ss] = m;
      const time = hh != null ? pad(hh) + ":" + pad(mm) + ":" + pad(ss) : "00:00:00";
      return y + "-" + pad(mo) + "-" + pad(d) + "T" + time + "Z";
    }
    return s;
  };

  // Validate + map one CSV row to one Prices[] entry for the Push body.
  // Same validation rules as buildAdjBody so error messages stay consistent.
  // Prices[].ID strategy: ProductBackendID (upsert key). Change it here if
  // SAP confirms a different convention.
  const buildPriceEntry = (row) => {
    const bid   = pickCol(row, ["BackendID", "Backend ID", "ProductBackendID", "ProductID"]);
    const price = pickCol(row, ["Price", "Value"]);
    const eff   = pickCol(row, ["EffectiveDate", "Effective Date", "StartDate", "From"]);
    const exp   = pickCol(row, ["ExpireDate", "Expire Date", "EndDate", "Until", "To"]);
    if (!bid)              return { error: "Missing BackendID" };
    if (price === "")      return { error: "Missing Price" };
    const valNum = Number(String(price).replace(",", "."));
    if (!isFinite(valNum)) return { error: 'Price not numeric: "' + price + '"' };
    const entry = {
      ID: String(bid),           // upsert key — TODO confirm with SAP
      ProductID: String(bid),     // BackendID value, resolved via Hybrid header
      Price: valNum,
    };
    if (eff) entry.StartDate = normaliseDate(eff);
    if (exp) entry.EndDate   = normaliseDate(exp);
    return { entry };
  };

  // Build one CreatePriceListManualInputAdjustment body for a single CSV row.
  // The CSV's `ID` column is intentionally IGNORED — the adjustment ID comes
  // from the page's most recent ListPriceListManualInputAdjustments call so
  // we always target whatever adjustment the user has open.
  const buildAdjBody = (row, adjId) => {
    const bid    = pickCol(row, ["BackendID", "Backend ID", "ProductBackendID", "ProductID"]);
    const price  = pickCol(row, ["Price", "Value"]);
    const eff    = pickCol(row, ["EffectiveDate", "Effective Date", "StartDate", "From"]);
    const exp    = pickCol(row, ["ExpireDate", "Expire Date", "EndDate", "Until", "To"]);
    if (!adjId)            return { error: "No active adjustment detected" };
    if (!bid)              return { error: "Missing BackendID" };
    if (price === "")      return { error: "Missing Price" };
    const valNum = Number(String(price).replace(",", "."));
    if (!isFinite(valNum)) return { error: 'Price not numeric: "' + price + '"' };
    const body = {
      PriceListAdjustmentID: adjId,
      // ProductID + EVA-IDs-Mode: Hybrid lets us pass the BackendID here and
      // have EVA resolve it server-side — no per-row GetProductDetail needed.
      ProductID: bid,
      Value: valNum,
    };
    if (eff) body.EffectiveDate = normaliseDate(eff);
    if (exp) body.ExpireDate    = normaliseDate(exp);
    return { body };
  };

  // -------- Return/refund detection on order objects --------
  // Strings in *captured* fields are pretty controlled — match "return" or
  // "refund" anywhere as a word.
  const isReturnishField = (text) =>
    typeof text === "string" && /\b(return|refund)/i.test(text);

  // Walk an order-object up to a few levels deep looking for return signals.
  // Handles snake_case + nested status objects + arrays of related items.
  const orderObjectIsReturnFlagged = (root) => {
    const STATUS_KEY_RE = /status|type|state|reason|kind|label|name/i;
    const RETURN_KEY_RE = /return|refund/i;

    const walk = (node, depth) => {
      if (!node || typeof node !== "object" || depth > 5) return false;
      if (Array.isArray(node)) {
        for (const c of node) if (walk(c, depth + 1)) return true;
        return false;
      }
      for (const k of Object.keys(node)) {
        const v = node[k];
        // 1. Boolean flag (is_returned, has_return_lines, IsReturned, …)
        if (RETURN_KEY_RE.test(k) && v === true) return true;
        // 2. String status/type/name field whose value mentions return/refund
        if (typeof v === "string" && STATUS_KEY_RE.test(k) && isReturnishField(v)) {
          return true;
        }
        // 3. Non-empty array under a return-related key (e.g. return_lines[])
        if (Array.isArray(v) && v.length > 0 && RETURN_KEY_RE.test(k)) return true;
        // 4. Recurse into nested objects/arrays
        if (v && typeof v === "object") {
          if (walk(v, depth + 1)) return true;
        }
      }
      return false;
    };

    return walk(root, 0);
  };

  // -------- Dashboard search term detection --------
  const detectSearchTerm = (raw) => {
    const t = (raw || "").trim();
    if (!t) return null;
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return t; // email
    if (/^[0-9]+$/.test(t)) return t;                    // numeric ID
    return null;
  };

  const formatDuration = (sec) => {
    sec = Math.round(sec);
    if (sec < 60) return sec + "s";
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (m < 60) return m + "m " + s + "s";
    const h = Math.floor(m / 60);
    return h + "h " + (m % 60) + "m";
  };

  return {
    escapeHtml,
    parsePriceCsv,
    pickCol,
    normaliseDate,
    buildPriceEntry,
    buildAdjBody,
    isReturnishField,
    orderObjectIsReturnFlagged,
    detectSearchTerm,
    formatDuration,
  };
});
