# eva-buddy

Chrome extension that makes it impossible to mistake which EVA environment you're looking at — and throws in a few quality-of-life extras while it's there.

Works with any client (`hunkemoller`, etc.) and any region — the extension auto-detects from the URL.

## Features

- **Colored top stripe** — thin 12px bar at the top of every EVA page in the environment's color (🟢 test / 🟠 acceptance / 🔴 production). Hover for the full hostname.
- **Tinted favicon** — the EVA logo on a colored background, visible even in unfocused tabs.
- **🚀 title prefix** for `beyond--` URLs so the Beyond backend stands out.
- **Hover-to-QR** on the products overview — hover any product row and a QR of its EAN appears next to the cursor (decoded from the page's `SearchProducts` API response, no extra requests).
- **Toolbar popup with API QR** — click the extension icon for a QR of the API endpoint (`api.<region>.<client>.<env>.eva-online.cloud`) framed in the env color. The 🟢 🟠 🔴 buttons under it switch between environments for the same client.
- **Easter egg** — bring your cursor up to the colored stripe and click ten times in a row. Hidden on purpose. Have fun.

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
content.css / content.js   — top stripe, favicon swap, title prefix, hover-QR, easter egg
page-hook.js               — runs in the page world, captures product API responses
qrcode.js                  — bundled QR generator (port of Project Nayuki's library)
popup.html / popup.css / popup.js — toolbar popup
manifest.json              — Manifest V3 config
icon-source.svg            — source for the toolbar/extension icon
icon-16/32/48/128.png      — rendered icon sizes
```

## Regenerate icons

If you tweak `icon-source.svg`:

```bash
rm -rf .icon-tmp && mkdir .icon-tmp \
  && qlmanage -t -s 512 -o .icon-tmp icon-source.svg \
  && for s in 16 32 48 128; do sips -s format png -z $s $s .icon-tmp/icon-source.svg.png --out icon-$s.png; done \
  && rm -rf .icon-tmp
```

(macOS-only — uses Quick Look + sips. On Linux/Windows, `rsvg-convert` or ImageMagick work just as well.)

## Credits

QR generation is a JavaScript port of [Project Nayuki's QR Code generator library](https://www.nayuki.io/page/qr-code-generator-library) (MIT). See the header in `qrcode.js`.

## License

MIT — see `LICENSE`.
