/*
 * Control-room settings editor: on /control-room/settings/<id>/new (and the
 * edit pages), each setting row is [ selector | value textarea | trashcan ].
 * We shorten the value field a touch and dock a clipboard button between it
 * and the trashcan that copies "<SettingName> <value>" (or just the setting
 * name when no value has been entered yet).
 *
 * Row shape (harvested from the live DOM):
 *   div.flex.items-start.gap-4
 *     ├─ div.flex.w-full      selector — name lives in .truncate.text-start
 *     ├─ div.flex.w-full      value — a <textarea>
 *     └─ div.size-9.shrink-0  trashcan button (only present once a setting
 *                             is selected, so empty trailing rows are skipped)
 */
(() => {
  const EB = globalThis.__evaBuddy;
  if (!EB) return;

  const SETTINGS_PATH = /^\/control-room\/settings\//i;
  const MARK = "setting-copy";

  const COPY_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="9" y="9" width="11" height="11" rx="2"></rect>' +
    '<path d="M5 15V5a2 2 0 0 1 2-2h10"></path></svg>';
  const CHECK_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" ' +
    'stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg>';

  const isSizeNine = (el) => /\bsize-9\b/.test((el.className || "").toString());

  const valueColOf = (row) =>
    Array.from(row.children).find((c) => c.querySelector("textarea"));
  // Selector column = the one that's neither the value column nor a size-9 cell.
  const selectorColOf = (row, valueCol) =>
    Array.from(row.children).find((c) => c !== valueCol && !isSizeNine(c));

  const readSettingName = (row, valueCol) => {
    const selCol = selectorColOf(row, valueCol);
    if (!selCol) return "";
    const nameEl = selCol.querySelector(".truncate.text-start") || selCol;
    return (nameEl.textContent || "").trim();
  };

  const flashCopied = (btn) => {
    btn.classList.add("eva-copied");
    btn.innerHTML = CHECK_SVG;
    clearTimeout(btn._ebTimer);
    btn._ebTimer = setTimeout(() => {
      btn.classList.remove("eva-copied");
      btn.innerHTML = COPY_SVG;
    }, 1000);
  };

  const copyRow = (row, btn) => {
    const valueCol = valueColOf(row);
    const ta = valueCol && valueCol.querySelector("textarea");
    const name = readSettingName(row, valueCol);
    if (!name) return;
    const value = ta ? (ta.value || "").trim() : "";
    const text = value ? name + " " + value : name; // no value yet → just the name
    if (!navigator.clipboard || !navigator.clipboard.writeText) return;
    navigator.clipboard.writeText(text).then(() => flashCopied(btn), () => {});
  };

  const ensureSettingCopyButtons = () => {
    if (!SETTINGS_PATH.test(location.pathname)) return;
    document.querySelectorAll("div.flex.items-start.gap-4").forEach((row) => {
      if (!row.querySelector("textarea")) return;
      if (row.querySelector('[data-eva-buddy="' + MARK + '"]')) return; // already docked
      const cols = Array.from(row.children);
      const valueCol = cols.find((c) => c.querySelector("textarea"));
      // EVA's trashcan column: a size-9 cell with an svg button, not ours.
      const trashCol = cols.find(
        (c) => isSizeNine(c) && !c.hasAttribute("data-eva-buddy") && c.querySelector("button svg")
      );
      if (!valueCol || !trashCol) return; // no trash ⇒ empty trailing row, skip

      const col = document.createElement("div");
      col.className = "size-9 shrink-0";
      col.setAttribute("data-eva-buddy", MARK);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "eva-setting-copy-btn";
      btn.title = "EVA Buddy: copy setting name + value to clipboard";
      btn.innerHTML = COPY_SVG;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        copyRow(row, btn);
      });
      col.appendChild(btn);
      row.insertBefore(col, trashCol);
      valueCol.classList.add("eva-setting-value-short");
    });
  };

  EB.onTick(ensureSettingCopyButtons);
})();
