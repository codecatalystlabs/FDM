/* global chrome */

(() => {
  if (window.__catalystFdmContent) {
    return;
  }
  window.__catalystFdmContent = true;

  // Direct file / stream manifests (http(s) only; blob: is never sent).
  const DIRECT_DOWNLOAD_RE =
    /\.(zip|rar|7z|tar|gz|bz2|xz|iso|exe|msi|dmg|pkg|deb|rpm|apk|mp3|wav|flac|mp4|mkv|avi|mov|webm|m4v|3gp|m3u8|mpd|vtt|srt)(?:$|[?#])/i;
  const MANIFEST_RE = /\.(m3u8|mpd)(?:$|[?#])/i;
  const YT_HOST_RE = /(^|\.)youtube\.com$/i;
  const MUNO_HOST_RE = /(^|\.)munowatch\.com$/i;
  const MIN_VIDEO_W = 240;
  const MIN_VIDEO_H = 135;

  const SESSION_SHOWN = new Set();

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

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
      if (s) {
        try {
          const abs = new URL(s, document.baseURI).href;
          if (isHttpUrl(abs)) {
            return abs;
          }
        } catch {
          /* ignore */
        }
      }
    }
    return "";
  }

  function pageKey() {
    const u = new URL(location.href);
    u.hash = "";
    return u.href;
  }

  function isYouTube() {
    return YT_HOST_RE.test(location.hostname);
  }

  function isYouTubeWatchPage() {
    return isYouTube() && (location.pathname === "/watch" || location.pathname.startsWith("/shorts/"));
  }

  // Decorative background loops and tiny hover previews are not worth a download button.
  function isDecorativeVideo(video) {
    if (video.muted && video.loop && !video.controls) {
      return true;
    }
    const r = video.getBoundingClientRect();
    return r.width < MIN_VIDEO_W || r.height < MIN_VIDEO_H;
  }

  function formatBytes(n) {
    if (typeof n !== "number" || !isFinite(n) || n <= 0) {
      return "";
    }
    const units = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    let v = n;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i++;
    }
    return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
  }

  function formatDuration(sec) {
    if (typeof sec !== "number" || !isFinite(sec) || sec <= 0) {
      return "";
    }
    const s = Math.round(sec);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, "0");
    return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
  }

  function sendMessage(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (resp) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(resp || { ok: false, error: "No response from extension" });
        });
      } catch (e) {
        // "Extension context invalidated" after the extension is reloaded.
        resolve({ ok: false, error: String(e && e.message ? e.message : e) });
      }
    });
  }

  function sendAutoCapture(url, referrer, suggestedFilename) {
    void sendMessage({
      type: "fdm:auto-capture",
      url,
      referrer: referrer || window.location.href,
      pageTitle: document.title || "",
      filename: typeof suggestedFilename === "string" ? suggestedFilename : "",
    });
  }

  function getSettings() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(["videoPlayPrompt", "videoPromptBlockedHosts"], (st) => {
          resolve(st || {});
        });
      } catch {
        resolve({ videoPlayPrompt: false });
      }
    });
  }

  async function promptAllowedHere() {
    const st = await getSettings();
    if (st.videoPlayPrompt === false) {
      return false;
    }
    const blocked = Array.isArray(st.videoPromptBlockedHosts) ? st.videoPromptBlockedHosts : [];
    return !blocked.includes(location.hostname);
  }

  function blockThisHost() {
    try {
      chrome.storage.local.get(["videoPromptBlockedHosts"], (st) => {
        const blocked = Array.isArray(st.videoPromptBlockedHosts) ? st.videoPromptBlockedHosts : [];
        if (!blocked.includes(location.hostname)) {
          chrome.storage.local.set({ videoPromptBlockedHosts: [...blocked, location.hostname] });
        }
      });
    } catch {
      /* ignore */
    }
  }

  // The popup's "Show download button on videos" switch (and "Never on this site") apply live.
  function watchSettings() {
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local") {
          return;
        }
        const vpp = changes.videoPlayPrompt;
        if (vpp && vpp.newValue === false) {
          removePill();
        } else if (vpp && vpp.newValue !== false && vpp.oldValue === false) {
          SESSION_SHOWN.clear(); // offer again on the next play / YouTube check
          lastHref = "";
        }
        const hosts = changes.videoPromptBlockedHosts;
        if (hosts) {
          const list = Array.isArray(hosts.newValue) ? hosts.newValue : [];
          if (list.includes(location.hostname)) {
            removePill();
          } else {
            SESSION_SHOWN.clear();
            lastHref = "";
          }
        }
      });
    } catch {
      /* extension reloaded */
    }
  }

  // ---------------------------------------------------------------------------
  // Icons (inline SVG, lucide-style strokes)
  // ---------------------------------------------------------------------------

  const svg = (body, size = 18) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" ` +
    `stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

  const ICON = {
    download: svg('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>'),
    check: svg('<path d="M20 6 9 17l-5-5"/>'),
    alert: svg('<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>'),
    lock: svg('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
    close: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', 14),
    eyeOff: svg(
      '<path d="M10.73 5.08A10.74 10.74 0 0 1 21.94 11.65a1 1 0 0 1 0 .7 10.75 10.75 0 0 1-1.44 2.49"/>' +
        '<path d="M14.08 14.16a3 3 0 0 1-4.24-4.24"/>' +
        '<path d="M17.48 17.5A10.75 10.75 0 0 1 2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 4.45-5.14"/>' +
        '<path d="m2 2 20 20"/>',
      14
    ),
    music: svg('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>', 14),
    plug: svg('<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>'),
    spinner: '<span class="spin" aria-hidden="true"></span>',
  };

  // Dark glass in both colour schemes: it floats over video, like the system player controls.
  const STYLE = `
    :host { all: initial; }
    .pill {
      position: fixed;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px;
      border-radius: 999px;
      background: rgba(10, 17, 33, 0.56);
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
      border: 1px solid rgba(255, 255, 255, 0.13);
      box-shadow:
        0 1px 2px rgba(0, 0, 0, 0.22),
        0 10px 28px rgba(0, 10, 35, 0.38),
        inset 0 1px 0 rgba(255, 255, 255, 0.10);
      font: 600 11px/1 -apple-system, BlinkMacSystemFont, "SF Pro Text", "DM Sans", "Segoe UI", Roboto, sans-serif;
      letter-spacing: -0.005em;
      color: #e7edf9;
      opacity: 0;
      transform: translateY(-6px) scale(0.96);
      transition: opacity .26s cubic-bezier(.2,.8,.2,1), transform .26s cubic-bezier(.2,.8,.2,1);
      pointer-events: auto;
      user-select: none;
      -webkit-user-select: none;
      max-width: calc(100vw - 24px);
      box-sizing: border-box;
    }
    .pill.in { opacity: 1; transform: none; }
    .pill.idle:not(:hover):not(:focus-within) { opacity: 0.5; }
    .pill.out { opacity: 0; transform: translateY(-6px) scale(0.96); }
    .mark {
      flex: 0 0 auto;
      width: 18px;
      height: 18px;
      margin: 0 1px 0 5px;
      opacity: .92;
      pointer-events: none;
      display: block;
    }
    button {
      all: unset;
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      border-radius: 999px;
      color: inherit;
      transition:
        background .2s cubic-bezier(.2,.8,.2,1),
        transform .2s cubic-bezier(.2,.8,.2,1),
        box-shadow .2s cubic-bezier(.2,.8,.2,1),
        color .2s cubic-bezier(.2,.8,.2,1),
        border-color .2s cubic-bezier(.2,.8,.2,1);
    }
    button:focus-visible { outline: 2px solid #3ea2f0; outline-offset: 2px; }
    button:active { transform: scale(0.94); }
    .main {
      width: 34px;
      height: 34px;
      color: #fff;
      background: linear-gradient(150deg, #3ea2f0 0%, #0b7fd4 52%, #1d4ed8 100%);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28), 0 0 0 0 rgba(62, 162, 240, 0.5);
      animation: pulse 2.6s cubic-bezier(.2,.8,.2,1) 2;
    }
    .main:hover { transform: scale(1.06); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28), 0 6px 18px rgba(11, 127, 212, 0.45); }
    .main:active { transform: scale(0.94); }
    .main[data-state="busy"] { cursor: progress; }
    .main[data-state="ok"] { background: linear-gradient(150deg, #4fd1a0, #067a55); animation: none; }
    .main[data-state="error"] { background: linear-gradient(150deg, #ff8f87, #c42020); animation: none; }
    .main[data-state="drm"] { background: rgba(255, 255, 255, 0.10); color: #f6b65a; cursor: not-allowed; animation: none; }
    .main[data-state="connect"] {
      background: rgba(255, 255, 255, 0.10);
      color: #f6b65a;
      animation: none;
      box-shadow: inset 0 0 0 1.5px rgba(246, 182, 90, 0.6);
    }
    .main[data-state="open"] { animation: none; box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28), 0 0 0 2px rgba(62, 162, 240, 0.4); }
    .mini {
      width: 24px;
      height: 24px;
      color: #aab7d1;
    }
    .mini:hover { background: rgba(255, 255, 255, 0.12); color: #fff; }
    .sep { width: 1px; height: 18px; background: rgba(255, 255, 255, 0.14); margin: 0 1px; flex: 0 0 auto; }
    .chips {
      display: none;
      align-items: center;
      gap: 4px;
      overflow-x: auto;
      scrollbar-width: none;
      max-width: min(520px, calc(100vw - 160px));
      padding-left: 2px;
    }
    .chips::-webkit-scrollbar { display: none; }
    .chips.show { display: flex; animation: grow .26s cubic-bezier(.2,.8,.2,1); }
    .chip {
      flex: 0 0 auto;
      height: 26px;
      min-width: 26px;
      padding: 0 10px;
      gap: 4px;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.12);
      font-weight: 650;
      font-variant-numeric: tabular-nums;
    }
    .chip:hover { background: rgba(255, 255, 255, 0.16); border-color: rgba(62, 162, 240, 0.65); transform: translateY(-1px); }
    .chip:active { transform: scale(0.96); }
    .chip.rec { background: rgba(62, 162, 240, 0.16); border-color: rgba(62, 162, 240, 0.7); color: #cfe7fc; }
    .chip.audio { color: #aab7d1; padding: 0 9px; }
    .chip[data-state="busy"] { cursor: progress; }
    .chip[data-state="ok"] { color: #4fd1a0; border-color: rgba(79, 209, 160, 0.6); }
    .chip[data-state="error"] { color: #ff8f87; border-color: rgba(255, 143, 135, 0.6); }
    .chip .spin { width: 12px; height: 12px; }
    .chip:disabled { opacity: .4; cursor: default; transform: none; }
    .note {
      display: none;
      flex: 0 1 auto;
      min-width: 0;
      padding: 0 6px 0 4px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: min(360px, calc(100vw - 150px));
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      color: #cfe0f7;
    }
    .note.show { display: block; animation: grow .26s cubic-bezier(.2,.8,.2,1); }
    .spin {
      width: 14px;
      height: 14px;
      border-radius: 50%;
      border: 2px solid rgba(255, 255, 255, 0.32);
      border-top-color: #fff;
      animation: rot .8s linear infinite;
      display: inline-block;
      box-sizing: border-box;
    }
    @keyframes rot { to { transform: rotate(360deg); } }
    @keyframes grow { from { opacity: 0; transform: translateX(8px); } to { opacity: 1; transform: none; } }
    @keyframes pulse {
      0% { box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28), 0 0 0 0 rgba(62, 162, 240, 0.5); }
      70% { box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28), 0 0 0 12px rgba(62, 162, 240, 0); }
      100% { box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28), 0 0 0 0 rgba(62, 162, 240, 0); }
    }
    @media (prefers-reduced-motion: reduce) {
      .pill, button, .chips.show, .note.show { transition: none; animation: none; }
      .main { animation: none; }
      .spin { animation-duration: 1.6s; }
    }
  `;

  // ---------------------------------------------------------------------------
  // Floating control
  // ---------------------------------------------------------------------------

  const pill = {
    host: null,
    root: null,
    el: null,
    main: null,
    chips: null,
    note: null,
    video: null,
    key: "",
    mode: "", // "direct" | "media" | "series" (Muno Watch: this episode or the whole series)
    url: "",
    info: null,
    busy: false,
    idleTimer: 0,
    fadeTimer: 0,
    resizeObs: null,
    rafPending: false,
    posTimer: 0,
  };

  function setMain(state, icon, tip) {
    if (!pill.main) {
      return;
    }
    pill.main.dataset.state = state;
    pill.main.innerHTML = icon;
    pill.main.title = tip;
    pill.main.setAttribute("aria-label", tip);
  }

  function idleTip(mode) {
    if (mode === "direct") {
      return "Download with CatalystFDM";
    }
    if (mode === "series") {
      return "Download with CatalystFDM — this episode or the whole series";
    }
    return "Download with CatalystFDM — choose a quality";
  }

  function scheduleIdle() {
    clearTimeout(pill.idleTimer);
    if (pill.el) {
      pill.el.classList.remove("idle");
      pill.idleTimer = setTimeout(() => pill.el && pill.el.classList.add("idle"), 6000);
    }
  }

  function removePill() {
    clearTimeout(pill.idleTimer);
    clearTimeout(pill.fadeTimer);
    clearInterval(pill.posTimer);
    if (pill.resizeObs) {
      pill.resizeObs.disconnect();
    }
    window.removeEventListener("scroll", requestPosition, true);
    window.removeEventListener("resize", requestPosition);
    document.removeEventListener("fullscreenchange", onFullscreenChange);
    if (pill.host && pill.host.parentNode) {
      pill.host.parentNode.removeChild(pill.host);
    }
    Object.assign(pill, {
      host: null,
      root: null,
      el: null,
      main: null,
      chips: null,
      note: null,
      video: null,
      key: "",
      mode: "",
      url: "",
      info: null,
      busy: false,
      resizeObs: null,
    });
  }

  /** A short visible line next to the button (series progress and results); "" hides it. */
  function setNote(text) {
    if (!pill.note) {
      return;
    }
    pill.note.textContent = text;
    pill.note.classList.toggle("show", Boolean(text));
    requestPosition();
  }

  function fadeOutSoon(ms) {
    clearTimeout(pill.fadeTimer);
    pill.fadeTimer = setTimeout(() => {
      if (!pill.el) {
        return;
      }
      pill.el.classList.add("out");
      setTimeout(removePill, 260);
    }, ms);
  }

  function requestPosition() {
    if (pill.rafPending) {
      return;
    }
    pill.rafPending = true;
    requestAnimationFrame(() => {
      pill.rafPending = false;
      positionPill();
    });
  }

  // The part of the video the user can see. Players often make the <video> larger than the
  // frame and clip it (YouTube does for 4:3 clips), so anchor to the clipping ancestors too.
  function visibleRect(v) {
    const r = v.getBoundingClientRect();
    let top = r.top;
    let right = r.right;
    let bottom = r.bottom;
    let left = r.left;
    let player = null; // the first clipping box big enough to be the player frame
    let el = v.parentElement;
    for (let depth = 0; el && depth < 8; depth++, el = el.parentElement) {
      const cs = getComputedStyle(el);
      if (cs.overflow === "visible" && cs.overflowX === "visible" && cs.overflowY === "visible") {
        continue;
      }
      const p = el.getBoundingClientRect();
      if (p.width < MIN_VIDEO_W || p.height < MIN_VIDEO_H) {
        continue;
      }
      player = player || p;
      top = Math.max(top, p.top);
      right = Math.min(right, p.right);
      bottom = Math.min(bottom, p.bottom);
      left = Math.max(left, p.left);
    }
    // Before playback some players park the <video> off-frame and show a poster (YouTube does);
    // the player frame is then the thing the user sees.
    if (player && (bottom - top < MIN_VIDEO_H || right - left < MIN_VIDEO_W)) {
      return player;
    }
    return { top, right, bottom, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
  }

  function positionPill() {
    if (!pill.el) {
      return;
    }
    const s = pill.el.style;
    const v = pill.video;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (v && v.isConnected) {
      const r = visibleRect(v);
      const visible = r.width >= MIN_VIDEO_W && r.height >= MIN_VIDEO_H && r.bottom > 60 && r.top < vh - 60 && r.right > 60 && r.left < vw;
      if (visible) {
        const top = Math.min(Math.max(r.top + 10, 10), Math.max(10, Math.min(r.bottom, vh) - 52));
        const right = Math.max(10, vw - Math.min(r.right, vw) + 10);
        s.top = `${Math.round(top)}px`;
        s.right = `${Math.round(right)}px`;
        s.bottom = "auto";
        return;
      }
    }
    // Fallback: viewport corner.
    s.top = "auto";
    s.right = "16px";
    s.bottom = "16px";
  }

  function onFullscreenChange() {
    if (!pill.host) {
      return;
    }
    const fs = document.fullscreenElement;
    // Elements outside the fullscreen element are not rendered; move inside it when possible.
    const target = fs && !(fs instanceof HTMLVideoElement) ? fs : document.documentElement;
    if (pill.host.parentNode !== target) {
      target.appendChild(pill.host);
    }
    requestPosition();
  }

  // The dragon mark (web_accessible_resources). Purely decorative; dropped if it can't load.
  function brandMark() {
    try {
      const img = document.createElement("img");
      img.className = "mark";
      img.alt = "";
      img.width = 18;
      img.height = 18;
      img.draggable = false;
      img.decoding = "async";
      img.addEventListener("error", () => img.remove(), { once: true });
      img.src = chrome.runtime.getURL("icons/mark-reverse.svg");
      return img;
    } catch {
      return null; // extension reloaded: no runtime
    }
  }

  function createPill(video, mode, url, key) {
    removePill();

    const host = document.createElement("div");
    host.id = "catalystfdm-pill-root";
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `<style>${STYLE}</style>
      <div class="pill" role="toolbar" aria-label="CatalystFDM">
        <div class="chips" role="group" aria-label="${mode === "series" ? "Choose episodes" : "Choose quality"}"></div>
        <span class="note" role="status" aria-live="polite"></span>
        <button type="button" class="main"></button>
        <span class="sep" aria-hidden="true"></span>
        <button type="button" class="mini never" title="Never on this site" aria-label="Never on this site">${ICON.eyeOff}</button>
        <button type="button" class="mini close" title="Dismiss" aria-label="Dismiss">${ICON.close}</button>
      </div>`;

    Object.assign(pill, {
      host,
      root,
      el: root.querySelector(".pill"),
      main: root.querySelector(".main"),
      chips: root.querySelector(".chips"),
      note: root.querySelector(".note"),
      video,
      key,
      mode,
      url,
      info: null,
      busy: false,
    });

    const mark = brandMark();
    if (mark) {
      pill.el.insertBefore(mark, pill.el.firstChild);
    }

    setMain("idle", ICON.download, idleTip(mode));

    pill.main.addEventListener("click", onMainClick);
    root.querySelector(".close").addEventListener("click", removePill);
    root.querySelector(".never").addEventListener("click", () => {
      blockThisHost();
      removePill();
    });
    pill.el.addEventListener("mouseenter", scheduleIdle);
    pill.el.addEventListener("focusin", scheduleIdle);
    // Keep page players from reacting to clicks on the control.
    for (const type of ["click", "mousedown", "pointerdown", "dblclick"]) {
      pill.el.addEventListener(type, (e) => e.stopPropagation());
    }

    const fs = document.fullscreenElement;
    (fs && !(fs instanceof HTMLVideoElement) ? fs : document.documentElement).appendChild(host);

    window.addEventListener("scroll", requestPosition, true);
    window.addEventListener("resize", requestPosition);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    if (video && typeof ResizeObserver !== "undefined") {
      pill.resizeObs = new ResizeObserver(requestPosition);
      pill.resizeObs.observe(video);
    }
    // Layout shifts (theater mode, lazy players) that fire no event.
    pill.posTimer = setInterval(positionPill, 700);

    positionPill();
    requestAnimationFrame(() => pill.el && pill.el.classList.add("in"));
    scheduleIdle();
  }

  async function onMainClick() {
    if (pill.busy) {
      return;
    }
    const state = pill.main.dataset.state;
    if (state === "drm") {
      return;
    }
    if (state === "ok") {
      removePill();
      return;
    }
    if (pill.mode === "direct") {
      await sendDirect();
      return;
    }
    if ((pill.info || pill.mode === "series") && state === "open") {
      // Toggle chips closed.
      pill.chips.classList.remove("show");
      setMain("idle", ICON.download, idleTip(pill.mode));
      return;
    }
    if (pill.mode === "series") {
      openSeriesChips();
      return;
    }
    if (pill.info) {
      openChips();
      return;
    }
    await inspectPage();
  }

  async function sendDirect() {
    pill.busy = true;
    setMain("busy", ICON.spinner, "Sending to CatalystFDM…");
    const res = await sendMessage({
      type: "fdm:download-now",
      url: pill.url,
      referrer: window.location.href,
      pageTitle: document.title || "",
    });
    pill.busy = false;
    if (!pill.el) {
      return;
    }
    if (res.ok) {
      setMain("ok", ICON.check, "Added to CatalystFDM");
      fadeOutSoon(2200);
    } else {
      showFailure(res, "Failed — click to retry");
    }
  }

  // Not connected: background opened the setup tab; clicking again retries once connected.
  function showFailure(res, fallback) {
    if (res && res.code === "not_connected") {
      setMain("connect", ICON.plug, "Connect CatalystFDM first — finish in the tab that just opened, then click again");
      return;
    }
    setMain("error", ICON.alert, (res && res.error) || fallback);
  }

  async function inspectPage() {
    pill.busy = true;
    setMain("busy", ICON.spinner, "Finding qualities…");
    const res = await sendMessage({ type: "fdm:inspect", url: pill.url, referrer: window.location.href });
    pill.busy = false;
    if (!pill.el) {
      return;
    }
    if (!res.ok) {
      showFailure(res, "Couldn't read this video — click to retry");
      return;
    }
    const info = res.data || {};
    if (info.drm) {
      setMain("drm", ICON.lock, "DRM-protected — not supported");
      return;
    }
    if (info.kind === "direct") {
      pill.mode = "direct";
      pill.url = info.url || pill.url;
      await sendDirect();
      return;
    }
    const options = Array.isArray(info.options) ? info.options : [];
    if (info.kind === "playlist" && !(Array.isArray(info.entries) && info.entries.length)) {
      setMain("error", ICON.alert, "This playlist has no downloadable videos");
      return;
    }
    if (!options.length) {
      setMain("error", ICON.alert, "No downloadable formats found");
      return;
    }
    pill.info = info;
    renderChips(info, options);
    openChips();
  }

  function isPlaylist(info) {
    return Boolean(info && info.kind === "playlist" && Array.isArray(info.entries));
  }

  function openChips() {
    pill.chips.classList.add("show");
    const info = pill.info || {};
    if (isPlaylist(info)) {
      const n = info.entries.length;
      const meta = [info.title, `${n} video${n === 1 ? "" : "s"}`].filter(Boolean).join(" · ");
      setMain("open", ICON.download, `${meta} — pick a quality for every video`);
    } else {
      const meta = [info.title, info.site, formatDuration(info.duration_seconds)].filter(Boolean).join(" · ");
      setMain("open", ICON.download, meta ? `${meta} — pick a quality` : "Pick a quality");
    }
    scheduleIdle();
    requestPosition();
  }

  function optionTip(opt) {
    const size = formatBytes(opt.size_bytes);
    return [opt.label, opt.detail, size ? `~${size}` : "", opt.recommended ? "recommended" : ""]
      .filter(Boolean)
      .join(" · ");
  }

  function renderChips(info, options) {
    pill.chips.textContent = "";
    const video = options.filter((o) => o.kind !== "audio");
    const audio = options.filter((o) => o.kind === "audio");
    // Keep the row short: drop sub-360p unless nothing else exists.
    const tall = video.filter((o) => !o.height || o.height >= 360 || o.recommended);
    const shown = [...(tall.length ? tall : video).slice(0, 7), ...audio.slice(0, 2)];

    for (const opt of shown) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `chip${opt.recommended ? " rec" : ""}${opt.kind === "audio" ? " audio" : ""}`;
      const tip = optionTip(opt);
      b.title = tip;
      b.setAttribute("aria-label", tip);
      if (opt.kind === "audio") {
        b.innerHTML = ICON.music;
        const t = document.createElement("span");
        t.textContent = opt.label || "Audio";
        b.appendChild(t);
      } else {
        b.textContent = opt.label || (opt.height ? `${opt.height}p` : "Best");
      }
      b.addEventListener("click", () => void chooseOption(b, opt, info));
      pill.chips.appendChild(b);
    }
  }

  async function chooseOption(chip, opt, info) {
    if (pill.busy) {
      return;
    }
    pill.busy = true;
    // Keep the chip's own nodes (built with textContent) and swap them back afterwards.
    const saved = Array.from(chip.childNodes);
    chip.dataset.state = "busy";
    chip.innerHTML = ICON.spinner;
    const playlist = isPlaylist(info);
    const res = playlist
      ? await sendMessage({
          type: "fdm:add-playlist",
          entries: info.entries,
          quality_id: opt.id,
          referrer: window.location.href,
          pageTitle: document.title || "",
          site: info.site || "",
          playlistUrl: info.url || pill.url,
        })
      : await sendMessage({
          type: "fdm:add-media",
          url: info.url || pill.url,
          referrer: window.location.href,
          pageTitle: document.title || "",
          quality_id: opt.id,
          title: info.title || "",
          thumbnail: info.thumbnail || "",
          site: info.site || "",
          duration_seconds: info.duration_seconds || 0,
          size_bytes: typeof opt.size_bytes === "number" ? opt.size_bytes : -1,
        });
    pill.busy = false;
    if (!pill.el) {
      return;
    }
    chip.textContent = "";
    chip.append(...saved);
    if (res.ok) {
      chip.dataset.state = "ok";
      pill.chips.classList.remove("show");
      let tip = `Added ${opt.label || "video"} to CatalystFDM`;
      if (playlist && res.data) {
        const q = res.data.queued || 0;
        const total = res.data.total || q;
        tip = q === total ? `Added ${q} video${q === 1 ? "" : "s"} (${opt.label}) to CatalystFDM` : `Added ${q} of ${total} videos (${opt.label}) to CatalystFDM`;
      }
      setMain("ok", ICON.check, tip);
      fadeOutSoon(2400);
    } else if (res.code === "not_connected") {
      chip.dataset.state = "";
      pill.chips.classList.remove("show");
      pill.info = null; // inspect again once connected
      showFailure(res);
    } else {
      chip.dataset.state = "error";
      const tip = res.error || "Failed";
      chip.title = tip;
      chip.setAttribute("aria-label", tip);
    }
  }

  // ---------------------------------------------------------------------------
  // Muno Watch series: this episode, every episode, or one of the site's ranges.
  // Uses the endpoints behind the site's own "56 Episodes" button, then reads each episode
  // page with the user's session; the video URL is the one that page's player loads.
  // ---------------------------------------------------------------------------

  const MUNO_SITE = "Muno Watch";
  // The site answers a burst of about ten page loads with its home page for up to a minute, so
  // episode pages are read one at a time, a few seconds apart, and it cools down when asked.
  const MUNO_PACE_MS = 3000;
  const MUNO_COOLDOWNS = [30, 45, 60]; // seconds
  const MUNO_CHUNK = 4; // queued every few episodes, so downloads start early and stay in order
  const muno = { probe: null, series: null };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function isMunoEpisodePage() {
    return MUNO_HOST_RE.test(location.hostname) && location.pathname === "/twolekede";
  }

  // Firefox runs content-script fetch as the extension; content.fetch sends it as the page.
  function pageFetch(url, init) {
    /* global content */
    const f = typeof content !== "undefined" && content && content !== window && typeof content.fetch === "function" ? content.fetch.bind(content) : fetch;
    return f(url, Object.assign({ credentials: "include", cache: "no-store" }, init));
  }

  async function munoXhr(path, params) {
    // The site answers its list endpoints with HTTP 500 unless they look like its own XHR.
    const res = await pageFetch(`${path}?${new URLSearchParams(params)}`, { headers: { "X-Requested-With": "XMLHttpRequest" } });
    if (!res.ok) {
      throw new Error(`Muno Watch replied with HTTP ${res.status}`);
    }
    return res.text();
  }

  const parseHtml = (html) => new DOMParser().parseFromString(html, "text/html");

  /** {vidid, ranges: [{key, from, to}], total} for a series page; null for a movie. */
  async function munoProbeSeries() {
    const soul = document.getElementById("soul-info");
    const vidid = soul ? soul.dataset.vidid || "" : "";
    const code = soul ? soul.dataset.seriesCode || "" : "";
    if (!/^\d+$/.test(vidid) || !code) {
      return null;
    }
    const doc = parseHtml(await munoXhr("/episoderanges", { video_id: vidid, series_code: code }));
    const ranges = [];
    for (const b of doc.querySelectorAll("button[onclick]")) {
      const m = /fetchMoreEpisodes\('(\d+__\d+)'\)/.exec(b.getAttribute("onclick") || "");
      if (!m) {
        continue;
      }
      // Labels read "1- 20", " 21- 40", or "-  8" for a short series.
      const nums = (b.textContent.match(/\d+/g) || []).map(Number);
      const prevTo = ranges.length ? ranges[ranges.length - 1].to : 0;
      const to = nums.length ? nums[nums.length - 1] : 0;
      ranges.push({ key: m[1], from: nums.length > 1 ? nums[0] : prevTo + 1, to });
    }
    if (!ranges.length) {
      return null;
    }
    return { vidid, ranges, total: ranges[ranges.length - 1].to };
  }

  function munoSeries() {
    if (!muno.probe) {
      muno.probe = munoProbeSeries()
        .catch(() => null)
        .then((s) => (muno.series = s));
    }
    return muno.probe;
  }

  /** Episodes of one range, in order: [{id, pageUrl, thumbnail}]. Only this site's episode pages. */
  async function munoListRange(series, range) {
    const doc = parseHtml(await munoXhr("/moreepisodes", { epsRange: range.key, currentId: series.vidid }));
    const out = [];
    for (const a of doc.querySelectorAll("a[href]")) {
      let u;
      try {
        u = new URL(a.getAttribute("href"), location.href);
      } catch {
        continue;
      }
      if (u.origin !== location.origin || u.pathname !== "/twolekede") {
        continue;
      }
      const tile = a.querySelector("[id]");
      out.push({ id: tile ? tile.id : "", pageUrl: u.href, thumbnail: imageUrl(a.querySelector("img")) });
    }
    return out;
  }

  function imageUrl(img) {
    try {
      const u = img ? new URL(img.getAttribute("src") || "", location.href).href : "";
      return isHttpUrl(u) ? u : "";
    } catch {
      return "";
    }
  }

  /** The page's video URL: the player's src, else the base64 copy the player reads it from. */
  function munoVideoUrl(doc) {
    const v = doc.getElementById("video-component");
    let url = v instanceof HTMLVideoElement && doc === document ? videoHttpUrl(v) : (v && v.getAttribute("src")) || "";
    const soul = doc.getElementById("soul-info");
    if (!isHttpUrl(url) && soul && soul.dataset.gumite) {
      try {
        url = atob(soul.dataset.gumite).trim();
      } catch {
        url = "";
      }
    }
    return isHttpUrl(url) ? url : "";
  }

  // "Heroes 2 by Vj Junior"; some pages have no VJ and end in a bare " by".
  function cleanEpisodeTitle(t) {
    return String(t || "")
      .replace(/\s+/g, " ")
      .replace(/\s+by\s*$/i, "")
      .trim()
      .slice(0, 200);
  }

  /**
   * {ok, url, name} for an episode page. An episode page without a video isn't playable on this
   * account ({ok: false}); any other page, the site's home page, means slow down ({busy: true}).
   */
  async function munoReadEpisode(ep) {
    let html = "";
    try {
      const res = await pageFetch(ep.pageUrl);
      html = res.ok ? await res.text() : "";
    } catch {
      html = "";
    }
    const doc = parseHtml(html);
    const url = munoVideoUrl(doc);
    if (url) {
      return { ok: true, url, name: cleanEpisodeTitle(doc.title) };
    }
    return { ok: false, busy: !doc.getElementById("soul-info") };
  }

  function episodeItem(url, pageUrl, name, thumbnail) {
    return {
      url,
      referrer: pageUrl,
      pageTitle: name,
      title: name,
      thumbnail,
      site: MUNO_SITE,
      engine: MANIFEST_RE.test(url) ? "media" : "",
    };
  }

  async function sendEpisodes(items) {
    const res = await sendMessage({ type: "fdm:add-batch", items });
    if (!res.ok) {
      throw Object.assign(new Error(res.error || "Couldn't reach CatalystFDM"), { code: res.code || "" });
    }
    return res.data || {};
  }

  /** Reads and queues the episodes of the given ranges in order. Episodes already saved are skipped. */
  async function queueEpisodes(series, ranges, onProgress) {
    const seen = new Set();
    const eps = [];
    for (const r of ranges) {
      for (const ep of await munoListRange(series, r)) {
        const k = ep.id || ep.pageUrl;
        if (!seen.has(k)) {
          seen.add(k);
          eps.push(ep);
        }
      }
    }
    if (!eps.length) {
      throw new Error("Muno Watch didn't list any episodes — reload the page and try again.");
    }
    const total = eps.length;
    const sum = { total, queued: 0, skipped: 0, failed: 0, unread: 0, left: 0, error: "" };
    const names = new Set();
    let pending = [];
    const flush = async () => {
      if (!pending.length) {
        return;
      }
      const got = await sendEpisodes(pending);
      pending = [];
      sum.queued += got.queued || 0;
      sum.skipped += got.skipped || 0;
      sum.failed += got.failed || 0;
      sum.error = sum.error || got.error || "";
    };
    const cooldown = async (i, secs) => {
      for (let left = secs; left > 0; left--) {
        onProgress(i, total, left);
        await sleep(1000);
      }
    };
    let lastRead = 0;
    for (let i = 0; i < total; i++) {
      onProgress(i, total);
      await sleep(Math.max(0, lastRead + MUNO_PACE_MS - Date.now()));
      lastRead = Date.now();
      let r = await munoReadEpisode(eps[i]);
      for (let w = 0; !r.ok && r.busy && w < MUNO_COOLDOWNS.length; w++) {
        await flush(); // what's read so far starts downloading meanwhile
        await cooldown(i, MUNO_COOLDOWNS[w]);
        lastRead = Date.now();
        r = await munoReadEpisode(eps[i]);
      }
      if (!r.ok && i === 0 && !r.busy) {
        throw new Error("Couldn't open the episodes — check you're signed in to Muno Watch with an active plan.");
      }
      if (!r.ok && r.busy) {
        // Still refused after cooling down: keep what's queued; "All" again skips those and goes on.
        sum.left = total - i;
        break;
      }
      if (!r.ok) {
        sum.unread++;
        continue;
      }
      // Names decide the file name and the "already saved" check, so they must differ.
      let name = r.name || `Episode ${i + 1}`;
      if (names.has(name.toLowerCase())) {
        name = `${name} (episode ${i + 1})`;
      }
      names.add(name.toLowerCase());
      pending.push(episodeItem(r.url, eps[i].pageUrl, name, eps[i].thumbnail));
      if (pending.length >= MUNO_CHUNK || i === 0) {
        await flush(); // the first one at once: it checks CatalystFDM is connected before the long part
      }
    }
    await flush();
    if (sum.left && !sum.queued && !sum.skipped) {
      throw new Error("Muno Watch is refusing requests right now — wait a few minutes, then try again.");
    }
    return sum;
  }

  function munoCurrentItem() {
    const url = munoVideoUrl(document);
    if (!url) {
      throw new Error("Couldn't find this episode's video — press play, then try again.");
    }
    const soul = document.getElementById("soul-info");
    const tile = soul && soul.dataset.vidid ? document.getElementById(soul.dataset.vidid) : null;
    const name = cleanEpisodeTitle(document.title) || "Muno Watch episode";
    return episodeItem(url, location.href, name, imageUrl(tile && tile.querySelector("img")));
  }

  function rangeLabel(r, i) {
    return r.to ? `${r.from}–${r.to}` : `Part ${i + 1}`;
  }

  function renderSeriesChips(s) {
    pill.chips.textContent = "";
    const add = (label, tip, extra, pick) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `chip${extra ? ` ${extra}` : ""}`;
      b.textContent = label;
      b.title = tip;
      b.setAttribute("aria-label", tip);
      b.addEventListener("click", () => void chooseEpisodes(b, pick));
      pill.chips.appendChild(b);
    };
    add("This episode", "Download just this episode", "", { one: true });
    add(s.total ? `All ${s.total}` : "All episodes", s.total ? `Download all ${s.total} episodes, in order` : "Download every episode, in order", "rec", {
      ranges: s.ranges,
    });
    if (s.ranges.length > 1) {
      s.ranges.forEach((r, i) => add(rangeLabel(r, i), r.to ? `Download episodes ${r.from} to ${r.to}` : "Download this part", "", { ranges: [r] }));
    }
  }

  function openSeriesChips() {
    const s = muno.series;
    if (!s) {
      return;
    }
    renderSeriesChips(s);
    pill.chips.classList.add("show");
    setNote("");
    const what = s.total ? `${s.total} episodes` : "This series";
    setMain("open", ICON.download, `${what} — download this episode, all of them, or a range`);
    scheduleIdle();
    requestPosition();
  }

  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

  function episodesSummary(r, one) {
    if (one) {
      return r.queued ? "Added this episode" : r.skipped ? "Already in CatalystFDM" : r.error || "Couldn't add this episode";
    }
    const parts = [];
    if (r.queued) {
      parts.push(`Added ${plural(r.queued, "episode")}`);
    }
    if (r.skipped) {
      const all = !r.queued && !r.unread && !r.failed && !r.left;
      parts.push(all ? `All ${r.skipped} already in CatalystFDM` : `${r.skipped} already in CatalystFDM`);
    }
    if (r.unread) {
      parts.push(`${r.unread} couldn't be opened`);
    }
    if (r.failed) {
      parts.push(`${r.failed} failed`);
    }
    if (r.left) {
      parts.push(`${r.left} left — try again in a few minutes`);
    }
    return parts.join(" · ") || "Nothing to add";
  }

  async function chooseEpisodes(chip, pick) {
    if (pill.busy) {
      return;
    }
    pill.busy = true;
    const others = Array.from(pill.chips.querySelectorAll(".chip")).filter((b) => b !== chip);
    others.forEach((b) => (b.disabled = true));
    chip.dataset.state = "busy";
    chip.innerHTML = ICON.spinner;
    setMain("busy", ICON.spinner, "Adding episodes to CatalystFDM…");
    let result = null;
    let failure = null;
    try {
      if (pick.one) {
        setNote("Sending this episode…");
        result = await sendEpisodes([munoCurrentItem()]);
      } else {
        setNote("Finding episodes…");
        result = await queueEpisodes(muno.series, pick.ranges, (done, total, waitSec) => {
          if (waitSec) {
            setNote(`Muno Watch asked to slow down — continuing in ${waitSec}s (${done} of ${total})`);
          } else {
            setNote(`Reading episode ${Math.min(done + 1, total)} of ${total} · keep this tab open`);
          }
          scheduleIdle();
        });
      }
    } catch (e) {
      failure = { error: (e && e.message) || "Failed", code: (e && e.code) || "" };
    }
    pill.busy = false;
    if (!pill.el) {
      return; // dismissed meanwhile; the episodes read so far were still queued
    }
    others.forEach((b) => (b.disabled = false));
    renderSeriesChips(muno.series);
    if (failure) {
      setNote(failure.code === "not_connected" ? "" : failure.error);
      if (failure.code === "not_connected") {
        pill.chips.classList.remove("show");
      }
      showFailure(failure, "Failed — click to try again");
      return;
    }
    const summary = episodesSummary(result, Boolean(pick.one));
    pill.chips.classList.remove("show");
    setNote(summary);
    if (!result.queued && !result.skipped) {
      setMain("error", ICON.alert, result.error || summary);
      return;
    }
    setMain("ok", ICON.check, result.queued ? `${summary} — queued in order in CatalystFDM` : summary);
    fadeOutSoon(6000);
  }

  async function offerMunoSeries(video) {
    const key = `series:${muno.series.vidid}`;
    if (pill.el && pill.key === key) {
      if (video && pill.video !== video) {
        pill.video = video;
        if (pill.resizeObs) {
          pill.resizeObs.disconnect();
          pill.resizeObs.observe(video);
        }
      }
      requestPosition();
      return;
    }
    if (SESSION_SHOWN.has(key) || !(await promptAllowedHere()) || SESSION_SHOWN.has(key)) {
      return;
    }
    SESSION_SHOWN.add(key);
    createPill(video instanceof HTMLVideoElement ? video : null, "series", "", key);
  }

  // ---------------------------------------------------------------------------
  // Triggers
  // ---------------------------------------------------------------------------

  async function offerForVideo(video, opts) {
    if (!(video instanceof HTMLVideoElement)) {
      return;
    }
    const force = Boolean(opts && opts.page);
    if (isYouTube() && !isYouTubeWatchPage()) {
      return; // home-feed hover previews
    }
    if (isMunoEpisodePage() && (await promptAllowedHere()) && (await munoSeries())) {
      await offerMunoSeries(video); // "This episode" is one of its choices
      return;
    }
    if (!force && isDecorativeVideo(video)) {
      return;
    }
    const direct = videoHttpUrl(video);
    let mode;
    let url;
    if (direct && !MANIFEST_RE.test(direct) && !force) {
      mode = "direct";
      url = direct;
    } else if (direct && MANIFEST_RE.test(direct)) {
      mode = "media";
      url = direct;
    } else {
      mode = "media";
      url = pageKey();
    }
    const key = `${mode}:${url}`;
    if (pill.el && pill.key === key) {
      if (pill.video !== video) {
        pill.video = video;
        if (pill.resizeObs) {
          pill.resizeObs.disconnect();
          pill.resizeObs.observe(video);
        }
      }
      requestPosition();
      return;
    }
    if (SESSION_SHOWN.has(key)) {
      return;
    }
    if (!(await promptAllowedHere())) {
      return;
    }
    if (SESSION_SHOWN.has(key)) {
      return;
    }
    SESSION_SHOWN.add(key);
    createPill(video, mode, url, key);
  }

  function onVideoPlay(ev) {
    void offerForVideo(ev.target);
  }

  document.addEventListener("play", onVideoPlay, true);

  // YouTube: offer on watch pages even when autoplay fired before injection (and after SPA navigation).
  let lastHref = "";
  let ytProbeTimer = 0;
  function checkYouTubePage() {
    if (!isYouTube() || location.href === lastHref) {
      return;
    }
    lastHref = location.href;
    if (pill.el && pill.mode === "media" && pill.key !== `media:${pageKey()}`) {
      removePill(); // previous video's control
    }
    if (!isYouTubeWatchPage()) {
      return;
    }
    clearInterval(ytProbeTimer);
    let tries = 0;
    ytProbeTimer = setInterval(() => {
      tries++;
      const v = document.querySelector("#movie_player video, ytd-player video, video.html5-main-video, video");
      if (v && v.getBoundingClientRect().width >= MIN_VIDEO_W) {
        clearInterval(ytProbeTimer);
        void offerForVideo(v, { page: true });
      } else if (tries > 20) {
        clearInterval(ytProbeTimer);
      }
    }, 500);
  }

  if (isYouTube()) {
    document.addEventListener("yt-navigate-finish", checkYouTubePage);
    window.addEventListener("popstate", checkYouTubePage);
    setInterval(checkYouTubePage, 1500);
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", checkYouTubePage, { once: true });
    } else {
      checkYouTubePage();
    }
  }

  // Muno Watch: offer the series as soon as an episode page loads, not only once it plays.
  if (isMunoEpisodePage()) {
    const offerSeries = async () => {
      if (!(await promptAllowedHere()) || !(await munoSeries())) {
        return;
      }
      await offerMunoSeries(document.getElementById("video-component"));
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => void offerSeries(), { once: true });
    } else {
      void offerSeries();
    }
  }

  watchSettings();

  // Auto-capture of clicked direct links (opt-in from the popup).
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
})();
