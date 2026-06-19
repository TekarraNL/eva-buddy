/*
 * Roles & rights → compare a role's permissions across environments.
 *
 * Each environment's role page can only be read by a tab *in* that environment
 * (auth is per-origin), so this works by every roles page stashing its own
 * functionality matrix into chrome.storage.local keyed by the role's Code
 * (stable across environments — the URL's numeric id is not). When you compare,
 * we read the other environment's stashed matrix and float a small badge onto
 * each cell that differs, showing the OTHER environment's value in its state
 * colour. EVA's native dropdowns are left untouched and still editable.
 *
 * Off semantics match the filter: '', '-', and 'Off' all normalise to off, so
 * dash-vs-Off is "same"; On / Elevated / Verification are distinct states.
 * The Categories column is informational and excluded, like in the filter.
 */
(() => {
  const EB = globalThis.__evaBuddy;
  if (!EB) return;
  const escapeHtml = EBPure.escapeHtml;

  const PATH = /^\/people\/roles-rights\/\d+\/general-information/i;
  const OFF = new Set(["", "-", "Off"]);
  const STORAGE_PREFIX = "eva-buddy:rolescope:";
  // The four permission states and their colours (sampled from EVA's own UI).
  const STATE_COLORS = { Off: "#B4B2A9", On: "#639922", Elevated: "#EF9F27", Verification: "#7F77DD" };
  const ENV_COLORS = { test: "#16a34a", acc: "#f97316", prod: "#dc2626" };

  // -----------------------------------------------------------
  // Table + extraction
  // -----------------------------------------------------------
  const findTable = () => {
    const tables = Array.from(document.querySelectorAll("table"));
    return tables.find((t) => {
      const h = (t.tHead && t.tHead.textContent) || "";
      return /Manage/.test(h) && /Scripting/.test(h);
    }) || null;
  };

  const columnHeaders = (table) => {
    const hr = table.tHead && table.tHead.rows[table.tHead.rows.length - 1];
    return hr ? Array.from(hr.cells).map((c) => (c.textContent || "").replace(/\s+/g, " ").trim()) : [];
  };

  // Actionable permission columns = everything between name (0) and the
  // looking-glass icon (last), minus the informational Categories column.
  const actionableCols = (headers) => {
    const catIdx = headers.findIndex((h) => h.toLowerCase() === "categories");
    const cols = [];
    for (let i = 1; i < headers.length - 1; i++) {
      if (i === catIdx) continue;
      cols.push(i);
    }
    return cols;
  };

  const funcName = (row) => {
    const fc = row.children[0] && row.children[0].querySelector(".flex.flex-col");
    return fc && fc.children[0] ? (fc.children[0].textContent || "").trim() : "";
  };
  const cellValue = (cell) => (cell.textContent || "").replace(/\s+/g, " ").trim();
  const normState = (v) => (OFF.has(v) ? "Off" : v);

  const readMatrix = (table) => {
    const headers = columnHeaders(table);
    const cols = actionableCols(headers);
    const matrix = {};
    if (!table.tBodies[0]) return { headers, matrix };
    Array.from(table.tBodies[0].rows).forEach((r) => {
      const name = funcName(r);
      if (!name) return;
      const rec = {};
      cols.forEach((i) => { rec[headers[i]] = cellValue(r.children[i]); });
      matrix[name] = rec;
    });
    return { headers, matrix };
  };

  // Role identity from the General details card. Code is the cross-env key.
  const labelValue = (label) => {
    const lab = Array.from(document.querySelectorAll("*")).find(
      (e) => e.children.length === 0 && (e.textContent || "").trim() === label
    );
    if (!lab) return null;
    let p = lab;
    for (let i = 0; i < 6 && p; i++) {
      const s = p.nextElementSibling;
      if (s && (s.textContent || "").trim()) return (s.textContent || "").trim();
      p = p.parentElement;
    }
    return null;
  };
  const roleCode = () => labelValue("Code");
  const roleName = () => (document.title || "").split("|")[0].trim() || labelValue("Name") || "";

  // -----------------------------------------------------------
  // Stash this environment's matrix (merged, so it accumulates across the
  // table's pages). Throttled + change-gated so we're not writing every tick.
  // -----------------------------------------------------------
  let lastStashSig = "";
  const stashMatrix = (table) => {
    const code = roleCode();
    if (!code) return;
    const { headers, matrix } = readMatrix(table);
    const names = Object.keys(matrix);
    if (!names.length) return;
    const sig = code + "|" + names.length + "|" + JSON.stringify(matrix).length;
    if (sig === lastStashSig) return;
    lastStashSig = sig;
    const key = STORAGE_PREFIX + code;
    try {
      chrome.storage.local.get(key).then((got) => {
        const cur = (got && got[key]) || {};
        const envData = cur[EB.env.key] || { matrix: {} };
        Object.assign(envData.matrix, matrix); // accumulate across pages
        envData.role = roleName();
        envData.roleId = roleIdFromUrl(location.pathname) || envData.roleId || null;
        envData.columns = headers;
        envData.ts = Date.now();
        cur[EB.env.key] = envData;
        chrome.storage.local.set({ [key]: cur });
      });
    } catch (_) {}
  };

  // -----------------------------------------------------------
  // Capture all pages. EVA caps the list at 100 rows/page and paginates via
  // its own Next/Previous buttons (the URL `start` param does NOT repaginate
  // this list). So we drive those buttons: raise rows-per-page to 100, walk
  // page by page merging each, then return to page 1. Pure DOM, exact labels.
  // -----------------------------------------------------------
  // Parse "1 – 100 of 420" → { from, to, total } from the table footer.
  const parseRange = () => {
    const txt = (document.body.innerText || "");
    const m = txt.match(/(\d[\d.,]*)\s*[–-]\s*(\d[\d.,]*)\s+of\s+(\d[\d.,]*)/);
    if (!m) return null;
    const num = (s) => parseInt(String(s).replace(/[.,\s]/g, ""), 10);
    return { from: num(m[1]), to: num(m[2]), total: num(m[3]) };
  };
  const byAria = (label) =>
    Array.from(document.querySelectorAll("button[aria-label]")).find(
      (b) => (b.getAttribute("aria-label") || "").toLowerCase() === label
    );
  const nextBtn = () => byAria("next page");
  const prevBtn = () => byAria("previous page");
  const rppBtn = () => byAria("rows per page");
  const btnDisabled = (b) => !b || b.disabled || b.getAttribute("aria-disabled") === "true";
  // Signature of the current page = the first row's name. Keyed on row CONTENT,
  // not the "from" counter — the counter updates a beat before the rows
  // re-render, which would let us read the previous page's rows as a duplicate.
  const pageSig = () => {
    const t = findTable();
    return t && t.tBodies[0] && t.tBodies[0].rows[0] ? funcName(t.tBodies[0].rows[0]) : "";
  };
  // Wait until the page signature changed from `beforeSig` and the row count
  // has settled (so the new page has finished rendering).
  const waitForPageChange = (beforeSig) =>
    new Promise((resolve) => {
      let tries = 0, last = -1, stable = 0;
      const iv = setInterval(() => {
        tries++;
        const t = findTable();
        const rc = t && t.tBodies[0] ? t.tBodies[0].rows.length : 0;
        if (rc === last) stable++; else { stable = 0; last = rc; }
        if ((pageSig() !== beforeSig && rc > 0 && stable >= 2) || tries > 60) {
          clearInterval(iv);
          resolve();
        }
      }, 100);
    });
  const clickAndWait = async (btn) => {
    if (btnDisabled(btn)) return false;
    const sig = pageSig();
    btn.click();
    await waitForPageChange(sig);
    return true;
  };
  const gotoFirstPage = async () => {
    let g = 0;
    while (!btnDisabled(prevBtn()) && g++ < 120) {
      if (!(await clickAndWait(prevBtn()))) break;
    }
  };
  // Raise the "rows per page" control to 100 (user asked). Best-effort: the
  // walk works at any page size, this just means fewer pages.
  const setRowsPerPage100 = async () => {
    const b = rppBtn();
    if (!b || (b.textContent || "").trim() === "100") return;
    const sig = pageSig();
    b.click();
    await new Promise((r) => setTimeout(r, 200));
    const isVis = (e) => e.offsetParent !== null;
    const opt = Array.from(document.querySelectorAll('[role="option"], li, button, div, span')).find(
      (e) => e.children.length === 0 && (e.textContent || "").trim() === "100" && e !== b && isVis(e)
    );
    if (opt) { opt.click(); await waitForPageChange(sig); }
    else { try { document.body.click(); } catch (_) {} }
  };

  const stashFull = (code, full) =>
    new Promise((resolve) => {
      const key = STORAGE_PREFIX + code;
      try {
        chrome.storage.local.get(key).then((got) => {
          const cur = (got && got[key]) || {};
          const envData = cur[EB.env.key] || { matrix: {} };
          Object.assign(envData.matrix, full);
          envData.role = roleName();
          envData.roleId = roleIdFromUrl(location.pathname) || envData.roleId || null;
          const t = findTable();
          if (t) envData.columns = columnHeaders(t);
          envData.ts = Date.now();
          cur[EB.env.key] = envData;
          chrome.storage.local.set({ [key]: cur }).then(resolve, resolve);
        });
      } catch (_) { resolve(); }
    });

  const captureAllPages = async (onProgress) => {
    const code = roleCode();
    if (!code) return { ok: false, error: "no-code" };
    await gotoFirstPage();
    await setRowsPerPage100(); // user asked to raise the page size
    await gotoFirstPage();     // resizing can land off page 1
    const total = (parseRange() || {}).total || 0;
    const full = {};
    let guard = 0;
    while (guard++ < 120) {
      const t = findTable();
      if (t) Object.assign(full, readMatrix(t).matrix);
      const got = Object.keys(full).length;
      if (onProgress) onProgress(total ? Math.min(got, total) : got, total);
      if (btnDisabled(nextBtn())) break;          // no next page → done
      if (!(await clickAndWait(nextBtn()))) break; // didn't advance → stop
    }
    await stashFull(code, full);
    await gotoFirstPage(); // leave the user back on page 1
    return { ok: true, count: Object.keys(full).length, total: total || Object.keys(full).length };
  };

  // -----------------------------------------------------------
  // Compare state + overlay rendering
  // -----------------------------------------------------------
  const compare = { active: false, otherEnv: null, otherMatrix: null, otherRole: null, onlyDiff: true, diffCount: 0 };

  const clearOverlays = () => {
    document.querySelectorAll(".eva-cmp-badge").forEach((e) => e.remove());
    document.querySelectorAll(".eva-cmp-diff").forEach((e) => e.classList.remove("eva-cmp-diff"));
    document.querySelectorAll(".eva-cmp-hidden").forEach((e) => {
      e.classList.remove("eva-cmp-hidden");
      e.style.display = "";
    });
  };

  const renderOverlays = (table) => {
    clearOverlays();
    if (!compare.active || !compare.otherMatrix || !table.tBodies[0]) return;
    const headers = columnHeaders(table);
    const cols = actionableCols(headers);
    let differingRows = 0;
    Array.from(table.tBodies[0].rows).forEach((r) => {
      const name = funcName(r);
      const other = compare.otherMatrix[name];
      let rowDiffers = false;
      cols.forEach((i) => {
        const cell = r.children[i];
        if (!cell) return;
        const mine = normState(cellValue(cell));
        const theirsRaw = other ? other[headers[i]] : undefined;
        if (theirsRaw === undefined) return; // not captured for this col on the other env
        const theirs = normState(theirsRaw);
        if (mine === theirs) return;
        rowDiffers = true;
        cell.classList.add("eva-cmp-diff");
        cell.style.position = "relative";
        const badge = document.createElement("span");
        badge.className = "eva-cmp-badge";
        badge.style.borderLeftColor = ENV_COLORS[compare.otherEnv] || "#dc2626";
        badge.innerHTML =
          '<span class="eva-cmp-sq" style="background:' + (STATE_COLORS[theirs] || "#B4B2A9") + '"></span>' +
          escapeHtml(theirs);
        cell.appendChild(badge);
      });
      if (rowDiffers) differingRows++;
      if (compare.onlyDiff && !rowDiffers) {
        r.classList.add("eva-cmp-hidden");
        r.style.display = "none";
      }
    });
    compare.diffCount = differingRows;
    updateToolbar();
  };

  const dot = (env) =>
    '<span class="eva-cmp-dot" style="background:' + (ENV_COLORS[env] || "#888") + '"></span>';

  // -----------------------------------------------------------
  // Shared EVA Buddy toolbar above the table. Branded so it reads as ours
  // (not EVA), it holds the filter + compare buttons (roles-rights.js adds
  // its filter button to the same .eva-eb-tools), and hosts the compare
  // controls in .eva-eb-compare while a comparison is active.
  // -----------------------------------------------------------
  const TOOLBAR_ID = "eva-eb-roles-toolbar";
  EB.ensureRolesToolbar = (table) => {
    let bar = document.getElementById(TOOLBAR_ID);
    if (bar && document.contains(bar)) return bar;
    bar = document.createElement("div");
    bar.id = TOOLBAR_ID;
    bar.innerHTML =
      '<span class="eva-eb-brand">EVA Buddy</span>' +
      '<div class="eva-eb-tools"></div>' +
      '<div class="eva-eb-compare" hidden></div>';
    table.parentElement.insertBefore(bar, table);
    return bar;
  };

  const updateToolbar = () => {
    const bar = document.getElementById(TOOLBAR_ID);
    if (!bar) return;
    const cnt = bar.querySelector(".eva-cmp-count");
    if (cnt) cnt.textContent = compare.diffCount + " differ";
    const od = bar.querySelector(".eva-cmp-onlydiff");
    if (od) od.classList.toggle("on", compare.onlyDiff);
  };

  const buildCompareBar = (table) => {
    const bar = EB.ensureRolesToolbar(table);
    const tools = bar.querySelector(".eva-eb-tools");
    const cmp = bar.querySelector(".eva-eb-compare");
    if (tools) tools.hidden = true; // compare controls take over the bar
    if (!cmp) return;
    cmp.hidden = false;
    const sig = EB.env.key + ">" + compare.otherEnv;
    if (cmp.dataset.pair !== sig) {
      cmp.dataset.pair = sig;
      cmp.innerHTML =
        '<span class="eva-cmp-pair">' + dot(EB.env.key) + EB.env.key +
          ' <span class="eva-cmp-arrow">⇄</span> ' + dot(compare.otherEnv) + compare.otherEnv +
          '<span class="eva-cmp-role"> · ' + escapeHtml(compare.otherRole || "") + "</span></span>" +
        '<span class="eva-cmp-count">0 differ</span>' +
        '<button type="button" class="eva-cmp-onlydiff on">Only differences</button>' +
        '<button type="button" class="eva-cmp-exit">Exit compare</button>';
      cmp.querySelector(".eva-cmp-onlydiff").addEventListener("click", () => {
        compare.onlyDiff = !compare.onlyDiff;
        renderOverlays(findTable());
      });
      cmp.querySelector(".eva-cmp-exit").addEventListener("click", exitCompare);
    }
    updateToolbar();
  };

  const exitCompare = () => {
    compare.active = false;
    compare.otherMatrix = null;
    EB._cmpActive = false; // let roles-rights.js resume its own filter
    clearOverlays();
    const bar = document.getElementById(TOOLBAR_ID);
    if (bar) {
      const cmp = bar.querySelector(".eva-eb-compare");
      const tools = bar.querySelector(".eva-eb-tools");
      if (cmp) { cmp.hidden = true; cmp.dataset.pair = ""; cmp.innerHTML = ""; }
      if (tools) tools.hidden = false;
    }
  };

  // -----------------------------------------------------------
  // Setup dialog
  // -----------------------------------------------------------
  const envFromUrl = (url) => {
    try {
      const h = new URL(url.trim()).hostname;
      if (/\.test\./i.test(h)) return "test";
      if (/\.acc\./i.test(h)) return "acc";
      if (/\.prod\./i.test(h)) return "prod";
    } catch (_) {}
    return null;
  };
  const roleIdFromUrl = (url) => {
    const m = String(url).match(/roles-rights\/(\d+)/);
    return m ? m[1] : null;
  };

  const readStored = (code, env) =>
    new Promise((resolve) => {
      try {
        chrome.storage.local.get(STORAGE_PREFIX + code).then((got) => {
          const cur = (got && got[STORAGE_PREFIX + code]) || {};
          resolve(cur[env] || null);
        });
      } catch (_) { resolve(null); }
    });

  // Everything stashed by any env/tab — used to diagnose a failed lookup.
  const readAllScopes = () =>
    new Promise((resolve) => {
      try {
        chrome.storage.local.get(null).then((all) => {
          const rows = [];
          Object.keys(all || {}).forEach((k) => {
            if (k.indexOf(STORAGE_PREFIX) !== 0) return;
            const code = k.slice(STORAGE_PREFIX.length);
            const v = all[k] || {};
            Object.keys(v).forEach((env) => {
              const m = v[env] && v[env].matrix;
              if (m && Object.keys(m).length) {
                rows.push({ code, env, role: v[env].role || "", roleId: v[env].roleId || null, count: Object.keys(m).length });
              }
            });
          });
          resolve(rows);
        });
      } catch (_) { resolve([]); }
    });

  const openDialog = () => {
    const old = document.getElementById("eva-cmp-modal");
    if (old) old.remove();
    const code = roleCode();
    const table = findTable();
    const myCount = table ? Object.keys(readMatrix(table).matrix).length : 0;

    const overlay = document.createElement("div");
    overlay.id = "eva-cmp-modal";
    overlay.innerHTML =
      '<div class="eva-cmp-card">' +
        '<header class="eva-cmp-head">' +
          "<strong>Compare role across environments</strong>" +
          '<button type="button" class="eva-cmp-close" aria-label="Close">×</button>' +
        "</header>" +
        '<div class="eva-cmp-body">' +
          '<p class="eva-cmp-intro">Shows where this role\'s permissions differ from another environment. You must be signed in to <strong>both</strong>, and roles are matched by their <strong>Code</strong> — so use the exact same role on each.</p>' +
          '<ol class="eva-cmp-steps">' +
            "<li><strong>On the other environment</strong> (a separate tab): open this same role, click the compare button, and press <em>Capture all</em> there. EVA only shows 100 rows per page, so this reads every page — let it finish.</li>" +
            "<li><strong>Here:</strong> press <em>Capture all</em> below to read this side too.</li>" +
            "<li>Paste the other environment's role URL into the box, then click <em>Compare</em>. Differences appear right in the table.</li>" +
          "</ol>" +
          '<div class="eva-cmp-sidelabel">This side</div>' +
          '<div class="eva-cmp-side">' + dot(EB.env.key) +
            "<strong>" + EB.env.key + "</strong>" +
            '<span class="eva-cmp-muted">' + escapeHtml(roleName()) + " · " + escapeHtml(code || "no code") + "</span>" +
            '<span class="eva-cmp-ok eva-cmp-thiscount">…</span>' +
            '<button type="button" class="eva-cmp-captureall">Capture all</button>' +
          "</div>" +
          '<div class="eva-cmp-sidelabel">Compare against</div>' +
          '<input type="text" class="eva-cmp-url" placeholder="Paste the role’s URL from the other environment" autocomplete="off" />' +
          '<div class="eva-cmp-status"></div>' +
          '<div class="eva-cmp-actions">' +
            '<button type="button" class="eva-cmp-cancel">Cancel</button>' +
            '<button type="button" class="eva-cmp-go" disabled>Compare</button>' +
          "</div>" +
        "</div>" +
      "</div>";
    document.body.appendChild(overlay);

    const $ = (s) => overlay.querySelector(s);
    const statusEl = $(".eva-cmp-status");
    const goBtn = $(".eva-cmp-go");
    let resolved = null; // { env, data }

    const close = () => overlay.remove();
    $(".eva-cmp-close").addEventListener("click", close);
    $(".eva-cmp-cancel").addEventListener("click", close);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

    // This-side completeness + "Capture all" walker.
    const thisCount = $(".eva-cmp-thiscount");
    const capBtn = $(".eva-cmp-captureall");
    const refreshThis = async () => {
      const total = (parseRange() || {}).total;
      const stored = code ? await readStored(code, EB.env.key) : null;
      const have = stored && stored.matrix ? Object.keys(stored.matrix).length : myCount;
      thisCount.textContent = total ? have + " of " + total : have + " loaded";
      capBtn.style.display = total && have >= total ? "none" : "";
    };
    refreshThis();
    capBtn.addEventListener("click", async () => {
      capBtn.disabled = true;
      try {
        await captureAllPages((done, tot) => { capBtn.textContent = "Capturing… " + done + (tot ? "/" + tot : ""); });
      } catch (_) {}
      capBtn.textContent = "Capture all";
      capBtn.disabled = false;
      await refreshThis();
    });

    const evaluate = async () => {
      resolved = null;
      goBtn.disabled = true;
      const url = $(".eva-cmp-url").value;
      if (!url.trim()) {
        statusEl.textContent = "Paste the other environment's role URL above to continue.";
        statusEl.className = "eva-cmp-status";
        return;
      }
      const env = envFromUrl(url);
      if (!env) { statusEl.textContent = "Not an EVA URL."; statusEl.className = "eva-cmp-status err"; return; }
      if (env === EB.env.key) { statusEl.textContent = "That's the same environment you're on."; statusEl.className = "eva-cmp-status err"; return; }
      if (!code) { statusEl.textContent = "Couldn't read this role's Code."; statusEl.className = "eva-cmp-status err"; return; }
      let data = await readStored(code, env);
      let mismatch = false;
      let candidateCode = code;
      if (!data || !data.matrix || !Object.keys(data.matrix).length) {
        // Exact Code match failed. The same role often has a DIFFERENT Code
        // per environment, so don't block — find this env's captured entry by
        // the pasted URL's role id, then by role name, then a lone entry. The
        // diff itself is by functionality name, so codes needn't match.
        const all = await readAllScopes();
        const envEntries = all.filter((r) => r.env === env && r.count > 0);
        if (envEntries.length === 0) {
          statusEl.innerHTML = dot(env) + "Nothing captured on <strong>" + env +
            "</strong> yet. On a separate " + env + " tab (signed in), open this role and click " +
            "<em>Capture all</em>, then come back.";
          statusEl.className = "eva-cmp-status warn";
          return;
        }
        const pastedId = roleIdFromUrl(url);
        const pick =
          (pastedId && envEntries.find((r) => r.roleId && String(r.roleId) === String(pastedId))) ||
          envEntries.find((r) => (r.role || "").toLowerCase() === (roleName() || "").toLowerCase()) ||
          envEntries[0];
        data = await readStored(pick.code, env);
        candidateCode = pick.code;
        mismatch = true;
      }
      if (!data || !data.matrix) {
        statusEl.textContent = "Couldn't load the other environment's data.";
        statusEl.className = "eva-cmp-status err";
        return;
      }
      resolved = { env, data };
      const n = Object.keys(data.matrix).length;
      if (mismatch) {
        statusEl.innerHTML = dot(env) + "<strong>" + env + "</strong> · " + escapeHtml(data.role || "") +
          " · " + escapeHtml(candidateCode) + " (" + n + "). Code differs from <strong>" +
          escapeHtml(code) + "</strong> — comparing by functionality name.";
        statusEl.className = "eva-cmp-status warn";
      } else {
        statusEl.innerHTML = dot(env) + "<strong>" + env + "</strong> · " +
          escapeHtml(data.role || "") + " · " + n + " captured";
        statusEl.className = "eva-cmp-status ok";
      }
      goBtn.disabled = false;
    };

    $(".eva-cmp-url").addEventListener("input", evaluate);
    evaluate(); // show the initial hint
    goBtn.addEventListener("click", () => {
      if (!resolved) return;
      compare.active = true;
      compare.otherEnv = resolved.env;
      compare.otherMatrix = resolved.data.matrix;
      compare.otherRole = resolved.data.role || "";
      compare.onlyDiff = true;
      EB._cmpActive = true;
      close();
      const t = findTable();
      if (t) { buildCompareBar(t); renderOverlays(t); }
    });
  };

  // -----------------------------------------------------------
  // Compare button — lives in the shared EVA Buddy toolbar.
  // -----------------------------------------------------------
  const SWAP_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M3 8h13l-3-3"></path><path d="M21 16H8l3 3"></path></svg>';

  const ensureCompareButton = (table) => {
    const bar = EB.ensureRolesToolbar(table);
    const tools = bar.querySelector(".eva-eb-tools");
    if (!tools || tools.querySelector(".eva-cmp-btn")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "eva-cmp-btn";
    btn.title = "EVA Buddy: compare this role across environments";
    btn.innerHTML = SWAP_SVG;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openDialog();
    });
    tools.appendChild(btn);
  };

  // -----------------------------------------------------------
  // Tick
  // -----------------------------------------------------------
  let stashCounter = 0;
  const tick = () => {
    if (!PATH.test(location.pathname)) {
      if (compare.active) exitCompare();
      lastStashSig = "";
      return;
    }
    const table = findTable();
    if (!table) return;
    ensureCompareButton(table);
    // Stash on a slower cadence than the 1s tick.
    if (stashCounter++ % 2 === 0) stashMatrix(table);
    if (compare.active) {
      buildCompareBar(table);
      renderOverlays(table);
    }
  };

  EB.onTick(tick);
})();
