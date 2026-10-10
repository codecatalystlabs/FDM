/* global chrome, browser, importScripts, CatalystPair */
// CatalystFDM background: context menus, toolbar badge and the only place content scripts
// reach the local API through (pages never fetch localhost themselves).

// Chrome runs this as a service worker; Firefox loads pair.js first via background.scripts.
if (typeof importScripts === "function" && typeof CatalystPair === "undefined") {
  importScripts("pair.js");
}

const P = CatalystPair;
const ext = P.ns;
const RECENT_AUTO_CAPTURE_MS = 3000;
const recentAutoCaptured = new Map();
const MAX_PLAYLIST = 500;
const BADGE = { busy: "#0b7fd4", ok: "#067a55", error: "#c42020", connect: "#a65400" };

const str = (v) => (typeof v === "string" ? v.trim() : "");
const num = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);
const clip = (v, n) => str(v).slice(0, n);

function isHttpUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function storageLocal() {
  return ext.storage.local;
}

// ---------------------------------------------------------------------------
// Setup page
// ---------------------------------------------------------------------------

let lastWelcomeOpen = 0;

/** Focuses an open welcome tab, or opens one. Needs no "tabs" permission. */
async function openWelcome() {
  const url = ext.runtime.getURL("welcome.html");
  try {
    if (typeof ext.runtime.getContexts === "function") {
      const contexts = await ext.runtime.getContexts({ contextTypes: ["TAB"] });
      const open = (contexts || []).find((c) => c.tabId >= 0 && String(c.documentUrl || "").startsWith(url));
      if (open) {
        await ext.tabs.update(open.tabId, { active: true });
        if (open.windowId >= 0 && ext.windows) {
          await ext.windows.update(open.windowId, { focused: true });
        }
        return;
      }
    }
  } catch {
    /* fall through to opening a tab */
  }
  if (Date.now() - lastWelcomeOpen < 4000) {
    return; // several clicks in a row: one tab is enough
  }
  lastWelcomeOpen = Date.now();
  await ext.tabs.create({ url });
}

// ---------------------------------------------------------------------------
// API calls (token routes)
// ---------------------------------------------------------------------------

async function addDownload(url, referrer, meta) {
  if (!isHttpUrl(url)) {
    throw new Error("Only http/https URLs are supported.");
  }
  const data = await P.callApi("/api/v1/browser/add-download", {
    body: {
      url,
      referrer: referrer || "",
      filename: clip(meta && meta.filename, 512),
      page_title: clip(meta && meta.pageTitle, 512),
    },
  });
  await storageLocal().set({ lastSentUrl: url, lastError: "" });
  return data;
}

async function inspectUrl(url, referrer) {
  if (!isHttpUrl(url)) {
    throw new Error("Only http/https pages can be inspected.");
  }
  // yt-dlp can take a while on big pages and playlists.
  return P.callApi("/api/v1/browser/inspect", { body: { url, referrer: referrer || "" }, timeoutMs: 120000 });
}

async function addMediaDownload(m, quiet) {
  if (!isHttpUrl(m.url)) {
    throw new Error("Only http/https URLs are supported.");
  }
  const data = await P.callApi("/api/v1/browser/add-download", {
    body: {
      url: m.url,
      referrer: str(m.referrer),
      page_title: clip(m.pageTitle, 512),
      filename: clip(m.filename, 512),
      engine: "media",
      quality_id: clip(m.quality_id, 32) || "best",
      title: clip(m.title, 512),
      thumbnail: clip(m.thumbnail, 2048),
      site: clip(m.site, 128),
      duration_seconds: Math.max(0, Math.round(num(m.duration_seconds, 0))),
      size_bytes: num(m.size_bytes, -1),
    },
  });
  if (!quiet) {
    await storageLocal().set({ lastSentUrl: m.url, lastError: "" });
  }
  return data;
}

/** Queues every playlist entry with one quality preset (one add-download per video). */
async function addPlaylist(m) {
  const entries = (Array.isArray(m.entries) ? m.entries : [])
    .filter((e) => e && typeof e.url === "string" && isHttpUrl(e.url))
    .slice(0, MAX_PLAYLIST);
  if (!entries.length) {
    throw new Error("This playlist has no downloadable videos.");
  }
  const quality = clip(m.quality_id, 32) || "best";
  let queued = 0;
  let failed = 0;
  let firstError = "";
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    try {
      await addMediaDownload(
        {
          url: e.url,
          referrer: m.referrer,
          pageTitle: m.pageTitle,
          quality_id: quality,
          title: e.title,
          thumbnail: e.thumbnail,
          site: m.site,
          duration_seconds: e.duration_seconds,
          size_bytes: -1,
        },
        true
      );
      queued++;
    } catch (err) {
      if (err && (err.code === "not_connected" || err.code === "offline")) {
        throw err; // nothing else will get through either
      }
      failed++;
      firstError = firstError || P.errMessage(err);
      if (!queued && failed >= 3) {
        throw new Error(firstError);
      }
    }
    if (i % 10 === 9) {
      // An extension API call keeps the service worker awake through long playlists.
      await storageLocal().set({ playlistProgress: { done: i + 1, total: entries.length, at: Date.now() } });
    }
  }
  await storageLocal().set({ lastSentUrl: str(m.playlistUrl) || entries[0].url, lastError: "", playlistProgress: null });
  if (!queued) {
    throw new Error(firstError || "Nothing was queued.");
  }
  return { queued, failed, total: entries.length };
}

/**
 * Queues files a content script already resolved (a series' episodes), in order. Files already
 * saved or queued under the same name are skipped by the engine (skip_existing).
 */
async function addBatch(m) {
  const items = (Array.isArray(m.items) ? m.items : [])
    .filter((it) => it && isHttpUrl(str(it.url)))
    .slice(0, MAX_PLAYLIST);
  if (!items.length) {
    throw new Error("Nothing to download.");
  }
  let queued = 0;
  let skipped = 0;
  let failed = 0;
  let firstError = "";
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const body = {
      url: str(it.url),
      referrer: isHttpUrl(str(it.referrer)) ? str(it.referrer) : "",
      page_title: clip(it.pageTitle, 512),
      title: clip(it.title, 512),
      thumbnail: clip(it.thumbnail, 2048),
      site: clip(it.site, 128),
      skip_existing: true,
    };
    if (it.engine === "media") {
      // HLS/DASH manifests go through the media engine at the best quality.
      Object.assign(body, { engine: "media", quality_id: "best", filename: body.page_title });
    }
    try {
      const dl = await P.callApi("/api/v1/browser/add-download", { body });
      if (dl && dl.skipped) {
        skipped++;
      } else {
        queued++;
      }
    } catch (err) {
      if (err && (err.code === "not_connected" || err.code === "offline")) {
        throw err; // nothing else will get through either
      }
      failed++;
      firstError = firstError || P.errMessage(err);
      if (!queued && !skipped && failed >= 3) {
        throw new Error(firstError);
      }
    }
    if (i % 10 === 9) {
      // An extension API call keeps the service worker awake through long batches.
      await storageLocal().set({ playlistProgress: { done: i + 1, total: items.length, at: Date.now() } });
    }
  }
  await storageLocal().set({ lastSentUrl: str(items[0].referrer) || str(items[0].url), lastError: "", playlistProgress: null });
  return { queued, skipped, failed, total: items.length, error: firstError };
}

function pickRecommended(options) {
  const list = Array.isArray(options) ? options : [];
  return list.find((o) => o.recommended) || list.find((o) => o.kind !== "audio") || list[0] || null;
}

function slimPlaylist(info, pageUrl) {
  return {
    kind: "playlist",
    needsChoice: true,
    url: info.url || pageUrl,
    title: str(info.title),
    site: str(info.site),
    uploader: str(info.uploader),
    count: Array.isArray(info.entries) ? info.entries.length : 0,
    options: Array.isArray(info.options) ? info.options : [],
    entries: Array.isArray(info.entries) ? info.entries : [],
  };
}

/**
 * Inspects a page and queues its recommended quality (context menu and the popup's
 * "Download video on this tab"). With askPlaylist, a playlist is returned for the caller to
 * choose a preset instead of being queued.
 */
async function downloadPageVideo(pageUrl, opts) {
  const o = opts || {};
  const info = await inspectUrl(pageUrl, pageUrl);
  if (info.drm) {
    throw new Error("This video is DRM-protected — CatalystFDM doesn't download DRM content.");
  }
  if (info.kind === "direct") {
    const dl = await addDownload(info.url || pageUrl, pageUrl, { filename: info.filename || "", pageTitle: o.pageTitle });
    return { kind: "direct", title: str(info.filename) || str(info.title), quality: "", download: dl };
  }
  if (info.kind === "playlist") {
    if (o.askPlaylist) {
      return slimPlaylist(info, pageUrl);
    }
    const preset = pickRecommended(info.options);
    const res = await addPlaylist({
      entries: info.entries,
      quality_id: preset ? preset.id : "best",
      referrer: pageUrl,
      pageTitle: o.pageTitle,
      site: info.site,
      playlistUrl: info.url || pageUrl,
    });
    return Object.assign({ kind: "playlist", title: str(info.title), quality: preset ? preset.label : "Best" }, res);
  }
  const opt = pickRecommended(info.options);
  if (!opt) {
    throw new Error("No downloadable formats found on this page.");
  }
  const dl = await addMediaDownload({
    url: info.url || pageUrl,
    referrer: pageUrl,
    pageTitle: o.pageTitle,
    quality_id: opt.id,
    title: info.title,
    thumbnail: info.thumbnail,
    site: info.site,
    duration_seconds: info.duration_seconds,
    size_bytes: opt.size_bytes,
  });
  return { kind: "media", title: str(info.title), quality: str(opt.label), download: dl };
}

// ---------------------------------------------------------------------------
// Toolbar badge
// ---------------------------------------------------------------------------

let badgeTimer = 0;

function setBadge(text, color, title) {
  try {
    ext.action.setBadgeBackgroundColor({ color });
    if (typeof ext.action.setBadgeTextColor === "function") {
      void Promise.resolve(ext.action.setBadgeTextColor({ color: "#ffffff" })).catch(() => {});
    }
    ext.action.setBadgeText({ text });
    if (title) {
      ext.action.setTitle({ title });
    }
  } catch {
    /* action API unavailable */
  }
}

/** Resting badge: "!" while this browser isn't connected, nothing once it is. */
async function idleBadge() {
  clearTimeout(badgeTimer);
  try {
    const st = await P.getState();
    if (st.pairingToken) {
      setBadge("", BADGE.ok, "CatalystFDM");
    } else {
      setBadge("!", BADGE.connect, "CatalystFDM — not connected. Click to connect.");
    }
  } catch {
    /* storage unavailable */
  }
}

function flashBadge(text, color, ms) {
  setBadge(text, color);
  clearTimeout(badgeTimer);
  if (ms) {
    badgeTimer = setTimeout(() => void idleBadge(), ms);
  }
}

async function withBadge(fn) {
  flashBadge("…", BADGE.busy, 0);
  try {
    await fn();
    flashBadge("✓", BADGE.ok, 2500);
  } catch (e) {
    await storageLocal().set({ lastError: P.errMessage(e) });
    if (e && e.code === "not_connected") {
      await idleBadge();
      await openWelcome();
      return;
    }
    flashBadge("!", BADGE.error, 6000);
  }
}

function canAutoCapture(url) {
  const now = Date.now();
  const prev = recentAutoCaptured.get(url) || 0;
  if (now - prev < RECENT_AUTO_CAPTURE_MS) {
    return false;
  }
  recentAutoCaptured.set(url, now);
  if (recentAutoCaptured.size > 200) {
    for (const [k, t] of recentAutoCaptured) {
      if (now - t > RECENT_AUTO_CAPTURE_MS) {
        recentAutoCaptured.delete(k);
      }
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Pairing hand-off: poll on behalf of a popup that closed while the app was asking
// ---------------------------------------------------------------------------

const pairPorts = new Set();
let watching = false;

async function watchPendingPair() {
  if (watching) {
    return;
  }
  watching = true;
  try {
    for (;;) {
      if (pairPorts.size > 0) {
        return; // a page is showing the code and polls itself
      }
      const ticket = await P.readPending();
      if (!ticket) {
        return;
      }
      const res = await P.pollOnce(ticket);
      if (res.status === "approved" || res.status === "denied" || res.status === "expired") {
        return;
      }
      await new Promise((r) => setTimeout(r, res.status === "offline" ? P.POLL_MS * 2 : P.POLL_MS));
    }
  } catch {
    /* give up quietly; the popup can start over */
  } finally {
    watching = false;
  }
}

ext.runtime.onConnect.addListener((port) => {
  if (!port || port.name !== P.PORT_NAME) {
    return;
  }
  pairPorts.add(port);
  port.onDisconnect.addListener(() => {
    pairPorts.delete(port);
    if (!pairPorts.size) {
      setTimeout(() => void watchPendingPair(), 300);
    }
  });
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

const MENUS = [
  { id: "fdm-download-link", title: "Download with CatalystFDM", contexts: ["link"] },
  { id: "fdm-download-video", title: "Download with CatalystFDM (video/audio URL)", contexts: ["video", "audio"] },
  { id: "fdm-download-page-video", title: "Download video on this page with CatalystFDM", contexts: ["page", "video"] },
  { id: "fdm-download-selection", title: "Download with CatalystFDM (open selection as URL)", contexts: ["selection"] },
];

async function createMenus() {
  try {
    await ext.contextMenus.removeAll(); // promise in Chrome MV3 and Firefox
  } catch {
    /* nothing to remove */
  }
  for (const m of MENUS) {
    try {
      // create() takes a callback in both browsers; reading lastError silences duplicates.
      ext.contextMenus.create(m, () => void ext.runtime.lastError);
    } catch {
      /* duplicate id after a racing install event */
    }
  }
}

ext.runtime.onInstalled.addListener((details) => {
  void createMenus();
  void (async () => {
    try {
      await P.getState(); // creates this browser's id before the welcome page needs it
    } catch {
      /* storage unavailable */
    }
    await idleBadge();
    if (details && details.reason === "install") {
      await openWelcome().catch(() => {});
    }
  })();
});

if (ext.runtime.onStartup) {
  ext.runtime.onStartup.addListener(() => {
    void idleBadge();
    void watchPendingPair();
  });
}

ext.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.pairingToken) {
    void idleBadge();
  }
});

ext.contextMenus.onClicked.addListener((info, tab) => {
  const pageTitle = (tab && tab.title) || "";
  const pageUrl = info.pageUrl || (tab && tab.url) || "";
  void withBadge(async () => {
    if (info.menuItemId === "fdm-download-link" && info.linkUrl) {
      await addDownload(info.linkUrl, pageUrl, { pageTitle });
      return;
    }
    if (info.menuItemId === "fdm-download-video" && info.srcUrl) {
      if (!isHttpUrl(info.srcUrl)) {
        // blob:/MSE players: hand the page to the media engine instead.
        await downloadPageVideo(pageUrl, { pageTitle });
        return;
      }
      await addDownload(info.srcUrl, pageUrl, { pageTitle });
      return;
    }
    if (info.menuItemId === "fdm-download-page-video") {
      await downloadPageVideo(pageUrl, { pageTitle });
      return;
    }
    if (info.menuItemId === "fdm-download-selection" && info.selectionText) {
      const candidate = info.selectionText.trim();
      if (!isHttpUrl(candidate)) {
        throw new Error("The selection isn't a web address (http/https).");
      }
      await addDownload(candidate, pageUrl, { pageTitle });
    }
  });
});

// ---------------------------------------------------------------------------
// Messages from content.js and popup.js
// ---------------------------------------------------------------------------

/**
 * Runs an async handler and replies {ok, data} / {ok:false, error, code}. A content-script
 * action that fails because this browser isn't connected opens the setup page.
 */
function reply(sendResponse, sender, fn) {
  (async () => {
    try {
      const data = await fn();
      sendResponse({ ok: true, data });
    } catch (e) {
      const err = P.errMessage(e);
      const code = (e && e.code) || "";
      await storageLocal()
        .set({ lastError: err })
        .catch(() => {});
      if (code === "not_connected" && sender && sender.tab) {
        await openWelcome().catch(() => {});
      }
      sendResponse({ ok: false, error: err, code });
    }
  })();
  return true;
}

ext.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string" || (sender && sender.id && sender.id !== ext.runtime.id)) {
    return undefined;
  }

  switch (message.type) {
    case "fdm:download-now":
      return reply(sendResponse, sender, () =>
        addDownload(str(message.url), str(message.referrer), {
          pageTitle: str(message.pageTitle),
          filename: str(message.filename),
        })
      );

    case "fdm:inspect":
      return reply(sendResponse, sender, () => inspectUrl(str(message.url), str(message.referrer)));

    case "fdm:add-media":
      return reply(sendResponse, sender, () => addMediaDownload(message));

    case "fdm:add-playlist":
      return reply(sendResponse, sender, () => addPlaylist(message));

    case "fdm:add-batch":
      return reply(sendResponse, sender, () => addBatch(message));

    case "fdm:download-page":
      return reply(sendResponse, sender, () =>
        downloadPageVideo(str(message.url), { pageTitle: str(message.pageTitle), askPlaylist: true })
      );

    case "fdm:open-welcome":
      return reply(sendResponse, null, () => openWelcome());

    case "fdm:auto-capture":
      break;

    default:
      return undefined;
  }

  // Auto-capture is passive: it never opens tabs and stays quiet when disabled.
  (async () => {
    try {
      const { autoCaptureDirectLinks } = await storageLocal().get(["autoCaptureDirectLinks"]);
      if (!autoCaptureDirectLinks) {
        sendResponse({ ok: false, skipped: "disabled" });
        return;
      }
      const url = str(message.url);
      if (!isHttpUrl(url)) {
        sendResponse({ ok: false, skipped: "invalid-url" });
        return;
      }
      if (!canAutoCapture(url)) {
        sendResponse({ ok: false, skipped: "duplicate" });
        return;
      }
      await addDownload(url, str(message.referrer), {
        pageTitle: str(message.pageTitle),
        filename: str(message.filename),
      });
      sendResponse({ ok: true });
    } catch (e) {
      const err = P.errMessage(e);
      await storageLocal()
        .set({ lastError: err })
        .catch(() => {});
      sendResponse({ ok: false, error: err, code: (e && e.code) || "" });
    }
  })();
  return true;
});

void idleBadge();
