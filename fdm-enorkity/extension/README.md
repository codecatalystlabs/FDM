# CatalystFDM browser extension

Sends downloads from your browser to the CatalystFDM app running on the same computer. It only
talks to `http://127.0.0.1` / `localhost`. Nothing leaves your machine.

- **Download button on videos.** Play a video and a small round button appears in its corner.
  Tap it to pick a quality (4K, 1080p, 720p, MP3, …). On playlists it offers one preset for
  every video. DRM-protected videos show a lock.
- **Whole series on Muno Watch.** On an episode page the button appears straight away and offers
  **This episode**, **All 56** (every episode, in order) or one of the site's ranges (1–20, 21–40, …).
  It reads each episode with your own Muno Watch login, a few seconds apart so the site doesn't
  refuse, and episodes already in CatalystFDM are skipped. Keep the tab open while it reads
  (about 3 minutes for 56 episodes); downloads start after the first few.
- **Right-click → Download with CatalystFDM** on links, videos, audio, selected URLs or the
  whole page.
- **Toolbar popup** with "Download video on this tab", a switch for the video button, and a
  link to the app.

## Install

**Chrome, Brave, Edge, Opera, Vivaldi**

1. Open `chrome://extensions` (or `brave://extensions`, `edge://extensions`, …).
2. Turn on **Developer mode**, click **Load unpacked** and pick the `extension/chrome` folder.
3. A welcome tab opens and starts connecting (see below). Pin CatalystFDM to the toolbar.

**Firefox (115+)**

1. Open `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** and pick
   `extension/firefox/manifest.json`. Temporary add-ons are removed when Firefox restarts. For a
   permanent install, sign it on addons.mozilla.org (unlisted is enough).
2. In `about:addons` → CatalystFDM → **Permissions**, allow access to websites, or the video
   button won't appear.

## Connecting (one click)

1. Start the CatalystFDM app.
2. The welcome tab (or **Connect to CatalystFDM** in the popup) asks the app to connect and shows
   a 4-digit code.
3. CatalystFDM shows "*Brave wants to connect · 4821 · Don't Allow / Allow*". Check that the codes
   match and click **Allow**. The tab switches to "Connected — you're all set".

You can close the popup while the app is asking. The extension finishes connecting in the
background. Codes expire after five minutes.

Removing the browser in CatalystFDM disconnects it. On its next request the extension forgets
its token, the toolbar icon shows **!** and the popup offers to connect again.

**Fallback: connect with a token.** In the popup, open **Advanced**, paste a key made in
CatalystFDM → Browsers → *Advanced: manual pairing key*, and click **Connect**. The welcome page has the same option under
"Connect with a token instead".

## Troubleshooting

| What you see | What to do |
| --- | --- |
| "Open CatalystFDM first" | The app isn't running, or it uses another port. Start it (the page retries every few seconds) or set **Advanced → App address**. Only 127.0.0.1/localhost addresses are accepted. |
| The code never shows up in the app | Bring the CatalystFDM window to the front. An app too old for one-click connect needs the token fallback. |
| "This browser was disconnected in CatalystFDM" | It was removed in the app. Click **Connect** again. |
| No button on a video | Check the popup switch and **Advanced → Show again** (sites hidden with the eye button). Tiny or muted background loops are ignored. On YouTube it appears on watch and Shorts pages. In Firefox, grant site access (see Install). |
| Chrome asks to allow access to devices on your local network | Allow it. That's how the extension reaches the app on 127.0.0.1. |
| Something failed after a right-click | The toolbar badge shows **!**. Open the popup to see the message. |
| Muno Watch: "… left — try again in a few minutes" | The site asked us to slow down and kept refusing. Press **All** again later: what's already queued is skipped and it carries on. |
| Muno Watch: "check you're signed in" | Sign in to Muno Watch with an active plan in this browser, reload the episode page, and try again. |

## For developers

- `chrome/` and `firefox/` are identical except `manifest.json` (Firefox uses
  `background.scripts` + `browser_specific_settings`; Chrome uses a service worker that
  `importScripts("pair.js")`). Edit `chrome/`, then sync with
  `rsync -a --exclude manifest.json extension/chrome/ extension/firefox/`.
- `pair.js` holds the connection logic shared by `popup.html`, `welcome.html` and the
  background. Only the background calls token routes for content scripts. `content.js` never
  fetches localhost.
- API: `POST /api/v1/browser/pair/request`, `GET /api/v1/browser/pair/request/<id>` (poll),
  `GET /api/v1/browser/me`, `POST /api/v1/browser/inspect`, `POST /api/v1/browser/add-download`,
  legacy `POST /api/v1/browser/pair`. Token routes send `X-FDM-Pairing-Token` and
  `X-FDM-Extension-Id`. A 401 clears the stored token.
- `X-FDM-Extension-Id` / `extension_id` is a random id generated once per browser profile and
  stored as `extensionId`. It is not `runtime.id`, which is the same for every Firefox install
  and for Chrome and Brave loading the same folder. Pairing one of those would replace the
  other's connection in the app.
