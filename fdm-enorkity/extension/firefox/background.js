/* global chrome, browser */

const DEFAULT_API = "http://127.0.0.1:8765";
const RECENT_AUTO_CAPTURE_MS = 3000;
const recentAutoCaptured = new Map();

function storageLocal() {
  if (typeof browser !== "undefined" && browser.storage && browser.storage.local) {
    return browser.storage.local;
  }
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    return chrome.storage.local;
  }
  throw new Error("browser.storage / chrome.storage unavailable");
}

function isHttpUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

async function getState() {
  const { apiBase, pairingToken, extensionId } = await storageLocal().get([
    "apiBase",
    "pairingToken",
    "extensionId",
  ]);
  let extId = extensionId;
  if (!extId) {
    extId = crypto.randomUUID();
    await storageLocal().set({ extensionId: extId });
  }
  return {
    apiBase: apiBase || DEFAULT_API,
    pairingToken: pairingToken || "",
    extensionId: extId,
  };
}

async function addDownload(url, referrer, meta) {
  const st = await getState();
  if (!st.pairingToken) {
    throw new Error("Missing pairing token. Open the popup and paste the token from FDM-Enorkity.");
  }
  if (!isHttpUrl(url)) {
    throw new Error("Only http/https URLs are supported.");
  }
  const filename = meta && typeof meta.filename === "string" ? meta.filename.trim() : "";
  const pageTitle = meta && typeof meta.pageTitle === "string" ? meta.pageTitle.trim() : "";
  const res = await fetch(`${st.apiBase}/api/v1/browser/add-download`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-FDM-Pairing-Token": st.pairingToken,
      "X-FDM-Extension-Id": st.extensionId,
    },
    body: JSON.stringify({
      url,
      referrer: referrer || "",
      filename,
      page_title: pageTitle,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) {
    throw new Error(body.error || body.message || `HTTP ${res.status}`);
  }
  await storageLocal().set({ lastSentUrl: url, lastError: "" });
  return body.data;
}

function canAutoCapture(url) {
  const now = Date.now();
  const prev = recentAutoCaptured.get(url) || 0;
  if (now - prev < RECENT_AUTO_CAPTURE_MS) {
    return false;
  }
  recentAutoCaptured.set(url, now);
  return true;
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "fdm-download-link",
      title: "Download with FDM-Enorkity",
      contexts: ["link"],
    });
    chrome.contextMenus.create({
      id: "fdm-download-video",
      title: "Download with FDM-Enorkity (video/audio URL)",
      contexts: ["video", "audio"],
    });
    chrome.contextMenus.create({
      id: "fdm-download-selection",
      title: "Download with FDM-Enorkity (open selection as URL)",
      contexts: ["selection"],
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const pageTitle = (tab && tab.title) || "";
  try {
    if (info.menuItemId === "fdm-download-link" && info.linkUrl) {
      await addDownload(info.linkUrl, tab?.url || "", { pageTitle });
      return;
    }
    if (info.menuItemId === "fdm-download-video" && info.srcUrl) {
      await addDownload(info.srcUrl, tab?.url || "", { pageTitle });
      return;
    }
    if (info.menuItemId === "fdm-download-selection" && info.selectionText) {
      const candidate = info.selectionText.trim();
      if (!isHttpUrl(candidate)) {
        throw new Error("Selection is not a valid http/https URL.");
      }
      await addDownload(candidate, tab?.url || "", { pageTitle });
    }
  } catch (e) {
    await storageLocal().set({ lastError: String(e && e.message ? e.message : e) });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type) {
    return;
  }

  if (message.type === "fdm:download-now") {
    (async () => {
      try {
        const url = typeof message.url === "string" ? message.url.trim() : "";
        const referrer = typeof message.referrer === "string" ? message.referrer.trim() : "";
        const pageTitle = typeof message.pageTitle === "string" ? message.pageTitle.trim() : "";
        const filename = typeof message.filename === "string" ? message.filename.trim() : "";
        if (!isHttpUrl(url)) {
          sendResponse({ ok: false, error: "invalid-url" });
          return;
        }
        await addDownload(url, referrer, { pageTitle, filename });
        sendResponse({ ok: true });
      } catch (e) {
        const err = String(e && e.message ? e.message : e);
        await storageLocal().set({ lastError: err });
        sendResponse({ ok: false, error: err });
      }
    })();
    return true;
  }

  if (message.type !== "fdm:auto-capture") {
    return;
  }

  (async () => {
    try {
      const { autoCaptureDirectLinks } = await storageLocal().get(["autoCaptureDirectLinks"]);
      if (!autoCaptureDirectLinks) {
        sendResponse({ ok: false, skipped: "disabled" });
        return;
      }
      const url = typeof message.url === "string" ? message.url.trim() : "";
      const referrer = typeof message.referrer === "string" ? message.referrer.trim() : "";
      const pageTitle = typeof message.pageTitle === "string" ? message.pageTitle.trim() : "";
      const filename = typeof message.filename === "string" ? message.filename.trim() : "";
      if (!isHttpUrl(url)) {
        sendResponse({ ok: false, skipped: "invalid-url" });
        return;
      }
      if (!canAutoCapture(url)) {
        sendResponse({ ok: false, skipped: "duplicate" });
        return;
      }
      await addDownload(url, referrer, { pageTitle, filename });
      sendResponse({ ok: true });
    } catch (e) {
      const err = String(e && e.message ? e.message : e);
      await storageLocal().set({ lastError: err });
      sendResponse({ ok: false, error: err });
    }
  })();

  return true;
});
