/* global CatalystPair */
// CatalystFDM welcome page: opened on install (and when a download needs a connection).
// Starts the one-click connect flow as soon as it loads.

(() => {
  "use strict";

  const P = CatalystPair;
  const ext = P.ns;
  const $ = (id) => document.getElementById(id);
  const IS_FIREFOX = /Firefox\//.test(navigator.userAgent);

  let ctl = null;
  let phase = "";
  let codeShown = "";
  let codeInfo = null;
  let retryAt = 0;
  let waitTimer = 0;

  function setPhase(p) {
    phase = p;
    for (const el of document.querySelectorAll(".card [data-phase]")) {
      el.hidden = el.dataset.phase !== p;
    }
  }

  function setBrowserName(name) {
    for (const el of document.querySelectorAll(".browser-name")) {
      el.textContent = name;
    }
  }

  function mmss(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  function setTiles(code) {
    if (code === codeShown) {
      return;
    }
    codeShown = code;
    const box = $("tiles");
    box.textContent = "";
    for (const d of code) {
      const t = document.createElement("span");
      t.className = "tile";
      t.textContent = d;
      box.appendChild(t);
    }
    box.setAttribute("aria-label", `Connection code ${code.split("").join(" ")}`);
  }

  function tick() {
    if (phase === "code" && codeInfo) {
      const left = codeInfo.expiresAt - Date.now();
      $("waitText").textContent = codeInfo.appUnreachable
        ? "Can't reach CatalystFDM — still trying…"
        : left > 0
          ? `Waiting for approval · code expires in ${mmss(left)}`
          : "Checking…";
    } else if (phase === "offline") {
      const left = retryAt - Date.now();
      $("retryText").textContent = left > 500 ? `Checking again in ${Math.ceil(left / 1000)} s…` : "Checking…";
    }
  }

  function showConnected(connection) {
    clearTimeout(waitTimer);
    waitTimer = 0;
    if (ctl) {
      ctl.cancel();
      ctl = null;
    }
    if (connection && typeof connection.browser_name === "string" && connection.browser_name) {
      setBrowserName(connection.browser_name);
    }
    setPhase("connected");
    document.title = "CatalystFDM is connected";
  }

  function onUpdate(s) {
    switch (s.phase) {
      case "checking":
        setPhase("checking");
        break;
      case "offline":
        retryAt = s.retryAt || 0;
        setPhase("offline");
        tick();
        break;
      case "code":
        setTiles(s.code);
        if (s.browserName) {
          setBrowserName(s.browserName);
        }
        codeInfo = { expiresAt: s.expiresAt, appUnreachable: Boolean(s.appUnreachable) };
        setPhase("code");
        tick();
        break;
      case "connected":
        showConnected(s.connection);
        break;
      case "error":
        $("errText").textContent = s.message || "Something went wrong.";
        setPhase("error");
        break;
      default:
        setPhase(s.phase === "denied" ? "denied" : "expired");
    }
  }

  function start(force) {
    clearTimeout(waitTimer);
    waitTimer = 0;
    if (ctl) {
      ctl.cancel();
    }
    codeShown = "";
    ctl = P.startPairing(onUpdate, { force });
  }

  async function closeTab() {
    try {
      const tab = await ext.tabs.getCurrent();
      if (tab && typeof tab.id === "number") {
        await ext.tabs.remove(tab.id);
        return;
      }
    } catch {
      /* fall back below */
    }
    window.close();
  }

  function bind() {
    for (const b of document.querySelectorAll("[data-action]")) {
      b.addEventListener("click", () => {
        const restart = b.dataset.action === "restart";
        if (waitTimer) {
          clearTimeout(waitTimer);
          waitTimer = 0;
          if (!restart) {
            void checkThenStart().catch(() => {});
            return;
          }
        }
        if (!ctl) {
          start(restart);
        } else if (restart) {
          codeShown = "";
          ctl.restart();
        } else {
          ctl.retry();
        }
      });
    }

    $("doneBtn").addEventListener("click", () => void closeTab());

    const useToken = async () => {
      const btn = $("useToken");
      const msg = $("manualMsg");
      btn.disabled = true;
      msg.className = "adv-msg";
      msg.textContent = "Connecting…";
      try {
        const conn = await P.manualPair({ apiBase: $("apiBase").value, token: $("token").value });
        $("token").value = "";
        msg.textContent = "";
        $("manual").open = false;
        showConnected(conn);
      } catch (e) {
        msg.className = "adv-msg bad";
        msg.textContent = P.errMessage(e);
      } finally {
        btn.disabled = false;
      }
    };
    $("useToken").addEventListener("click", () => void useToken());
    $("token").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void useToken();
      }
    });

    // Connected from the popup (or by token) while this tab waits.
    ext.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.pairingToken && changes.pairingToken.newValue && phase !== "connected") {
        void P.getState().then((st) => showConnected(st.connection));
      }
    });

    setInterval(tick, 1000);
  }

  async function init() {
    if (!P.available()) {
      setPhase("unavailable");
      $("unavailableText").textContent = IS_FIREFOX
        ? "Load the extension from about:debugging → This Firefox → Load Temporary Add-on, then open it from the toolbar."
        : "Load the extension from chrome://extensions → Load unpacked, then open it from the toolbar.";
      $("manual").hidden = true;
      return;
    }
    bind();
    const version = (ext.runtime.getManifest && ext.runtime.getManifest().version) || "";
    $("versionText").textContent = version ? `Version ${version}` : "";
    setPhase("checking");
    setBrowserName(await P.detectBrowserName());
    const st = await P.getState();
    $("apiBase").value = st.apiBase;
    await checkThenStart();
  }

  // Already holding a token while the app is closed: wait for the app and re-check it rather
  // than asking the app to approve this browser a second time.
  async function checkThenStart() {
    const conn = await P.checkConnection();
    if (conn.state === "connected") {
      showConnected(conn.connection);
      return;
    }
    if (conn.state === "offline" && conn.hasToken) {
      retryAt = Date.now() + 3000;
      setPhase("offline");
      tick();
      waitTimer = setTimeout(() => void checkThenStart().catch(() => {}), 3000);
      return;
    }
    start(false);
  }

  void init().catch((e) => {
    $("errText").textContent = P.errMessage(e);
    setPhase("error");
  });
})();
