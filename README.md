# eva-buddy

Chrome extension that makes it impossible to mistake which EVA admin environment you're looking at — and throws in a few quality-of-life extras while it's there.
The extension doesn't need any extra permissions and just uses what's available in the json. 



## Features

- **Colored top stripe** — thin 12px bar at the top of every EVA page in the environment's color (🟢 test / 🟠 acceptance / 🔴 production). Hover for the full hostname.
- **Tinted favicon** — the EVA logo on a colored background, visible even in unfocused tabs.
- **🚀 title prefix** for `beyond--` URLs so the Beyond backend stands out.
- **Hover-to-QR** on product rows — hover any product row on the products overview, stock overview, or availability page and a QR of its EAN appears next to the cursor (decoded from the page's own `GetProducts` / `SearchProducts` API responses, no extra requests).
- **Alt-click any numeric ID** anywhere in EVA to copy it to your clipboard, with a brief flash on the click.
- **Toolbar popup** — click the extension icon for:
  - A QR of the API endpoint (`api.<region>.<client>.<env>.eva-online.cloud`), framed in the env color.
  - 🟢 🟠 🔴 row to switch which env's API QR is shown.
  - **Open page in** 🟢 🟠 🔴 row to navigate the active tab to the same path on a different env.
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
content.css / content.js   — top stripe, favicon swap, title prefix, hover-QR, alt-click copy
page-hook.js               — runs in the page world, captures product API responses
qrcode.js                  — bundled QR generator (port of Project Nayuki's library)
popup.html / popup.css / popup.js — toolbar popup
manifest.json              — Manifest V3 config
icon-source.png            — source for the toolbar/extension icon
icon-16/32/48/128.png      — rendered icon sizes
```

## Credits

QR generation is a JavaScript port of [Project Nayuki's QR Code generator library](https://www.nayuki.io/page/qr-code-generator-library) (MIT). See the header in `qrcode.js`.

## License

MIT — see `LICENSE`.
