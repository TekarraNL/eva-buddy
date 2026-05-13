# eva-buddy

Chrome extension that makes it impossible to mistake which EVA admin environment you're looking at — and throws in a few quality-of-life extras while it's there.
The extension doesn't need any extra permissions and just uses what's available in the json. 



## Features

- **Colored top stripe** — thin 12px bar at the top of every EVA page in the environment's color (🟢 test / 🟠 acceptance / 🔴 production). Hover for the full hostname.
- **Tinted favicon** — the EVA logo on a colored background, visible even in unfocused tabs.
- **🚀 title prefix** for `beyond--` URLs so the Beyond backend stands out.
- **Hover-to-QR** on product rows — hover any product row on the products overview, stock overview, or availability page and a QR of its EAN appears next to the cursor (decoded from the page's own `GetProducts` / `SearchProducts` API responses, no extra requests).
- **Alt-click any numeric ID** anywhere in EVA to copy it to your clipboard, with a brief flash on the click.
- **Order list hover preview** — on the orders overview, hover any row to see a labeled tooltip with that order's columns (status, total, customer, dates, etc.) without opening it.
- **Prev/next order pill** — on any order detail page, a small pill at the top-right (`← N / 25 →`) walks you through the orders in the list you most recently visited. The list is captured to `localStorage` whenever you load `/orders/orders`.
- **Related orders tab highlighted on returns** — when an order has any return attached, the **Related orders** tab on the order detail page is filled with a red pill so you can see at a glance there's something to investigate. The extension auto-replays `GetReturnOrdersForOrder` using auth headers harvested from a real captured EVA call, so the highlight appears immediately on `/order-details` — you don't have to click into the Related orders tab first.
- **Backend ID on consumer pages** — on `/people/consumers/<id>/general-info`, a **Backend ID** row is appended to the General information section, pulled from the captured `GetUser` response (EVA returns this but doesn't display it).
- **Dashboard search → orders quick-jump** — on `/dashboard/search`, typing a number (order ID) or an email and pressing Enter routes you straight to `/orders/orders?query=<value>` instead of EVA's default page-search behavior. Other inputs pass through to EVA's normal search.
- **API-response viewer ("the lip")** — a small lip in the middle of the colored top stripe. Click it to see all of the page's captured API responses, listed by endpoint. Click any one to open it in a new tab as a viewer that flattens the JSON to one row per leaf value, with:
  - Filter box that matches against both path and value.
  - Click the path or value cell to copy it.
  - Per-row **`{ }`** button to copy the parent object as JSON (useful context for nested values).
  - Per-row **`{…}`** button to copy the full response as JSON.
  - "Copy all" to dump every visible row as TSV.
- **Toolbar popup** — click the extension icon for:
  - A QR of the API endpoint (encoded as `CONFIGURE:EVA:<percent-encoded-url>` so EVA's scanner recognizes it as a configuration QR), framed in the env color.
  - 🟢 🟠 🔴 row to switch which env's API QR is shown.
  - **Open page in** 🟢 🟠 🔴 row to open the same path on a different env in a new tab.
  - 🚀 toggle to swap between Beyond and the regular host for the active tab (highlighted with a circle when Beyond is on).
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

```
content.css / content.js   — top stripe, favicon swap, title prefix, hover-QR, alt-click copy,
                             order helpers, dashboard hijack, related-orders highlight,
                             consumer Backend ID injection, bar-lip viewer trigger
page-hook.js               — runs in the page world; captures every EVA /message/* response
                             (and its request headers), forwards them to content.js, and
                             accepts replay-fetch requests using harvested auth headers
qrcode.js                  — bundled QR generator (port of Project Nayuki's library)
popup.html / popup.css / popup.js — toolbar popup (API QR, env jump, Beyond toggle, build chip)
viewer.html / viewer.css / viewer.js — JSON viewer opened from the bar-lip dropdown
manifest.json              — Manifest V3 config
icon-source.png            — source for the toolbar/extension icon
icon-16/32/48/128.png      — rendered icon sizes
```

## Credits

QR generation is a JavaScript port of [Project Nayuki's QR Code generator library](https://www.nayuki.io/page/qr-code-generator-library) (MIT). See the header in `qrcode.js`.

## License

MIT — see `LICENSE`.
