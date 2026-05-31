# EVA Buddy — Privacy Policy

**Last updated:** 2026-05-31

EVA Buddy is a Chrome extension that adds quality-of-life features to the EVA admin suite (`*.eva-online.cloud`). This policy explains what the extension does with data and what it does not.

## Disclaimer

EVA Buddy is an independent, third-party browser extension. It is **not** affiliated with, endorsed by, sponsored by, or associated in any way with New Black B.V., its subsidiaries, or any of its partners. "EVA", "EVA Commerce", and related names and logos are trademarks of their respective owners and are used here solely to describe which product this extension works with. All product- and company names mentioned remain the property of their respective owners.

## TL;DR

EVA Buddy runs entirely on your device. It does not send any data to any server operated by the developer or any third party. There is no analytics, no telemetry, and no tracking.

## What EVA Buddy stores locally

The extension uses Chrome's local storage (`chrome.storage.local`) to remember user preferences such as:

- Dark mode on/off
- "Beyond" environment toggle
- Last-used pricelist selection
- Cached EVA module icons (to render the module quick-switcher offline)

This data never leaves your browser.

## What EVA Buddy reads on the page

While you are on an EVA admin page (`*.test.eva-online.cloud`, `*.acc.eva-online.cloud`, `*.prod.eva-online.cloud`), EVA Buddy:

- Injects UI helpers (environment color stripe, dark mode, module switcher, hover-QR, etc.) into the page.
- Intercepts EVA API responses that the page itself is already making (via `fetch` and `XMLHttpRequest`), so it can power features such as the JSON response viewer, return-order indicators, and the product prices card.
- Reads authentication headers from those in-page requests so it can make follow-up API calls **to EVA's own API only** on your behalf (for example, fetching return-order info or looking up a product by Backend ID).

All of this processing happens locally in your browser. No intercepted data is transmitted off-device.

## Network requests EVA Buddy makes

EVA Buddy only makes network requests to EVA's own API endpoints on the same host you are already logged in to (`api.<your-eva-host>`). It does not contact any other server.

## Permissions and why they are needed

- **`activeTab`** — to inject UI helpers and read context on the EVA admin tab you are currently using.
- **`storage`** — to save your preferences locally (see above).
- **Host permissions for `*.test.eva-online.cloud`, `*.acc.eva-online.cloud`, `*.prod.eva-online.cloud`** — the extension only operates on the EVA admin suite and is inactive on every other site.

## What EVA Buddy does **not** do

- It does not collect, transmit, sell, or share personal information.
- It does not include analytics, telemetry, error reporting, or any third-party tracking.
- It does not execute remote code.
- It does not modify any data on the EVA server beyond what you yourself trigger as a logged-in EVA user.

## Source code

EVA Buddy is open source under the MIT license: https://github.com/TekarraNL/eva-buddy

## Contact

For questions about this policy, open an issue at https://github.com/TekarraNL/eva-buddy/issues
