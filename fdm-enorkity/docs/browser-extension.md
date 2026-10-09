# Browser Extension

## Targets

- **Chrome / Edge**: Manifest V3 (`extension/chrome`)  
- **Firefox**: Manifest V3 compatible build (`extension/firefox`)  
- **Shared code**: `extension/shared` (TypeScript compiled or copied)

## Features (MVP)

- **Context menu**: “Download with FDM-Enorkity” on links.  
- **Popup**: Connection status, pairing reminder, last send result, open app (deep link / instructions).  
- **Background**: POST to `http://127.0.0.1:<port>/api/v1/browser/add-download` with `X-FDM-Pairing-Token`.  
- **Optional content script**: Light link detection for common file extensions on `href` attributes only (no DOM exfiltration).

## Storage

- `browser.storage.local`: `pairingToken`, `apiBaseUrl`, `lastError`, `lastSentUrl`.

## Security

- Only `http`/`https` URLs sent.  
- No credentials from pages attached unless user explicitly uses context menu on a link (referrer sent optionally).  
- Do not inject into protected / DRM players.

## Loading Unpacked

- Chrome: `chrome://extensions` → Developer mode → Load unpacked → `extension/chrome/dist` or folder with `manifest.json`.  
- Firefox: `about:debugging` → This Firefox → Load Temporary Add-on.

See root `README.md` for MVP port defaults.
