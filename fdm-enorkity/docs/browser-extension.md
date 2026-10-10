# Browser Extension

CatalystFDM ships one WebExtension in two folders: `extension/chrome` (Chrome, Brave, Edge, Opera, Vivaldi — MV3 service
worker) and `extension/firefox` (MV3 with `background.scripts`). They are identical except `manifest.json`.

What it does, how to install it and how one-click connecting works for users: **`extension/README.md`**.

## Contract with the engine

| Route | Auth | Used for |
|------|------|----------|
| `POST /api/v1/browser/pair/request` | none (extension Origin) | ask to connect → `{request_id, code, expires_in}` |
| `GET /api/v1/browser/pair/request/:request_id` | the secret id | poll → `pending` / `approved` (+ token, once) / `denied` / `expired` |
| `GET /api/v1/browser/me` | token | is this browser still connected? (401 → forget the token) |
| `POST /api/v1/browser/inspect` | token | qualities for the pill (`kind: media | playlist | direct`) |
| `POST /api/v1/browser/add-download` | token | send a download (media fields as in `docs/media-engine.md`) |
| `POST /api/v1/browser/pair` | legacy token | old manual-key flow |

Token routes send `X-FDM-Pairing-Token` and `X-FDM-Extension-Id` (a random id per browser profile, not `runtime.id`).
Requests from extension origins to any other route are refused (`internal/api/middleware.go`), so an extension can never read
the library, change settings or approve itself. Pairing internals and the threat model: `docs/security.md`.

## Muno Watch series (`content.js`)

On `munowatch.com/twolekede` pages the content script asks the site's own `GET /episoderanges` (the "56 Episodes"
button; it needs `X-Requested-With: XMLHttpRequest`) whether the page is part of a series. Movies return no ranges and
keep the normal one-file button. For a series the pill shows at once with **This episode**, **All N** and one chip per
site range. Choosing one:

1. lists the episodes with `GET /moreepisodes?epsRange=…` (only same-origin `/twolekede` links are used);
2. reads each episode page with the user's own session (Firefox: `content.fetch`) and takes the URL its player loads:
   `#video-component[src]`, else `atob(#soul-info[data-gumite])`, which is where the site's player reads it from;
3. sends them to the background in order, a few at a time, as `fdm:add-batch` → one `add-download` each with the
   episode page as `referrer` (BunnyCDN checks it), `page_title`/`title` = the page title ("Heroes 2 by Vj Junior"),
   the tile poster as `thumbnail`, `site: "Muno Watch"` and `skip_existing: true`. HLS/DASH URLs go to the media engine.

The site answers a burst of about ten page loads with its home page for up to a minute, so pages are read one at a
time, 3 s apart (56 episodes ≈ 3 min). If it still answers with the home page, the script queues what it has, waits
30/45/60 s with a countdown, and finally stops with "N left — try again in a few minutes"; running it again skips what
is already queued. Nothing here bypasses the site's login or plan: an episode the account can't play is reported, not
fetched.

## Security

- Only `http`/`https` URLs are sent, and only on a user action (pill, context menu, popup) or the opt-in direct-link capture.
- `content.js` never talks to localhost; it messages the background, which holds the token.
- The pill lives in a closed shadow root; page text only ever reaches it through `textContent`/`title`.
- DRM-protected videos show a lock instead of a download button.
