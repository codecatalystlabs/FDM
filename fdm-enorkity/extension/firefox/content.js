/* global chrome */

// Direct file / stream manifests (http(s) only; blob: is never sent).
const DIRECT_DOWNLOAD_RE =
  /\.(zip|rar|7z|tar|gz|bz2|xz|iso|exe|msi|dmg|pkg|deb|rpm|apk|mp3|wav|flac|mp4|mkv|avi|mov|webm|m4v|3gp|m3u8|mpd|vtt|srt)(?:$|[?#])/i;

const PROMPT_ROOT_ID = "fdm-enorkity-video-prompt-root";
const SESSION_SHOWN_HTTP = new Set();
const SESSION_BLOB_HINT_HOST = new Set();

let promptHost = null;
let promptShadow = null;

function isHttpUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function isLikelyDirectDownload(anchor) {
  if (!anchor || !anchor.href) {
    return false;
  }
  if (anchor.hasAttribute("download")) {
    return true;
  }
  return DIRECT_DOWNLOAD_RE.test(anchor.href);
}

function videoHttpUrl(video) {
  if (!(video instanceof HTMLVideoElement)) {
    return "";
  }
  const cur = video.currentSrc || video.src || "";
  if (cur && isHttpUrl(cur)) {
    return cur;
  }
  const srcEl = video.querySelector("source[src]");
  if (srcEl) {
    const s = srcEl.getAttribute("src") || "";
    if (s && isHttpUrl(s)) {
      return new URL(s, document.baseURI).href;
    }
  }
  return "";
}

function isBlobVideoUrl(video) {
  if (!(video instanceof HTMLVideoElement)) {
    return false;
  }
  const cur = video.currentSrc || video.src || "";
  return typeof cur === "string" && cur.startsWith("blob:");
}

function sendAutoCapture(url, referrer, suggestedFilename) {
  chrome.runtime.sendMessage({
    type: "fdm:auto-capture",
    url,
    referrer: referrer || window.location.href,
    pageTitle: document.title || "",
    filename: typeof suggestedFilename === "string" ? suggestedFilename : "",
  });
}

function sendDownloadNow(url, referrer) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        type: "fdm:download-now",
        url,
        referrer: referrer || window.location.href,
        pageTitle: document.title || "",
      },
      (resp) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(resp || { ok: false, error: "no response" });
      }
    );
  });
}

function getOrCreatePromptShadow() {
  if (!promptHost || !document.documentElement.contains(promptHost)) {
    promptHost = document.createElement("div");
    promptHost.id = PROMPT_ROOT_ID;
    document.documentElement.appendChild(promptHost);
    promptShadow = promptHost.attachShadow({ mode: "open" });
  }
  return promptShadow;
}

function removePrompt() {
  if (promptHost && promptHost.parentNode) {
    promptHost.parentNode.removeChild(promptHost);
  }
  promptHost = null;
  promptShadow = null;
}

function renderPromptHtml(title, bodyHtml, buttonsHtml) {
  return `
    <style>
      :host { all: initial; }
      .wrap {
        position: fixed;
        bottom: 16px;
        right: 16px;
        z-index: 2147483647;
        max-width: 360px;
        font: 13px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      }
      .card {
        background: #0f172a;
        color: #e2e8f0;
        border-radius: 12px;
        padding: 12px 14px;
        box-shadow: 0 12px 40px rgba(0,0,0,.45);
        border: 1px solid #334155;
      }
      .title { font-weight: 700; font-size: 14px; margin-bottom: 6px; color: #f8fafc; }
      .body { font-size: 12px; color: #cbd5e1; word-break: break-all; margin-bottom: 10px; }
      .row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
      button {
        cursor: pointer;
        border: 0;
        border-radius: 8px;
        padding: 8px 12px;
        font-weight: 600;
        font-size: 12px;
      }
      .primary { background: linear-gradient(90deg, #6366f1, #22d3ee); color: #fff; }
      .ghost { background: #1e293b; color: #e2e8f0; border: 1px solid #475569; }
      .danger { background: transparent; color: #94a3b8; font-weight: 500; text-decoration: underline; padding: 4px 0; }
      .status { margin-top: 8px; font-size: 11px; color: #94a3b8; }
      .err { color: #fca5a5; }
    </style>
    <div class="wrap">
      <div class="card">
        <div class="title">${title}</div>
        <div class="body">${bodyHtml}</div>
        <div class="row">${buttonsHtml}</div>
        <div class="status" id="fdmPromptStatus"></div>
      </div>
    </div>
  `;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function showBlobHintOnce() {
  const host = location.hostname || "this site";

  chrome.storage.local.get(["videoPlayPrompt", "videoBlobHint"], (st) => {
    if (st.videoPlayPrompt === false) {
      return;
    }
    if (st.videoBlobHint === false) {
      return;
    }
    if (SESSION_BLOB_HINT_HOST.has(host)) {
      return;
    }
    SESSION_BLOB_HINT_HOST.add(host);
    const shadow = getOrCreatePromptShadow();
    shadow.innerHTML = renderPromptHtml(
      "FDM-Enorkity",
      "This player uses an in-browser stream (<code>blob:</code>). The extension cannot turn that into a single file URL for FDM. " +
        "If the site exposes a direct <code>.m3u8</code> or <code>.mp4</code> link (e.g. in Network), copy it and use the context menu or desktop app.",
      `<button type="button" class="ghost" id="fdmBlobOk">OK</button>
       <button type="button" class="danger" id="fdmBlobNever">Don't show this hint again</button>`
    );
    shadow.getElementById("fdmBlobOk").addEventListener("click", () => removePrompt());
    shadow.getElementById("fdmBlobNever").addEventListener("click", () => {
      chrome.storage.local.set({ videoBlobHint: false });
      removePrompt();
    });
  });
}

function showHttpDownloadPrompt(url) {
  chrome.storage.local.get(["videoPlayPrompt", "videoPromptBlockedHosts"], (st) => {
    if (st.videoPlayPrompt === false) {
      return;
    }
    const blocked = Array.isArray(st.videoPromptBlockedHosts) ? st.videoPromptBlockedHosts : [];
    const host = location.hostname;
    if (blocked.includes(host)) {
      return;
    }
    if (SESSION_SHOWN_HTTP.has(url)) {
      return;
    }
    SESSION_SHOWN_HTTP.add(url);

    const shadow = getOrCreatePromptShadow();
    const short = url.length > 120 ? `${escapeHtml(url.slice(0, 120))}…` : escapeHtml(url);
    shadow.innerHTML = renderPromptHtml(
      "Download this video?",
      `Send this URL to <strong>FDM-Enorkity</strong> (localhost).<br/><br/>${short}`,
      `<button type="button" class="primary" id="fdmDl">Download</button>
       <button type="button" class="ghost" id="fdmNo">Not now</button>
       <button type="button" class="danger" id="fdmNever">Never on this site</button>`
    );
    const statusEl = shadow.getElementById("fdmPromptStatus");

    shadow.getElementById("fdmNo").addEventListener("click", () => removePrompt());

    shadow.getElementById("fdmNever").addEventListener("click", () => {
      const next = [...blocked, host];
      chrome.storage.local.set({ videoPromptBlockedHosts: next });
      removePrompt();
    });

    shadow.getElementById("fdmDl").addEventListener("click", async () => {
      statusEl.textContent = "Sending…";
      statusEl.className = "status";
      const ref = window.location.href;
      const res = await sendDownloadNow(url, ref);
      if (res.ok) {
        statusEl.textContent = "Queued in FDM-Enorkity.";
        setTimeout(removePrompt, 2200);
      } else {
        statusEl.className = "status err";
        statusEl.textContent = res.error || "Failed";
      }
    });
  });
}

function onVideoPlay(ev) {
  const video = ev.target;
  if (!(video instanceof HTMLVideoElement)) {
    return;
  }
  const httpUrl = videoHttpUrl(video);
  if (httpUrl) {
    showHttpDownloadPrompt(httpUrl);
    return;
  }
  if (isBlobVideoUrl(video)) {
    showBlobHintOnce();
  }
}

document.addEventListener("play", onVideoPlay, true);

document.addEventListener(
  "click",
  (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const anchor = target.closest("a[href]");
    if (anchor && isLikelyDirectDownload(anchor) && isHttpUrl(anchor.href)) {
      const suggested = anchor.getAttribute("download") || "";
      sendAutoCapture(anchor.href, window.location.href, suggested);
      return;
    }

    const video = target.closest("video");
    if (video) {
      const u = videoHttpUrl(video);
      if (u) {
        sendAutoCapture(u, window.location.href);
      }
    }
  },
  true
);
