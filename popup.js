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
