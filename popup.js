(async () => {
  const ENVS = {
    test: { color: "#16a34a" },
    acc:  { color: "#f97316" },
    prod: { color: "#dc2626" }
  };

  const content    = document.getElementById("content");
  const qrFrame    = document.getElementById("qr-frame");
  const qrEl       = document.getElementById("qr");
  const switcherEl = document.getElementById("env-switcher");
  const notEvaEl   = document.getElementById("not-eva");

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
    const color  = ENVS[env].color;
    const apiUrl = `https://api.${region}.${client}.${env}.eva-online.cloud`;
    qrFrame.style.setProperty("--env-color", color);
    qrEl.innerHTML = window.EvaQr.toSvg(apiUrl, { ecc: 1, border: 2 });
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
})();
