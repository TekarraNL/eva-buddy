/*
 * Price-list CSV bulk upload.
 * EVA has a built-in xlsx upload on price-list adjustments but it
 * chokes on anything more than a few hundred rows. When that button
 * shows, we dock a "CSV" button next to it; clicking it opens a modal
 * that streams an arbitrary-size UTF-8 CSV through the API:
 *   - Push mode (SAP-pushed pricelists): chunked PushPriceList_Async
 *   - Create mode (UI-created pricelists): one
 *     CreatePriceListManualInputAdjustment per row
 * Failed rows can be retried from the done screen without re-picking a file.
 */
(() => {
  const EB = globalThis.__evaBuddy;
  if (!EB) return;
  const { escapeHtml, parsePriceCsv, buildPriceEntry, buildAdjBody, formatDuration } = EBPure;

  const PRICE_CSV_BTN_CLASS = "eva-price-csv-btn";
  const PRICE_CSV_MODAL_ID = "eva-price-csv-modal";
  const PRICELIST_PATH_RE = /^\/financials\/price-lists\/(\d+)(\/|$)/i;
  const ADJUSTMENT_URL_RE = /\/adjustments\/(\d+)/i;
  const USER_AGENT = "EVA-Buddy/" + EB.VERSION;

  const isPriceListPage = () => PRICELIST_PATH_RE.test(location.pathname);

  // EVA's upload button is an icon-only button: <svg name="lyra-upload">
  // <use href=".../icon-defs.svg#upload"> — no text, no aria-label. We match
  // either the SVG name or the use-href, then walk up to the wrapping button.
  const findEvaUploadButtons = () => {
    if (!isPriceListPage()) return [];
    const matches = new Set();
    document.querySelectorAll('svg[name="lyra-upload"]').forEach((svg) => {
      const btn = svg.closest("button");
      if (btn && !btn.classList.contains(PRICE_CSV_BTN_CLASS)) matches.add(btn);
    });
    document.querySelectorAll('use[href*="#upload"], use[xlink\\:href*="#upload"]').forEach((u) => {
      const btn = u.closest("button");
      if (btn && !btn.classList.contains(PRICE_CSV_BTN_CLASS)) matches.add(btn);
    });
    return Array.from(matches);
  };

  // From a button, walk up looking for the adjustment id this button belongs to.
  // EVA renders adjustments as collapsible cards on the price-list page; if the
  // button lives in such a card, links/inputs near it carry /adjustments/<id>.
  // Fallback: the current URL when the modal route is active.
  const findAdjustmentIdForButton = (btn) => {
    let p = btn;
    for (let i = 0; i < 12 && p; i++) {
      const link = p.querySelector && p.querySelector('a[href*="/adjustments/"]');
      if (link) {
        const m = link.getAttribute("href").match(ADJUSTMENT_URL_RE);
        if (m) return m[1];
      }
      const dataId = (p.dataset && (p.dataset.adjustmentId || p.dataset.id)) || "";
      if (/^\d{8,}$/.test(dataId)) return dataId;
      p = p.parentElement;
    }
    const m = location.pathname.match(ADJUSTMENT_URL_RE);
    return m ? m[1] : null;
  };

  const ensurePriceCsvButtons = () => {
    // Remove orphans (parent or EVA button gone)
    document.querySelectorAll("." + PRICE_CSV_BTN_CLASS).forEach((b) => {
      if (!b.dataset.ebTwinId) return;
      const twin = document.getElementById(b.dataset.ebTwinId);
      if (!twin || !document.contains(twin)) b.remove();
    });
    const evaButtons = findEvaUploadButtons();
    evaButtons.forEach((evaBtn) => {
      // Already paired?
      const next = evaBtn.nextElementSibling;
      if (next && next.classList && next.classList.contains(PRICE_CSV_BTN_CLASS)) return;
      const adjId = findAdjustmentIdForButton(evaBtn);
      if (!adjId) return;
      // Stable id so we can find the twin again
      if (!evaBtn.id) evaBtn.id = "eva-xlsx-" + Math.random().toString(36).slice(2, 8);
      const ours = document.createElement("button");
      ours.className = PRICE_CSV_BTN_CLASS;
      ours.type = "button";
      ours.title = "EVA Buddy: bulk-upload prices via UTF-8 CSV (experimental — verify a small batch first)";
      // Same dimensions as EVA's icon button (a small square) so the row
      // doesn't shift; "CSV" inside is the label.
      ours.innerHTML = '<span class="eva-price-csv-btn-label">CSV</span>';
      ours.dataset.ebTwinId = evaBtn.id;
      ours.dataset.adjId = adjId;
      ours.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Resolve the target adjustment at click time. Prefer the captured
        // ListPriceListManualInputAdjustments filter (matches the adjustment
        // the user has open right now); fall back to the DOM-walked id.
        const detected = findActiveAdjustmentId() || adjId;
        openPriceCsvModal(detected);
      });
      evaBtn.parentElement.insertBefore(ours, evaBtn.nextSibling);
    });
  };

  // The page itself fires ListPriceListManualInputAdjustments when an
  // adjustment is expanded, with PriceListAdjustmentID in the request filter.
  // That's the most reliable source of truth for "which adjustment is this
  // user currently looking at" — more reliable than walking the DOM. We read
  // it straight off the latest capture (newest-first ordering).
  const findActiveAdjustmentId = () => {
    for (const cap of EB.captures) {
      if (cap.endpoint !== "ListPriceListManualInputAdjustments") continue;
      if (!cap.requestBody) continue;
      let body;
      try { body = JSON.parse(cap.requestBody); } catch (_) { continue; }
      const pc = body && body.PageConfig;
      // EVA's filter object is sometimes "Filter", sometimes "Filters" — try both.
      const f = pc && (pc.Filter || pc.Filters);
      const id = f && f.PriceListAdjustmentID;
      if (id) return String(id);
    }
    return null;
  };

  // -------- Push (bulk) configuration --------
  // For SAP-pushed pricelists we use POST /async-message/PushPriceList in
  // chunks instead of one CreatePriceListManualInputAdjustment per row.
  // Each chunk uploads up to PRICE_PUSH_CHUNK_SIZE prices in a single call;
  // EVA processes the chunk async server-side (WaitForCompletion: false).
  const PRICE_PUSH_CHUNK_SIZE = 5000;

  // Pull pricelist metadata so we can build the Push envelope (needs ID +
  // SystemID — the caller-side identifiers, not EVA's internal numeric ID).
  const fetchPricelistMeta = async (internalPricelistId) => {
    try {
      const res = await EB.evaApiCall("GetPriceListByID", { ID: internalPricelistId });
      if (!res || res.status < 200 || res.status >= 300 || !res.data) return null;
      const r = res.data.Result || res.data;
      if (!r) return null;
      // Push needs BackendID + BackendSystemID. UI-created pricelists have
      // neither — we return null so the caller falls back to per-row Create.
      if (!r.BackendID || !r.BackendSystemID) return null;
      return {
        backendID:       String(r.BackendID),
        backendSystemID: String(r.BackendSystemID),
        currencyID:      r.CurrencyID || null,
        timeZone:        r.TimeZone || null,
        includingVat:    !!r.IncludingVat,
      };
    } catch (_) {
      return null;
    }
  };

  // Find the BackendID of the specific adjustment (component) the user has
  // open — that's the Component.ID Push wants. The caller already has the
  // adjustment's EVA-internal numeric ID; we map it via ListPriceListAdjustments.
  const fetchAdjustmentBackendID = async (internalPricelistId, internalAdjustmentId) => {
    try {
      const res = await EB.evaApiCall("ListPriceListAdjustments", {
        PageConfig: { Filter: { PriceListID: internalPricelistId }, Limit: 200, SortDirection: 0, Start: 0 },
      });
      if (!res || res.status < 200 || res.status >= 300 || !res.data) return null;
      const r = res.data.Result;
      const page = r && (r.Page || r.Results);
      if (!Array.isArray(page)) return null;
      const target = page.find((a) => String(a.ID) === String(internalAdjustmentId));
      return target && target.BackendID ? String(target.BackendID) : null;
    } catch (_) {
      return null;
    }
  };

  // Assemble the Push envelope from resolved meta + a batch of price entries.
  // Components[0] targets the existing adjustment by its BackendID; we don't
  // pass Name/StartDate/EndDate so EVA leaves the component's own metadata
  // untouched. RemoveUnprovidedEntries: false means other entries are kept.
  const buildPushBody = (meta, componentBackendID, entries) => ({
    ID: meta.backendID,
    SystemID: meta.backendSystemID,
    LowProductCountOption: 0,
    RecalculateEffectivePrices: false,
    WaitForCompletion: false,
    Components: [
      {
        ID: componentBackendID,
        Type: 0,                  // PriceEntries
        Delete: false,
        PriceEntriesData: {
          RemoveUnprovidedEntries: false,
          Prices: entries,
        },
      },
    ],
  });

  const openPriceCsvModal = (defaultAdjId) => {
    // Close any existing
    const old = document.getElementById(PRICE_CSV_MODAL_ID);
    if (old) old.remove();

    const overlay = document.createElement("div");
    overlay.id = PRICE_CSV_MODAL_ID;
    overlay.innerHTML =
      '<div class="eva-csv-card">' +
        '<header class="eva-csv-head">' +
          '<div>' +
            '<strong>EVA Buddy · CSV price upload <span class="eva-csv-exp">experimental</span></strong>' +
            '<span class="eva-csv-sub">Adjustment ' + escapeHtml(defaultAdjId) + '</span>' +
          '</div>' +
          '<button type="button" class="eva-csv-close" aria-label="Close">×</button>' +
        '</header>' +
        '<div class="eva-csv-body">' +
          '<div class="eva-csv-banner">⚠️ Experimental. Try a small batch first and confirm the prices land before running a large upload.</div>' +
          // Pick step
          '<section class="eva-csv-step step-pick">' +
            '<p>Pick a UTF-8 CSV. Expected columns: ' +
              '<code>BackendID</code>, <code>Price</code>, ' +
              '<code>EffectiveDate</code>, <code>ExpireDate</code> (optional). ' +
              'Any <code>ID</code> column in the CSV is ignored — EVA Buddy targets the adjustment shown above.' +
            '</p>' +
            '<p class="eva-csv-hint">Comma or tab delimited. Decimal comma is fine. Dates as <code>yyyy-mm-dd</code> or <code>dd/mm/yyyy</code>.</p>' +
            '<label class="eva-csv-file-btn">' +
              '<input type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" />' +
              'Choose CSV…' +
            '</label>' +
          '</section>' +
          // Preview step
          '<section class="eva-csv-step step-preview" hidden>' +
            '<p class="eva-csv-preview-summary"></p>' +
            '<div class="eva-csv-preview-wrap"><table class="eva-csv-preview"></table></div>' +
            '<div class="eva-csv-actions">' +
              '<button type="button" class="eva-csv-pick-again">Pick another file</button>' +
              '<button type="button" class="eva-csv-start">Start upload</button>' +
            '</div>' +
          '</section>' +
          // Progress step
          '<section class="eva-csv-step step-progress" hidden>' +
            '<div class="eva-csv-bar"><div class="eva-csv-bar-fill"></div></div>' +
            '<p class="eva-csv-progress-text"></p>' +
            '<div class="eva-csv-actions">' +
              '<button type="button" class="eva-csv-pause">Pause</button>' +
              '<button type="button" class="eva-csv-cancel">Cancel</button>' +
            '</div>' +
            '<details class="eva-csv-errs" hidden>' +
              '<summary class="eva-csv-errs-summary"></summary>' +
              '<ol class="eva-csv-errs-list"></ol>' +
            '</details>' +
          '</section>' +
          // Done step
          '<section class="eva-csv-step step-done" hidden>' +
            '<p class="eva-csv-done-text"></p>' +
            '<details class="eva-csv-errs eva-csv-errs-final" hidden>' +
              '<summary class="eva-csv-errs-summary"></summary>' +
              '<ol class="eva-csv-errs-list"></ol>' +
            '</details>' +
            '<div class="eva-csv-actions">' +
              '<button type="button" class="eva-csv-copy-errs" hidden>Copy errors</button>' +
              '<button type="button" class="eva-csv-retry" hidden>Retry failed rows</button>' +
              '<button type="button" class="eva-csv-close-done">Close</button>' +
            '</div>' +
          '</section>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    const $ = (sel) => overlay.querySelector(sel);
    const $$ = (sel) => overlay.querySelectorAll(sel);
    const setStep = (name) => {
      $$(".eva-csv-step").forEach((s) => (s.hidden = true));
      $(".step-" + name).hidden = false;
    };

    const state = {
      defaultAdjId,
      rows: [],
      header: [],
      successCount: 0,
      errors: [],
      paused: false,
      cancelled: false,
      processedCount: 0,
    };

    const close = () => overlay.remove();
    $(".eva-csv-close").addEventListener("click", close);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

    $('.eva-csv-file-btn input[type="file"]').addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const { header, objects } = parsePriceCsv(text);
        state.header = header;
        state.rows   = objects;
        $(".eva-csv-preview-summary").textContent =
          objects.length + " row" + (objects.length === 1 ? "" : "s") +
          " · columns: " + header.join(", ");
        const previewRows = objects.slice(0, 5);
        const table = $(".eva-csv-preview");
        table.innerHTML =
          "<thead><tr>" + header.map((h) => "<th>" + escapeHtml(h) + "</th>").join("") + "</tr></thead>" +
          "<tbody>" +
            previewRows.map((r) =>
              "<tr>" + header.map((h) => "<td>" + escapeHtml(r[h] || "") + "</td>").join("") + "</tr>"
            ).join("") +
          "</tbody>";
        setStep("preview");
      } catch (err) {
        alert("Couldn't read CSV: " + err);
      }
    });

    $(".eva-csv-pick-again").addEventListener("click", () => {
      $('.eva-csv-file-btn input[type="file"]').value = "";
      setStep("pick");
    });

    $(".eva-csv-start").addEventListener("click", () => {
      setStep("progress");
      runUpload(state, overlay).catch((err) => {
        console.error("[eva-buddy] CSV upload crashed:", err);
        alert("Upload crashed: " + err);
      });
    });

    $(".eva-csv-pause").addEventListener("click", (e) => {
      state.paused = !state.paused;
      e.currentTarget.textContent = state.paused ? "Resume" : "Pause";
    });
    $(".eva-csv-cancel").addEventListener("click", () => { state.cancelled = true; });
    $(".eva-csv-close-done").addEventListener("click", close);

    $(".eva-csv-copy-errs").addEventListener("click", () => {
      const tsv = "row\tmessage\tdata\n" + state.errors.map((e) =>
        e.rowNum + "\t" + (e.msg || "") + "\t" + JSON.stringify(e.data || {})
      ).join("\n");
      try { navigator.clipboard.writeText(tsv); } catch (_) {}
    });

    // Retry only the rows that failed, reusing the same modal state. Each
    // error entry carries retryRows (the original CSV row objects), so this
    // works for both per-row Create failures and whole-chunk Push failures.
    $(".eva-csv-retry").addEventListener("click", () => {
      const rows = state.errors.flatMap((err) => err.retryRows || []);
      if (!rows.length) return;
      state.rows = rows;
      state.errors = [];
      state.successCount = 0;
      state.processedCount = 0;
      state.cancelled = false;
      state.paused = false;
      $(".eva-csv-pause").textContent = "Pause";
      const progErrs = $(".step-progress .eva-csv-errs");
      progErrs.hidden = true;
      progErrs.querySelector(".eva-csv-errs-list").innerHTML = "";
      $(".eva-csv-errs-final").hidden = true;
      $(".eva-csv-copy-errs").hidden = true;
      $(".eva-csv-retry").hidden = true;
      setStep("progress");
      runUpload(state, overlay).catch((err) => {
        console.error("[eva-buddy] CSV retry crashed:", err);
        alert("Retry crashed: " + err);
      });
    });
  };

  // Pull a friendly error message out of an evaApiCall result.
  const apiErrMsg = (res) =>
    (res && res.data && (
      (res.data.Error && (res.data.Error.Message || res.data.Error.Code)) ||
      res.data.Message || res.data.message
    )) ||
    (res && res.error) ||
    ("HTTP " + (res && res.status));

  // Render the shared progress block on either upload path.
  const makeProgressRenderer = (overlay, state, total, started, modeLabel) => () => {
    const $ = (sel) => overlay.querySelector(sel);
    const progText = $(".eva-csv-progress-text");
    const barFill  = $(".eva-csv-bar-fill");
    const errsDet  = $(".step-progress .eva-csv-errs");
    const errsSum  = errsDet.querySelector(".eva-csv-errs-summary");
    const errsOl   = errsDet.querySelector(".eva-csv-errs-list");

    const done = state.processedCount;
    const pct = total ? (done / total) * 100 : 0;
    barFill.style.width = pct.toFixed(2) + "%";
    const elapsed = (Date.now() - started) / 1000;
    const rate = done > 0 ? elapsed / done : 0;
    const remaining = rate * (total - done);
    const eta = remaining > 0 ? " · ~" + formatDuration(remaining) + " left" : "";
    progText.textContent =
      modeLabel + " · " + done + " / " + total +
      " · " + state.successCount + " ok · " + state.errors.length + " errors" + eta;
    if (state.errors.length) {
      errsDet.hidden = false;
      errsSum.textContent = state.errors.length + " error" + (state.errors.length === 1 ? "" : "s");
      errsOl.innerHTML = state.errors.slice(-50).map((e) =>
        "<li><strong>" + escapeHtml(e.label || ("Row " + e.rowNum)) + "</strong>: " + escapeHtml(e.msg) + "</li>"
      ).join("");
    }
  };

  const renderDoneStep = (overlay, state, total, headlineText) => {
    const $ = (sel) => overlay.querySelector(sel);
    $(".eva-csv-done-text").textContent = headlineText;
    if (state.errors.length) {
      const finalDet = $(".eva-csv-errs-final");
      const finalSum = finalDet.querySelector(".eva-csv-errs-summary");
      const finalOl  = finalDet.querySelector(".eva-csv-errs-list");
      finalDet.hidden = false;
      finalSum.textContent = "Show " + state.errors.length + " error" + (state.errors.length === 1 ? "" : "s");
      finalOl.innerHTML = state.errors.map((e) =>
        "<li><strong>" + escapeHtml(e.label || ("Row " + e.rowNum)) + "</strong>: " + escapeHtml(e.msg) + "</li>"
      ).join("");
      $(".eva-csv-copy-errs").hidden = false;
    }
    const retryBtn = $(".eva-csv-retry");
    if (retryBtn) {
      const retryable = state.errors.reduce(
        (acc, e) => acc + (e.retryRows ? e.retryRows.length : 0), 0
      );
      retryBtn.hidden = retryable === 0;
      retryBtn.textContent = "Retry failed rows (" + retryable + ")";
    }
    $(".step-progress").hidden = true;
    $(".step-done").hidden = false;
  };

  // -------- Push path (bulk, chunked) --------
  // pre-validates every row → drops invalid ones into state.errors → chunks
  // valid entries into PRICE_PUSH_CHUNK_SIZE batches → fires one
  // PushPriceList_Async per chunk. Per-row error visibility is preserved (we
  // log each invalid CSV row by rowNum); per-chunk errors are recorded with a
  // "Chunk N" label so the user can tell row-level from chunk-level failures.
  const runPushUpload = async (state, overlay, meta, componentBackendID) => {
    const total = state.rows.length;
    const started = Date.now();
    const renderProgress = makeProgressRenderer(
      overlay, state, total, started, "Push mode"
    );

    // 1. Pre-validate all rows so chunk N doesn't bring down validations for
    //    rows we haven't reached yet. Build (rowNum, entry) pairs for the
    //    valid ones; everything else is an error.
    const valids = [];
    for (let i = 0; i < total; i++) {
      const row = state.rows[i];
      const built = buildPriceEntry(row);
      if (built.error) {
        state.errors.push({ rowNum: i + 2, msg: built.error, data: row, retryRows: [row] });
      } else {
        valids.push({ rowNum: i + 2, row, entry: built.entry });
      }
    }
    // Count pre-validation errors as processed already.
    state.processedCount = state.errors.length;
    renderProgress();

    // 2. Chunk valid entries and Push each.
    const chunkSize = PRICE_PUSH_CHUNK_SIZE;
    const totalChunks = Math.max(1, Math.ceil(valids.length / chunkSize));
    let chunkIdx = 0;
    for (let start = 0; start < valids.length; start += chunkSize) {
      if (state.cancelled) break;
      while (state.paused) {
        await new Promise((r) => setTimeout(r, 200));
        if (state.cancelled) break;
      }
      if (state.cancelled) break;

      chunkIdx++;
      const slice   = valids.slice(start, start + chunkSize);
      const entries = slice.map((v) => v.entry);
      const body    = buildPushBody(meta, componentBackendID, entries);
      try {
        const res = await EB.evaApiCall(
          "PushPriceList",
          body,
          {
            "eva-ids-mode":   "Hybrid",
            "eva-user-agent": USER_AGENT,
          },
          { async: true, timeoutMs: 60000 }
        );
        if (res && res.status >= 200 && res.status < 300) {
          state.successCount += entries.length;
        } else {
          // Whole chunk failed — log once at the chunk level + tag the rows
          // that were in it for traceability (and retry).
          const msg = String(apiErrMsg(res));
          state.errors.push({
            label: "Chunk " + chunkIdx + "/" + totalChunks +
                   " (rows " + slice[0].rowNum + "–" + slice[slice.length - 1].rowNum + ")",
            msg,
            data: { firstRow: slice[0].rowNum, lastRow: slice[slice.length - 1].rowNum, count: entries.length },
            retryRows: slice.map((v) => v.row),
          });
        }
      } catch (err) {
        state.errors.push({
          label: "Chunk " + chunkIdx + "/" + totalChunks,
          msg: String(err),
          data: { firstRow: slice[0].rowNum, lastRow: slice[slice.length - 1].rowNum, count: entries.length },
          retryRows: slice.map((v) => v.row),
        });
      }
      state.processedCount += slice.length;
      renderProgress();
    }

    // 3. Done screen — message reminds the user that Push is async on EVA's side.
    const cancelled = state.cancelled;
    const headline = (cancelled ? "Cancelled. " : "Done. ") +
      "Submitted " + state.successCount + " of " + total +
      " prices in " + totalChunks + " chunk" + (totalChunks === 1 ? "" : "s") +
      " · " + state.errors.length + " error" + (state.errors.length === 1 ? "" : "s") +
      ". EVA is processing async — verify in the pricelist in a few minutes.";
    renderDoneStep(overlay, state, total, headline);
  };

  // -------- Create path (per-row, fallback for UI-created pricelists) --------
  const runCreateUpload = async (state, overlay, fallbackReason) => {
    const total = state.rows.length;
    const started = Date.now();
    const renderProgress = makeProgressRenderer(
      overlay, state, total, started,
      fallbackReason ? "Create mode (fallback)" : "Create mode"
    );

    for (let i = 0; i < total; i++) {
      if (state.cancelled) break;
      while (state.paused) {
        await new Promise((r) => setTimeout(r, 200));
        if (state.cancelled) break;
      }
      if (state.cancelled) break;

      const row = state.rows[i];
      const targetAdjId = findActiveAdjustmentId() || state.defaultAdjId;
      const built = buildAdjBody(row, targetAdjId);
      if (built.error) {
        state.errors.push({ rowNum: i + 2, msg: built.error, data: row, retryRows: [row] });
      } else {
        try {
          const res = await EB.evaApiCall(
            "CreatePriceListManualInputAdjustment",
            built.body,
            {
              "eva-ids-mode":   "Hybrid",
              "eva-user-agent": USER_AGENT,
            }
          );
          if (res && res.status >= 200 && res.status < 300) {
            state.successCount++;
          } else {
            state.errors.push({ rowNum: i + 2, msg: String(apiErrMsg(res)), data: row, retryRows: [row] });
          }
        } catch (err) {
          state.errors.push({ rowNum: i + 2, msg: String(err), data: row, retryRows: [row] });
        }
      }
      state.processedCount = i + 1;
      if (i < 100 || i % 10 === 0 || i === total - 1) renderProgress();
    }

    const cancelled = state.cancelled;
    const headline = (cancelled ? "Cancelled. " : "Done. ") +
      state.successCount + " of " + total + " uploaded · " +
      state.errors.length + " error" + (state.errors.length === 1 ? "" : "s") +
      (fallbackReason ? " · fell back to per-row Create (" + fallbackReason + ")" : "");
    renderDoneStep(overlay, state, total, headline);
  };

  // Orchestrator — picks Push or Create based on what the pricelist supports.
  const runUpload = async (state, overlay) => {
    const $ = (sel) => overlay.querySelector(sel);
    const progText = $(".eva-csv-progress-text");
    progText.textContent = "Resolving pricelist…";

    const plMatch = location.pathname.match(PRICELIST_PATH_RE);
    const pricelistId = plMatch ? plMatch[1] : null;
    const adjustmentInternalId = findActiveAdjustmentId() || state.defaultAdjId;

    let meta = null;
    let componentBackendID = null;
    if (pricelistId) meta = await fetchPricelistMeta(pricelistId);
    if (meta && adjustmentInternalId) {
      componentBackendID = await fetchAdjustmentBackendID(pricelistId, adjustmentInternalId);
    }

    if (meta && componentBackendID) {
      await runPushUpload(state, overlay, meta, componentBackendID);
    } else {
      const reason = !meta
        ? "pricelist has no BackendSystemID (UI-created?)"
        : "adjustment has no BackendID";
      await runCreateUpload(state, overlay, reason);
    }
  };

  // Keep our CSV button paired with EVA's xlsx button as the SPA re-renders.
  EB.onTick(ensurePriceCsvButtons);
})();
