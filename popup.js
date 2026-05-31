// -----------------------------------------------------------
// Theme: manual dark-mode toggle, persisted in localStorage.
// Runs synchronously (and independent of EVA detection) so the
// saved theme applies immediately with no flash.
// -----------------------------------------------------------
(() => {
  const THEME_KEY = "eva-buddy:popup-theme";   // popup's own appearance (instant, no flash)
  const SHARED_KEY = "eva-buddy:dark-mode";     // shared flag the EVA content script reads
  const toggle = document.getElementById("theme-toggle");
  const apply = (dark) => {
    document.body.classList.toggle("eva-dark", dark);
    if (toggle) toggle.textContent = dark ? "☀️" : "🌙";
  };
  let dark = false;
  try { dark = localStorage.getItem(THEME_KEY) === "dark"; } catch (_) {}
  apply(dark);
  if (toggle) {
    toggle.addEventListener("click", () => {
      dark = !document.body.classList.contains("eva-dark");
      apply(dark);
      try { localStorage.setItem(THEME_KEY, dark ? "dark" : "light"); } catch (_) {}
      // Drive EVA's page dark mode too (content script listens for this key).
      try { chrome.storage.local.set({ [SHARED_KEY]: dark }); } catch (_) {}
    });
  }
})();

(async () => {
  const ENVS = {
    test: { color: "#16a34a", label: "TEST" },
    acc:  { color: "#f97316", label: "ACCEPTANCE" },
    prod: { color: "#dc2626", label: "PRODUCTION" }
  };

  const content      = document.getElementById("content");
  const qrFrame      = document.getElementById("qr-frame");
  const qrEl         = document.getElementById("qr");
  const titleEnvEl   = document.getElementById("qr-title-env");
  const switcherEl   = document.getElementById("env-switcher");
  const jumperEl     = document.getElementById("page-jump");
  const beyondBtnEl  = document.getElementById("beyond-toggle");
  const buildChipEl  = document.getElementById("build-chip");
  const notEvaEl     = document.getElementById("not-eva");

  const showNotEva = () => {
    content.hidden = true;
    notEvaEl.hidden = false;
  };

  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    showNotEva();
    return;
  }
  if (!tab || !tab.url) { showNotEva(); return; }

  let host;
  try { host = new URL(tab.url).hostname; }
  catch { showNotEva(); return; }

  const isBeyond = /^beyond--/i.test(host);
  // Strip beyond-- prefix so we resolve to the same API host
  host = host.replace(/^beyond--/i, "");

  // Expect <region>.<client>.<env>.eva-online.cloud
  const m = host.match(/^([^.]+)\.([^.]+)\.(test|acc|prod)\.eva-online\.cloud$/i);
  if (!m) { showNotEva(); return; }

  const region     = m[1];
  const client     = m[2];
  const currentEnv = m[3].toLowerCase();

  content.hidden = false;

  const renderQr = (env) => {
    const { color, label } = ENVS[env];
    const apiUrl = `https://api.${region}.${client}.${env}.eva-online.cloud`;
    // EVA's scanner expects the QR payload to be `CONFIGURE:EVA:<percent-encoded-url>`
    // so it recognizes it as an environment-config QR and parses the URL cleanly.
    const qrPayload = `CONFIGURE:EVA:${encodeURIComponent(apiUrl)}`;
    content.style.setProperty("--env-color", color);
    qrEl.innerHTML = window.EvaQr.toSvg(qrPayload, { ecc: 1, border: 2 });
    titleEnvEl.textContent = label;
    switcherEl.querySelectorAll("button[data-env]").forEach((b) => {
      b.classList.toggle("active", b.dataset.env === env);
    });
  };

  switcherEl.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-env]");
    if (!btn) return;
    renderQr(btn.dataset.env);
  });

  renderQr(currentEnv);

  // -----------------------------------------------------------
  // Page-jump: open the same path in another env / toggle Beyond
  // -----------------------------------------------------------
  jumperEl.querySelectorAll("button[data-jump-env]").forEach((b) => {
    b.classList.toggle("current", b.dataset.jumpEnv === currentEnv);
  });
  beyondBtnEl.classList.toggle("beyond-on", isBeyond);

  const navigateTab = (newUrl, { newTab = false } = {}) => {
    if (newTab) {
      chrome.tabs.create({ url: newUrl });
    } else {
      chrome.tabs.update(tab.id, { url: newUrl });
    }
    window.close();
  };

  jumperEl.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-jump-env]");
    if (!btn || btn.classList.contains("current")) return;
    const u = new URL(tab.url);
    u.hostname = u.hostname.replace(
      /\.(test|acc|prod)\.eva-online\.cloud$/i,
      `.${btn.dataset.jumpEnv}.eva-online.cloud`
    );
    navigateTab(u.toString(), { newTab: true });
  });

  beyondBtnEl.addEventListener("click", () => {
    const u = new URL(tab.url);
    u.hostname = /^beyond--/i.test(u.hostname)
      ? u.hostname.replace(/^beyond--/i, "")
      : "beyond--" + u.hostname;
    navigateTab(u.toString());
  });

  // -----------------------------------------------------------
  // Find product by Backend ID → open its product page
  // -----------------------------------------------------------
  const lookupInput = document.getElementById("product-backend-id");
  const lookupMsg = document.getElementById("product-lookup-msg");
  const showLookupMsg = (text) => {
    lookupMsg.textContent = text;
    lookupMsg.hidden = !text;
  };
  const openResponseViewer = (viewerId) => {
    if (!viewerId) return false;
    chrome.tabs.create({ url: chrome.runtime.getURL("viewer.html") + "#" + viewerId });
    return true;
  };
  if (lookupInput) {
    lookupInput.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const backendId = lookupInput.value.trim();
      if (!backendId) return;
      const debug = e.shiftKey; // Shift+Enter → always show the raw response
      showLookupMsg("");
      lookupInput.disabled = true;
      chrome.tabs.sendMessage(tab.id, { type: "lookupProductByBackendId", backendId }, (resp) => {
        lookupInput.disabled = false;
        if (chrome.runtime.lastError || !resp) {
          showLookupMsg("Couldn't reach the page — reload the EVA tab and retry.");
          return;
        }
        if (debug) {
          if (openResponseViewer(resp.viewerId)) window.close();
          else showLookupMsg(resp.error || "No response to show.");
          return;
        }
        if (resp.ok) {
          chrome.tabs.create({ url: resp.origin + "/pim/products/products-overview/" + resp.productId });
          window.close();
        } else {
          // Surface the error inline and open the raw response so it can be inspected.
          showLookupMsg(resp.error || "Product not found.");
          openResponseViewer(resp.viewerId);
        }
      });
    });
  }

  // -----------------------------------------------------------
  // Build chip: ask the content script for /build.json
  // -----------------------------------------------------------
  chrome.tabs.sendMessage(tab.id, { type: "getBuildJson" }, (resp) => {
    if (chrome.runtime.lastError) return;
    if (!resp || !resp.ok || !resp.data || !resp.data.version) return;
    buildChipEl.textContent = "v" + resp.data.version;
    const meta = [resp.data.branch, resp.data.commit && resp.data.commit.slice(0, 7)]
      .filter(Boolean)
      .join(" · ");
    if (meta) buildChipEl.title = meta;
    buildChipEl.hidden = false;
  });
})();
