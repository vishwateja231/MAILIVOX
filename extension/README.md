# Mailivox LinkedIn Extractor

This is a plain Manifest V3 Chrome extension. It does not need a build step.

## Load in Chrome

1. Open `chrome://extensions/`.
2. Enable Developer mode.
3. Click "Load unpacked".
4. Select this `extension` folder.
5. Open the extension settings and confirm the backend URL.

## Auth

If you open `https://mailivox.vercel.app` while logged in, the extension captures `mailivox_token` automatically. You can also paste the token manually in the extension options page.

## Modes

- Quick Extract: run from a LinkedIn search/results page. Sends visible profiles to `/api/leads/process`.
- Deep Extract: run from LinkedIn connections. Opens profiles one at a time, reads visible Contact Info emails, and sends verified emails to `/api/extension/batch`.

Deep Extract uses configurable delays and a per-run limit to reduce LinkedIn friction.
