/* global chrome, browser */

const DEFAULT_API = "http://127.0.0.1:8765";

function extensionStorageLocal() {
  try {
    if (typeof browser !== "undefined" && browser.storage && browser.storage.local) {
      return browser.storage.local;
    }
  } catch (_) {
    /* ignore */
  }
  try {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      return chrome.storage.local;
    }
  } catch (_) {
    /* ignore */
  }
  return null;
}

const storageLocal = extensionStorageLocal();

function setErr(msg) {
  const el = document.getElementById("err");
  if (el) el.textContent = msg || "";
}

function setStatus(msg) {
  const el = document.getElementById("status");
  if (el) el.textContent = msg || "";
}

async function refresh() {
  if (!storageLocal) {
    setErr("");
    setStatus(
      "Extension storage is unavailable. Load the firefox folder via about:debugging → This Firefox → Load Temporary Add-on, then open this popup from the toolbar."
    );
    return;
  }

  const { apiBase, pairingToken, lastSentUrl, lastError, autoCaptureDirectLinks, videoPlayPrompt } =
    await storageLocal.get([
    "apiBase",
    "pairingToken",
    "lastSentUrl",
    "lastError",
    "autoCaptureDirectLinks",
    "videoPlayPrompt",
  ]);
  document.getElementById("apiBase").value = apiBase || DEFAULT_API;
  document.getElementById("token").value = pairingToken || "";
  const acEl = document.getElementById("autoCaptureDirectLinks");
  if (acEl) acEl.checked = Boolean(autoCaptureDirectLinks);
  const vpp = document.getElementById("videoPlayPrompt");
  if (vpp) vpp.checked = videoPlayPrompt !== false;

  const base = apiBase || DEFAULT_API;
  setErr(lastError || "");

  try {
    const res = await fetch(`${base}/api/v1/browser/status`);
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`Not JSON from API (HTTP ${res.status}). First bytes: ${text.slice(0, 120)}`);
    }
    setStatus(JSON.stringify(body.data || body, null, 0));
  } catch (e) {
    const m = e && e.message ? e.message : String(e);
    setStatus(`Cannot reach local API (${m}). Is the desktop app or Go server running?`);
  }

  document.getElementById("last").textContent = lastSentUrl || "—";
}

document.getElementById("pair").addEventListener("click", async () => {
  if (!storageLocal) {
    setStatus("Storage API missing — reload the temporary add-on.");
    return;
  }
  try {
    const apiBase = document.getElementById("apiBase").value.trim() || DEFAULT_API;
    const pairingToken = document.getElementById("token").value.trim();
    const autoCaptureDirectLinks = document.getElementById("autoCaptureDirectLinks")?.checked ?? false;
    const videoPlayPrompt = document.getElementById("videoPlayPrompt")?.checked ?? true;
    await storageLocal.set({ apiBase, pairingToken, autoCaptureDirectLinks, videoPlayPrompt });
    let { extensionId } = await storageLocal.get(["extensionId"]);
    if (!extensionId) {
      extensionId = crypto.randomUUID();
      await storageLocal.set({ extensionId });
    }
    if (!pairingToken) {
      setErr("Paste a pairing token from the desktop app, then try again.");
      await refresh();
      return;
    }
    const res = await fetch(`${apiBase}/api/v1/browser/pair`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-FDM-Pairing-Token": pairingToken,
      },
      body: JSON.stringify({
        browser_name: "Firefox",
        extension_id: extensionId,
      }),
    });
    const text = await res.text();
    let body;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`Bad response (HTTP ${res.status}): ${text.slice(0, 200)}`);
    }
    if (!res.ok || !body.success) {
      throw new Error(body.error || body.message || `HTTP ${res.status}`);
    }
    await storageLocal.set({ lastError: "" });
    setErr("");
    setStatus(JSON.stringify({ paired: true, ...(body.data || {}) }, null, 0));
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    console.error("[fdm-enorkity popup] pair", e);
    setErr(msg);
    await storageLocal.set({ lastError: msg });
  }
  await refresh();
});

document.getElementById("save").addEventListener("click", async () => {
  if (!storageLocal) {
    setStatus("Storage API missing — reload the temporary add-on.");
    return;
  }
  try {
    const apiBase = document.getElementById("apiBase").value.trim() || DEFAULT_API;
    const pairingToken = document.getElementById("token").value.trim();
    const autoCaptureDirectLinks = document.getElementById("autoCaptureDirectLinks")?.checked ?? false;
    const videoPlayPrompt = document.getElementById("videoPlayPrompt")?.checked ?? true;
    await storageLocal.set({ apiBase, pairingToken, autoCaptureDirectLinks, videoPlayPrompt });
    await storageLocal.set({ lastError: "" });
    setErr("");
    setStatus("Saved settings to this browser.");
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    console.error("[fdm-enorkity popup] save", e);
    setErr(msg);
  }
  await refresh();
});

void refresh().catch((e) => {
  console.error("[fdm-enorkity popup] refresh", e);
  setErr(e && e.message ? e.message : String(e));
});
