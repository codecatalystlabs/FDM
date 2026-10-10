/* global CatalystPair */
// CatalystFDM toolbar popup. Connection logic lives in pair.js; downloads go through
// background.js (the same handler the context menu uses).

(() => {
  "use strict";

  const P = CatalystPair;
  const ext = P.ns;
  const $ = (id) => document.getElementById(id);
  const VIEWS = ["v-loading", "v-connect", "v-pair", "v-main"];
  const IS_FIREFOX = /Firefox\//.test(navigator.userAgent);

  let pairCtl = null;
  let pairPhase = "";
  let codeShown = "";
  let codeInfo = null; // {expiresAt, appUnreachable}
  let retryAt = 0;
  let activeTab = null;
  let tabOk = false;
  let disconnectArmed = 0;
  let renderSeq = 0;

  function show(id) {
    for (const v of VIEWS) {
      $(v).hidden = v !== id;
    }
  }

  function currentView() {
    return VIEWS.find((v) => !$(v).hidden) || "";
  }

  /** level: "ok" | "warn" | "" */
  function setStatus(level, text) {
    $("dot").className = `dot${level ? ` ${level}` : ""}`;
    $("statusText").textContent = text;
  }

  function setAdvMsg(text, tone) {
    const el = $("advMsg");
    el.textContent = text || "";
    el.className = `adv-msg${tone ? ` ${tone}` : ""}`;
  }

  function mmss(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  function hostOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  }

  // ---------------------------------------------------------------------------
  // Settings (Advanced + toggle)
  // ---------------------------------------------------------------------------

  async function loadSettings() {
    const st = await ext.storage.local.get([
      "apiBase",
      "autoCaptureDirectLinks",
      "videoPlayPrompt",
      "videoPromptBlockedHosts",
      "lastSentUrl",
      "pairingToken",
      "pairMethod",
    ]);
    const base = await P.getState();
    $("apiBase").value = base.apiBase;
    $("videoPlayPrompt").checked = st.videoPlayPrompt !== false;
    $("autoCaptureDirectLinks").checked = Boolean(st.autoCaptureDirectLinks);
    $("token").placeholder =
      st.pairingToken && st.pairMethod === "manual" ? "Token saved — paste a new one to replace it" : "Paste the token from CatalystFDM";
    const hidden = Array.isArray(st.videoPromptBlockedHosts) ? st.videoPromptBlockedHosts : [];
    $("hiddenRow").hidden = hidden.length === 0;
    $("hiddenText").textContent = `Button hidden on ${hidden.length} site${hidden.length === 1 ? "" : "s"}`;
    $("hiddenText").title = hidden.join(", ");
    $("lastRow").hidden = !st.lastSentUrl;
    $("lastSent").textContent = st.lastSentUrl || "";
    $("lastSent").title = st.lastSentUrl || "";
    $("disconnectBtn").hidden = !base.pairingToken;
    const version = (ext.runtime.getManifest && ext.runtime.getManifest().version) || "";
    $("versionText").textContent = `Version ${version} · browser id ${String(base.extensionId).slice(0, 8)}`;
  }

  // ---------------------------------------------------------------------------
  // Views
  // ---------------------------------------------------------------------------

  function renderUnavailable() {
    show("v-connect");
    setStatus("", "Unavailable");
    $("storageNote").hidden = false;
    $("storageText").textContent = IS_FIREFOX
      ? "Open this panel from the CatalystFDM toolbar button (about:debugging → Load Temporary Add-on)."
      : "Open this panel from the CatalystFDM toolbar button (chrome://extensions → Load unpacked).";
    $("connectBtn").disabled = true;
    $("advanced").hidden = true;
  }

  async function render() {
    const seq = ++renderSeq;
    const pending = await P.readPending().catch(() => null);
    const st = await P.checkConnection();
    if (seq !== renderSeq) {
      return; // a newer render started meanwhile
    }
    const state = await P.getState();
    const name = (st.connection && st.connection.browser_name) || state.browserName || (await P.detectBrowserName());
    await loadSettings();
    if (st.state === "connected" || (st.state === "offline" && st.hasToken)) {
      await showMain(st.state === "offline", name);
      return;
    }
    if (pending && pending.expiresAt > Date.now() + 5000) {
      beginPair(false);
      return;
    }
    show("v-connect");
    const { revokedAt } = await ext.storage.local.get(["revokedAt"]);
    $("revokedNote").hidden = !(st.revoked || revokedAt);
    if (st.state === "offline") {
      setStatus("warn", "CatalystFDM isn't running");
    } else {
      setStatus("", "Not connected");
    }
  }

  async function showMain(offline, name) {
    show("v-main");
    setStatus(offline ? "warn" : "ok", offline ? "CatalystFDM isn't running" : `Connected · ${name}`);
    $("offlineNote").hidden = !offline;
    const { lastError } = await ext.storage.local.get(["lastError"]);
    $("errNote").hidden = !lastError;
    $("errText").textContent = lastError || "";
    await loadActiveTab();
  }

  async function loadActiveTab() {
    activeTab = null;
    try {
      const tabs = await ext.tabs.query({ active: true, currentWindow: true });
      activeTab = (tabs && tabs[0]) || null;
    } catch {
      activeTab = null;
    }
    const url = activeTab && activeTab.url;
    tabOk = Boolean(url && /^https?:\/\//i.test(url));
    $("dlBtn").disabled = !tabOk;
    const info = $("tabInfo");
    if (!tabOk) {
      info.textContent = "Open a page with a video to download it.";
      info.title = "";
      return;
    }
    const host = hostOf(url);
    const title = (activeTab.title || "").trim();
    info.textContent = title ? `${host} · ${title}` : host;
    info.title = title || url;
  }

  // ---------------------------------------------------------------------------
  // Connect flow
  // ---------------------------------------------------------------------------

  function beginPair(force) {
    show("v-pair");
    setStatus("", "Connecting…");
    if (pairCtl) {
      pairCtl.cancel();
    }
    codeShown = "";
    pairCtl = P.startPairing(onPair, { force });
  }

  function setTiles(code) {
    if (code === codeShown) {
      return; // keep the entrance animation from replaying on every poll
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

  function onPair(s) {
    pairPhase = s.phase;
    for (const el of document.querySelectorAll("#v-pair [data-phase]")) {
      el.hidden = el.dataset.phase !== s.phase;
    }
    const terminal = s.phase === "denied" || s.phase === "expired" || s.phase === "error";
    $("cancelPair").textContent = terminal ? "Back" : "Cancel";
    $("cancelPair").hidden = s.phase === "connected";
    switch (s.phase) {
      case "code":
        setTiles(s.code);
        codeInfo = { expiresAt: s.expiresAt, appUnreachable: Boolean(s.appUnreachable) };
        setStatus("warn", "Waiting for approval");
        tick();
        break;
      case "offline":
        retryAt = s.retryAt || 0;
        setStatus("warn", "CatalystFDM isn't running");
        tick();
        break;
      case "connected":
        setStatus("ok", "Connected");
        setTimeout(() => void render(), 900);
        break;
      case "error":
        $("pairError").textContent = s.message || "Something went wrong.";
        setStatus("", "Not connected");
        break;
      case "denied":
      case "expired":
        setStatus("", "Not connected");
        break;
      default:
        break;
    }
  }

  function tick() {
    if (pairPhase === "code" && codeInfo) {
      const left = codeInfo.expiresAt - Date.now();
      $("waitText").textContent = codeInfo.appUnreachable
        ? "Can't reach CatalystFDM — still trying…"
        : left > 0
          ? `Waiting for approval · ${mmss(left)}`
          : "Checking…";
    } else if (pairPhase === "offline") {
      const left = retryAt - Date.now();
      $("retryText").textContent = left > 500 ? `Checking again in ${Math.ceil(left / 1000)} s…` : "Checking…";
    }
  }

  // ---------------------------------------------------------------------------
  // Download on this tab
  // ---------------------------------------------------------------------------

  function setBusy(busy, label) {
    $("dlBtn").disabled = busy || !tabOk;
    $("dlIcon").hidden = busy;
    $("dlSpin").hidden = !busy;
    $("dlLabel").textContent = label || "Download video on this tab";
  }

  function showResult(ok, title, detail) {
    const box = $("result");
    box.hidden = false;
    box.className = `notice result ${ok ? "ok" : "danger"}`;
    $("resOk").hidden = !ok;
    $("resErr").hidden = ok;
    $("resTitle").textContent = title;
    $("resDetail").textContent = detail || "";
  }

  async function downloadThisTab() {
    if (!tabOk) {
      return;
    }
    $("result").hidden = true;
    $("playlist").hidden = true;
    setBusy(true, "Finding the best quality…");
    const res = await P.send({ type: "fdm:download-page", url: activeTab.url, pageTitle: activeTab.title || "" });
    setBusy(false);
    if (!res.ok) {
      if (res.code === "not_connected") {
        await render();
        return;
      }
      showResult(false, "Couldn't download", res.error || "Something went wrong.");
      return;
    }
    const d = res.data || {};
    if (d.kind === "playlist" && d.needsChoice) {
      showPlaylist(d);
      return;
    }
    if (d.kind === "playlist") {
      showResult(true, `Added ${d.queued} video${d.queued === 1 ? "" : "s"} to CatalystFDM`, [d.title, d.quality].filter(Boolean).join(" · "));
      return;
    }
    showResult(true, "Added to CatalystFDM", [d.title, d.quality].filter(Boolean).join(" · "));
  }

  function showPlaylist(d) {
    $("playlist").hidden = false;
    $("plTitle").textContent = d.title || "Playlist";
    $("plTitle").title = d.title || "";
    $("plCount").textContent = `${d.count} video${d.count === 1 ? "" : "s"}`;
    const box = $("plChips");
    box.textContent = "";
    for (const opt of d.options || []) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `chip${opt.recommended ? " rec" : ""}`;
      b.textContent = opt.label || opt.id;
      b.title = [opt.label, opt.detail].filter(Boolean).join(" · ");
      b.addEventListener("click", () => void queuePlaylist(d, opt, b));
      box.appendChild(b);
    }
  }

  async function queuePlaylist(d, opt, chip) {
    const chips = Array.from($("plChips").children);
    chips.forEach((c) => (c.disabled = true));
    const spin = document.createElement("span");
    spin.className = "spin";
    chip.prepend(spin);
    const res = await P.send({
      type: "fdm:add-playlist",
      entries: d.entries,
      quality_id: opt.id,
      referrer: activeTab ? activeTab.url : d.url,
      pageTitle: activeTab ? activeTab.title || "" : "",
      site: d.site,
      playlistUrl: d.url,
    });
    spin.remove();
    chips.forEach((c) => (c.disabled = false));
    if (!res.ok) {
      if (res.code === "not_connected") {
        await render();
        return;
      }
      showResult(false, "Couldn't add the playlist", res.error || "Something went wrong.");
      return;
    }
    $("playlist").hidden = true;
    const q = (res.data && res.data.queued) || 0;
    const total = (res.data && res.data.total) || q;
    showResult(
      true,
      q === total ? `Added ${q} video${q === 1 ? "" : "s"} to CatalystFDM` : `Added ${q} of ${total} videos`,
      [d.title, opt.label].filter(Boolean).join(" · ")
    );
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  function bind() {
    $("connectBtn").addEventListener("click", () => beginPair(false));

    $("cancelPair").addEventListener("click", () => {
      if (pairCtl) {
        pairCtl.cancel(); // a pending request is still collected in the background if allowed later
        pairCtl = null;
      }
      pairPhase = "";
      void render();
    });

    for (const b of document.querySelectorAll("#v-pair [data-action]")) {
      b.addEventListener("click", () => {
        if (!pairCtl) {
          beginPair(b.dataset.action === "restart");
          return;
        }
        if (b.dataset.action === "restart") {
          codeShown = "";
          pairCtl.restart();
        } else {
          pairCtl.retry();
        }
      });
    }

    $("dlBtn").addEventListener("click", () => void downloadThisTab());

    $("errDismiss").addEventListener("click", async () => {
      $("errNote").hidden = true;
      await ext.storage.local.set({ lastError: "" });
    });

    $("videoPlayPrompt").addEventListener("change", (e) => {
      void ext.storage.local.set({ videoPlayPrompt: e.target.checked });
    });

    $("autoCaptureDirectLinks").addEventListener("change", (e) => {
      void ext.storage.local.set({ autoCaptureDirectLinks: e.target.checked });
    });

    const saveBase = async () => {
      try {
        const base = P.normalizeApiBase($("apiBase").value);
        const cur = (await P.getState()).apiBase;
        $("apiBase").value = base;
        if (base === cur) {
          return;
        }
        await ext.storage.local.set({ apiBase: base });
        setAdvMsg("Address saved.", "good");
        if (currentView() !== "v-pair") {
          await render();
        }
      } catch (e) {
        setAdvMsg(P.errMessage(e), "bad");
      }
    };
    $("apiBase").addEventListener("change", () => void saveBase());
    $("apiBase").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void saveBase();
      }
    });

    const useToken = async () => {
      const btn = $("useToken");
      btn.disabled = true;
      setAdvMsg("Connecting…");
      try {
        await P.manualPair({ apiBase: $("apiBase").value, token: $("token").value });
        $("token").value = "";
        setAdvMsg("Connected with your token.", "good");
        if (pairCtl) {
          pairCtl.cancel();
          pairCtl = null;
        }
        await render();
      } catch (e) {
        setAdvMsg(P.errMessage(e), "bad");
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

    $("resetHidden").addEventListener("click", async () => {
      await ext.storage.local.set({ videoPromptBlockedHosts: [] });
      setAdvMsg("The download button will show on every site again.", "good");
      await loadSettings();
    });

    $("disconnectBtn").addEventListener("click", async () => {
      const btn = $("disconnectBtn");
      if (Date.now() - disconnectArmed > 4000) {
        disconnectArmed = Date.now();
        btn.textContent = "Click again to disconnect";
        setTimeout(() => {
          if (Date.now() - disconnectArmed >= 4000) {
            btn.textContent = "Disconnect this browser";
          }
        }, 4100);
        return;
      }
      disconnectArmed = 0;
      btn.textContent = "Disconnect this browser";
      await P.disconnect();
      setAdvMsg("Disconnected. To remove it from the app too, open CatalystFDM → Browsers.", "good");
      await render();
    });

    // Token stored or cleared elsewhere (background finished pairing, a 401, the welcome tab).
    ext.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.pairingToken && currentView() !== "v-pair") {
        void render();
      }
    });

    setInterval(tick, 1000);
  }

  if (!P.available()) {
    renderUnavailable();
    return;
  }
  bind();
  void render().catch((e) => {
    show("v-connect");
    setStatus("", "Not connected");
    setAdvMsg(P.errMessage(e), "bad");
  });
})();
