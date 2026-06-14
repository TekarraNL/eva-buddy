/*
 * Consumer general-info: inject Backend ID as a new row.
 * GetUser returns the field but EVA's UI doesn't surface it.
 */
(() => {
  const EB = globalThis.__evaBuddy;
  if (!EB) return;
  const escapeHtml = EBPure.escapeHtml;

  const CONSUMER_GI_PATH = /^\/people\/consumers\/(\d+)\/general-info(\/|$|\?)/i;
  const BACKEND_ID_KEYS = ["BackendID", "backend_id", "backendId", "BackendId"];
  const USER_ID_KEYS = ["ID", "id", "UserID", "user_id", "userId"];

  function findUserBackendId(data, userId) {
    const seen = new WeakSet();
    let fallback = null;
    const walk = (node, depth) => {
      if (!node || typeof node !== "object" || depth > 6 || seen.has(node)) return null;
      seen.add(node);
      if (!Array.isArray(node)) {
        const beKey = BACKEND_ID_KEYS.find((k) => node[k] != null);
        if (beKey) {
          // Prefer the object whose ID matches the URL's consumer ID.
          const idKey = USER_ID_KEYS.find((k) => node[k] != null);
          if (idKey && String(node[idKey]) === userId) return node[beKey];
          if (fallback == null) fallback = node[beKey];
        }
      }
      const keys = Array.isArray(node) ? node.map((_, i) => i) : Object.keys(node);
      for (const k of keys) {
        const r = walk(node[k], depth + 1);
        if (r != null) return r;
      }
      return null;
    };
    const matched = walk(data, 0);
    return matched != null ? matched : fallback;
  }

  function getBackendIdFromCaptures(userId) {
    for (const cap of EB.captures) {
      if (!cap || !cap.data) continue;
      const ep = (cap.endpoint || "").toLowerCase();
      if (!ep.includes("getuser")) continue;
      const val = findUserBackendId(cap.data, userId);
      if (val != null) return String(val);
    }
    return null;
  }

  function maybeInjectBackendIdRow() {
    const m = location.pathname.match(CONSUMER_GI_PATH);
    if (!m) return;
    const userId = m[1];

    // Find the General information rows list inside the card.
    const heading = Array.from(document.querySelectorAll("h2")).find(
      (h) => /general information/i.test((h.textContent || "").trim())
    );
    if (!heading) return;
    const card = heading.closest('[class*="rounded-lg"]') || heading.parentElement;
    if (!card) return;
    const list = Array.from(card.querySelectorAll("div")).find(
      (d) => d.className === "flex flex-col gap-5 w-full"
    );
    if (!list) return;
    if (list.querySelector('[data-eva-buddy="backend-id-row"]')) return;

    const value = getBackendIdFromCaptures(userId);
    if (value == null) return;

    const row = document.createElement("div");
    row.className = "sm:grid sm:grid-cols-3 sm:gap-5 leading-none box-border";
    row.setAttribute("data-eva-buddy", "backend-id-row");
    row.innerHTML =
      '<div class="font-semibold text-wrap break-words box-border">' +
        '<span class="text-primary text-base font-semibold">Backend ID</span>' +
      "</div>" +
      '<div class="sm:col-span-2 box-border">' +
        '<span class="text-primary text-base">' + escapeHtml(value) + "</span>" +
      "</div>";
    list.appendChild(row);
  }

  EB.onTick(maybeInjectBackendIdRow);
  // Inject as soon as GetUser data lands — don't wait for the next tick.
  EB.onCapture(() => { try { maybeInjectBackendIdRow(); } catch (_) {} });
})();
