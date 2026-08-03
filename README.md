# eva-buddy

Chrome extension that makes it impossible to mistake which EVA admin environment you're looking at — and throws in a few quality-of-life extras while it's there.
The extension doesn't need any extra permissions and just uses what's available in the json. 



## Features

- **Colored top stripe** — thin 12px bar at the top of every EVA page in the environment's color (🟢 test / 🟠 acceptance / 🔴 production). Hover for the full hostname.
- **Tinted favicon** — the EVA logo on a colored background, visible even in unfocused tabs.
- **🚀 title prefix** for `beyond--` URLs so the Beyond backend stands out.
- **Hover-to-QR** on product rows — hover any product row on the products overview, stock overview, or availability page and a QR of its EAN appears next to the cursor (decoded from the page's own `GetProducts` / `SearchProducts` API responses, no extra requests). Togglable from the popup.
- **Alt-click any numeric ID** anywhere in EVA to copy it to your clipboard, with a brief flash on the click.
- **Order list hover preview** — on the orders overview, hover any row to see a labeled tooltip with that order's columns (status, total, customer, dates, etc.) without opening it. Togglable from the popup.
- **Related orders tab highlighted on returns** — when an order has any return attached, the **Related orders** tab on the order detail page is filled with a red pill so you can see at a glance there's something to investigate. The extension auto-replays `GetReturnOrdersForOrder` using auth headers harvested from a real captured EVA call, so the highlight appears immediately on `/order-details` — you don't have to click into the Related orders tab first.
- **Backend ID on consumer pages** — on `/people/consumers/<id>/general-info`, a **Backend ID** row is appended to the General information section, pulled from the captured `GetUser` response (EVA returns this but doesn't display it).
- **Organizations status column** — on the organizations overview (`/organizations/organizations`), EVA Buddy appends a **Status** column to the table showing each store's status as the raw numeric value. EVA returns it in the `ListOrganizationUnitsDetailed` response (per-org `Status`) but doesn't surface it in the list; the column is matched to each row by org ID and stays in sync across pagination/filtering.
- **Settings copy button** — on the control-room settings editor (`/control-room/settings/<id>/new`), each setting row gets a clipboard button docked between the value field and the trashcan (and the value field is shortened a touch to make room). Clicking it copies `<SettingName> <value>` (e.g. `ShipFromStore:DeliverDeadline 4`) — or just the setting name if no value has been entered yet.
- **Roles & rights "hide off" filter** — on a role's general-information page (`/people/roles-rights/<id>/general-information`), EVA Buddy's toolbar above the Functionalities table carries a filter toggle. Click it to hide every functionality that's fully off — a row stays only if at least one *actionable* permission column (Manage, Create, Edit, View, Delete, Settings, Scripting) has a real value like `On`; `Off`, a dash, and empty all count as off. The **Categories** column is informational (it can show a scope such as `Financial` even when nothing is granted), so it's ignored. Click again to show all. Operates on the currently loaded page of functionalities.
- **Roles & rights role compare** — compare a role's permissions against **another role** — either the same role in a *different environment*, or a *different role* in the same one. On a role's general-information page, EVA Buddy adds its own toolbar above the Functionalities table (holding the filter + compare buttons) so it's clearly distinct from EVA's UI. The compare button opens a dialog: on each role you press **Capture all** (EVA caps the list at 100 rows/page, so this walks every page via EVA's own next-page control and reads the whole role), then paste the other role's URL and hit **Compare**. The differences are overlaid right on the table: EVA's own four-state dropdowns (Off / On / Elevated / Verification) stay untouched and editable, and each cell that differs gets a thin badge floated on top showing the *other* role's value in its state colour, plus a blue outline. The toolbar then shows both sides (env · role) with an **⇄**, a difference count, and an **only differences** toggle. Mechanics: each role's tab stashes its captured matrix into `chrome.storage.local` (the extension's own storage is shared across its tabs — auth never crosses origins); the compare target is identified by the **URL you paste** (its environment + role id), and the diff is matched by **functionality name**, so the two roles' Codes needn't relate. `Off`, a dash, and empty are treated alike; the Categories column is ignored. All data stays local.
- **Dashboard search → orders quick-jump** — on `/dashboard/search`, typing a number (order ID) or an email and pressing Enter routes you straight to `/orders/orders?query=<value>` instead of EVA's default page-search behavior. Other inputs pass through to EVA's normal search.
- **Module quick-switch** — click the module name/icon next to the EVA logo (top-left, which normally does nothing) to open a dropdown of all admin modules (Compliance, Control room, Financials, Orders, Organizations, People, PIM, Promotions, Stock, Tasks) with their real EVA icons, the current one highlighted. Works on every admin page. Icons are harvested live from EVA and cached, with a branded-color initial as the fallback until cached. The menu also includes **Web POS** (EVA's `/pos/` app, which has no dashboard tile) pointing at the current environment's POS, using a bundled logo.
- **Dark mode** — the 🌙 toggle in the popup darkens both the popup *and* the entire EVA admin UI. EVA has no native dark theme, so this is a "smart invert" of EVA's app root (soft `~#1a` surfaces, lightened borders for separation, images/brand colors re-inverted to stay correct). The colored env stripe and all of eva-buddy's own UI keep their true colors. The preference is shared via `chrome.storage.local` and applied before paint, so it persists and doesn't flash.
- **EVA Buddy filters (orders list)** — collapsible filter card injected just under EVA's own "Filters" heading on `/orders/orders`. A landing zone for extra filters that EVA's UI doesn't expose. Today it carries one tri-state — **Open balance: Customer owes / Refund owed / N/A** — which maps to `MinOpenAmountInTax: 0.01` / `MaxOpenAmountInTax: -0.01`. EVA's own sidebar can't set those fields, but the API accepts them. Mechanics: content script writes the chosen state to `localStorage`, the page-world hook clones the next `SearchOrders` `Request` object and rewrites its body before forwarding to fetch, and we nudge EVA's router by flipping the URL `start` param to refetch. State persists across reloads in `chrome.storage.local`. (Note: the refetch nudge causes one brief intermediate frame as the router transitions — both fetches carry the filter, so the steady state is correct.)
- **Price-list CSV bulk upload** — EXPERIMENTAL FEATURE - on a price-list page, whenever EVA's own upload button is visible on an adjustment, EVA Buddy docks a **CSV** button next to it. Pick a UTF-8 CSV with columns `BackendID, Price, EffectiveDate, ExpireDate`. SAP-pushed pricelists go through chunked `PushPriceList` calls (5000 rows per chunk, async server-side); UI-created pricelists fall back to one `CreatePriceListManualInputAdjustment` per row (with `EVA-IDs-Mode: Hybrid` so the BackendID is resolved server-side). The target adjustment is detected from the page's own `ListPriceListManualInputAdjustments` call, so any `ID` column in the CSV is ignored. EVA's own xlsx upload chokes past a few hundred rows; this handles 100k+. Live progress bar, errors collected per row (copyable), pause/cancel any time, and a **Retry failed rows** button on the done screen that re-runs just the failures.
- **Source Inspector (hover trace)** — EVA's admin is largely "headless": the screen is filled from JSON, but you never know which call/field. Hover any leaf text on a page for ~350 ms and a tooltip shows every captured response the value appears in, formatted as `EndpointName › path.to.field`. Long lists are scrollable; **press Shift to lock** the tooltip in place so you can scroll/select inside it (Esc or click-out to close). While locked, **click any row** to open that capture in the JSON viewer with the filter pre-set to the matched path. Togglable from the popup; works against the rolling buffer of API responses captured for the current page.
- **API-response viewer ("the lip")** — a small lip in the middle of the colored top stripe. Click it for the capture list — one row per call, newest first (a chronological record; repeat calls to the same endpoint each get their own row), with a filter box and a **Clear** button. Click any entry to open it in a new tab as a viewer that flattens the JSON to one row per leaf value, with:
  - Filter box that matches across response, request headers, and request payload.
  - Click the path or value cell to copy it.
  - Per-row **`{ }`** button to copy the parent object as JSON (useful context for nested values).
  - Per-row **`{…}`** button to copy the full response as JSON.
  - "Copy response" to dump every visible response row as TSV.
  - **Show request** — toggles a left panel that pairs the response with the original request's **Headers** and flattened **Payload**. On wide screens the viewer splits 50/50; narrower viewports stack the panels. Headers and payload are pulled from the captured `Request` object (cloned + drained at fetch time), so both string-body and `Request`-body shapes are covered.
- **Toolbar popup** — click the extension icon for:
  - A QR of the API endpoint (encoded as `CONFIGURE:EVA:<percent-encoded-url>` so EVA's scanner recognizes it as a configuration QR), framed in the env color.
  - 🟢 🟠 🔴 row to switch which env's API QR is shown.
  - **Open page in** 🟢 🟠 🔴 row to open the same path on a different env in a new tab.
  - 🚀 toggle to swap between Beyond and the regular host for the active tab (highlighted with a circle when Beyond is on).
  - **Find product by Backend ID** — type a backend ID + Enter to jump straight to the product page (Shift+Enter opens the raw API response instead).
  - **Features** section — checkboxes to turn the Source Inspector, hover-QR, and order hover preview on/off; applies to open EVA tabs immediately.
  - EVA suite version chip at the bottom (from `/build.json`; hover for branch and commit).


## Supported URLs

The extension activates on hosts matching:

```
*.<env>.eva-online.cloud
```

where `<env>` is `test`, `acc`, or `prod`. Both regular (`euw.client.acc.eva-online.cloud`) and Beyond (`beyond--euw.client.acc.eva-online.cloud`) variants are recognized.

## Install (unpacked)

1. Download or clone this repo.
2. Open `chrome://extensions/`.
3. Toggle **Developer mode** on (top right).
4. Click **Load unpacked** and pick the repo folder.
5. Visit any EVA tab — the colored stripe should appear at the top.

To get updates after a `git pull`, hit the refresh icon on the extension's card in `chrome://extensions/`.

## Layout

The content scripts share a `globalThis.__evaBuddy` namespace (set up by `lib.js`)
and load in manifest order — no build step.

```
pure.js                    — pure helpers (CSV parsing, date normalising, HTML escaping,
                             return detection); also the unit under test in test/
lib.js                     — core: env detection, feature flags, single scheduler tick +
                             SPA route detection, shared pointer dispatcher
capture.js                 — API-response buffer, Source Inspector value index, auth-header
                             harvest, evaApiCall, viewer launcher
ui-chrome.js               — top stripe + lip, captures dropdown, favicon
                             swap, title prefix, EVA dark mode (smart invert)
tips.js                    — hover-QR on product rows + order list hover preview
inspector.js               — Source Inspector hover trace (Shift-lock, click row → viewer)
nav.js                     — module quick-switch dropdown, dashboard search hijack,
                             alt-click ID copy
orders.js                  — related-orders return highlight, EVA Buddy orders filter
consumers.js               — consumer Backend ID injection
organizations.js           — organizations overview: numeric Status column
settings.js                — control-room settings: per-row clipboard copy button
roles-rights.js            — roles & rights: "hide fully-off functionalities" filter toggle
roles-compare.js           — roles & rights: cross-environment permission comparison (overlay diff)
products.js                — product-detail Prices card
price-csv.js               — price-list CSV bulk upload (Push/Create modes, retry)
bridge.js                  — popup messaging (build chip, backend-ID product lookup)
content.css                — styles for all injected UI
page-hook.js               — runs in the page world; captures every EVA /message/* response
                             (and its request headers), forwards them to the content scripts,
                             and accepts replay-fetch requests using harvested auth headers
qrcode.js                  — bundled QR generator (port of Project Nayuki's library)
popup.html / popup.css / popup.js — toolbar popup (API QR, env jump, Beyond toggle,
                             product lookup, feature toggles, build chip, dark-mode toggle)
viewer.html / viewer.css / viewer.js — JSON viewer opened from the bar-lip dropdown
test/pure.test.js          — unit tests for pure.js (run with `node --test test/pure.test.js`)
manifest.json              — Manifest V3 config
icon-source.png            — source for the toolbar/extension icon
icon-16/32/48/128.png      — rendered icon sizes
pos-logo.png               — bundled Web POS icon for the module switcher
```

## Credits

QR generation is a JavaScript port of [Project Nayuki's QR Code generator library](https://www.nayuki.io/page/qr-code-generator-library) (MIT). See the header in `qrcode.js`.

## License

MIT — see `LICENSE`.

## Disclaimer

EVA Buddy is an independent, third-party browser extension. It is **not** affiliated with, endorsed by, or sponsored by New Black B.V. or any of its subsidiaries. "EVA", "EVA Commerce", and related names and logos are trademarks of their respective owners and are used here solely to describe which product this extension works with.

See [PRIVACY.md](PRIVACY.md) for the privacy policy.
