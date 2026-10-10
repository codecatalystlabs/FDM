/* global chrome, browser */
// CatalystFDM — connection logic shared by popup.html, welcome.html and background.js.
//
// ===== ONE-CLICK CONNECT =====
// 1. POST /api/v1/browser/pair/request  -> a secret request id and a 4-digit code.
// 2. The user sees the same code in the CatalystFDM app and clicks Allow.
// 3. GET /api/v1/browser/pair/request/<id> every 1.5 s until it reports approved (with this
//    browser's token, handed over exactly once), denied or expired.
//
// ===== WHO POLLS =====
// The page that shows the code polls while it is open and holds a runtime port named
// "catalyst-pairing". When the last such page closes (the popup closes the moment the user
// clicks into the app), background.js takes over polling, so clicking Allow still connects.
// The pending request lives in storage (session area when available), so a reopened popup
// shows the same code instead of asking the app twice. Any number of pollers is safe: the
// one that collects the token stores it, the others notice and report success.
//
// No DOM access here: this file also runs in the background service worker.

(function (root) {
  "use strict";
  if (root.CatalystPair) {
    return;
  }

  const ns =
    typeof browser !== "undefined" && browser && browser.runtime
      ? browser
      : typeof chrome !== "undefined" && chrome && chrome.runtime
        ? chrome
        : null;

  const DEFAULT_API = "http://127.0.0.1:8765";
  const APP_URL = "http://127.0.0.1:5173/";
  const POLL_MS = 1500;
  const OFFLINE_RETRY_MS = 3000;
  const PORT_NAME = "catalyst-pairing";
  const NOT_CONNECTED = "CatalystFDM isn't connected yet. Click the CatalystFDM toolbar button to connect.";
  const OFFLINE = "CatalystFDM isn't running. Open the app and try again.";
  const TOKEN_KEYS = ["pairingToken", "connection", "pairMethod", "pairedAt"];

  class ApiError extends Error {
    constructor(message, opts) {
      super(message);
      this.name = "ApiError";
      this.status = (opts && opts.status) || 0;
      this.code = (opts && opts.code) || "";
    }
  }

  function available() {
    return Boolean(ns && ns.storage && ns.storage.local);
  }

  function local() {
    if (!available()) {
      throw new ApiError("Extension storage is unavailable — reload CatalystFDM from the extensions page.", {
        code: "storage",
      });
    }
    return ns.storage.local;
  }

  // Pending requests carry a secret, so keep them out of disk storage where possible.
  function pendingArea() {
    return ns && ns.storage && ns.storage.session ? ns.storage.session : local();
  }

  function errMessage(e) {
    return String(e && e.message ? e.message : e);
  }

  function cleanBase(v) {
    if (typeof v !== "string") {
      return "";
    }
    return v.trim().replace(/\/+$/, "");
  }

  /** Validates an address typed in Advanced. Only this computer is allowed. */
  function normalizeApiBase(input) {
    const raw = String(input || "").trim() || DEFAULT_API;
    let u;
    try {
      u = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `http://${raw}`);
    } catch {
      throw new ApiError("That doesn't look like an address. Try http://127.0.0.1:8765", { code: "input" });
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      throw new ApiError("The address must start with http://", { code: "input" });
    }
    if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") {
      throw new ApiError("CatalystFDM only talks to this computer — use 127.0.0.1 or localhost.", { code: "input" });
    }
    return `${u.protocol}//${u.host}`;
  }

  async function getState() {
    const st = await local().get([
      "apiBase",
      "pairingToken",
      "extensionId",
      "connection",
      "pairMethod",
      "pairedAt",
      "browserName",
    ]);
    let extensionId = typeof st.extensionId === "string" ? st.extensionId : "";
    if (!extensionId) {
      // One id per browser profile; the app keys this browser's connection on it.
      await local().set({ extensionId: crypto.randomUUID() });
      extensionId = (await local().get(["extensionId"])).extensionId;
    }
    const token = typeof st.pairingToken === "string" ? st.pairingToken.trim() : "";
    return {
      apiBase: cleanBase(st.apiBase) || DEFAULT_API,
      pairingToken: token,
      extensionId,
      connection: st.connection && typeof st.connection === "object" ? st.connection : null,
      pairMethod: st.pairMethod || (token ? "manual" : ""),
      pairedAt: Number(st.pairedAt) || 0,
      browserName: typeof st.browserName === "string" ? st.browserName : "",
    };
  }

  /** Low-level fetch. Resolves to {status, ok, json}; rejects with code "offline" on network failure. */
  async function request(apiBase, path, opts) {
    const o = opts || {};
    const headers = { Accept: "application/json" };
    if (o.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    if (o.token) {
      headers["X-FDM-Pairing-Token"] = o.token;
    }
    if (o.extensionId) {
      headers["X-FDM-Extension-Id"] = o.extensionId;
    }
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeoutMs = o.timeoutMs === undefined ? 8000 : o.timeoutMs;
    const timer = ctrl && timeoutMs ? setTimeout(() => ctrl.abort(), timeoutMs) : 0;
    let res;
    try {
      res = await fetch(`${apiBase}${path}`, {
        method: o.method || "GET",
        headers,
        body: o.body === undefined ? undefined : JSON.stringify(o.body),
        signal: ctrl ? ctrl.signal : undefined,
        cache: "no-store",
        credentials: "omit",
      });
    } catch {
      throw new ApiError(OFFLINE, { code: "offline" });
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text().catch(() => "");
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, ok: res.ok, json };
  }

  function failureFrom(r) {
    const j = r.json || {};
    return new ApiError(j.error || j.message || `CatalystFDM replied with HTTP ${r.status}.`, {
      status: r.status,
      code: "http",
    });
  }

  async function health(apiBase) {
    try {
      const r = await request(apiBase, "/api/v1/health", { timeoutMs: 4000 });
      return Boolean(r.ok && r.json && r.json.success);
    } catch {
      return false;
    }
  }

  /** Clears the stored token — but only if it is still the one that was rejected. */
  async function forgetToken(rejectedToken) {
    const { pairingToken } = await local().get(["pairingToken"]);
    const cur = typeof pairingToken === "string" ? pairingToken.trim() : "";
    if (rejectedToken && cur && cur !== rejectedToken) {
      return; // a newer token arrived meanwhile
    }
    await local().remove(TOKEN_KEYS);
    // Remembered so the popup can say why it is asking to connect again.
    await local().set({ pairedOk: false, revokedAt: Date.now() });
  }

  async function saveToken(t) {
    await local().set({
      pairingToken: t.token,
      pairedOk: true,
      pairMethod: t.method,
      pairedAt: Date.now(),
      connection: t.connection && typeof t.connection === "object" ? t.connection : null,
      browserName: t.browserName || "",
      lastError: "",
      revokedAt: 0,
    });
  }

  /** Calls a token route. Resolves to `data`; a 401 forgets the token and rejects with code "not_connected". */
  async function callApi(path, opts) {
    const o = opts || {};
    const st = await getState();
    if (!st.pairingToken) {
      throw new ApiError(NOT_CONNECTED, { code: "not_connected" });
    }
    const r = await request(st.apiBase, path, {
      method: o.method || "POST",
      body: o.body,
      token: st.pairingToken,
      extensionId: st.extensionId,
      timeoutMs: o.timeoutMs,
    });
    if (r.status === 401) {
      await forgetToken(st.pairingToken);
      throw new ApiError("CatalystFDM no longer recognises this browser. Connect again from the toolbar button.", {
        status: 401,
        code: "not_connected",
      });
    }
    if (!r.json) {
      throw new ApiError(`Unexpected reply from CatalystFDM (HTTP ${r.status}).`, { status: r.status, code: "http" });
    }
    if (!r.ok || !r.json.success) {
      throw failureFrom(r);
    }
    return r.json.data;
  }

  /**
   * Where do we stand? Resolves to {state, hasToken, connection, revoked?, unverified?}
   * state: "connected" | "disconnected" | "offline" (app unreachable).
   */
  async function checkConnection() {
    const st = await getState();
    if (!st.pairingToken) {
      const up = await health(st.apiBase);
      return { state: up ? "disconnected" : "offline", hasToken: false, connection: null };
    }
    let r;
    try {
      r = await request(st.apiBase, "/api/v1/browser/me", {
        token: st.pairingToken,
        extensionId: st.extensionId,
        timeoutMs: 5000,
      });
    } catch {
      return { state: "offline", hasToken: true, connection: st.connection };
    }
    if (r.status === 401) {
      await forgetToken(st.pairingToken);
      return { state: "disconnected", hasToken: false, connection: null, revoked: true };
    }
    if (r.ok && r.json && r.json.success) {
      const conn = r.json.data && r.json.data.connection;
      if (conn && typeof conn === "object") {
        await local().set({ connection: conn, pairedOk: true });
      }
      return { state: "connected", hasToken: true, connection: conn || st.connection };
    }
    // Older app without /browser/me, or a transient server error: keep the token.
    return { state: "connected", hasToken: true, connection: st.connection, unverified: true };
  }

  async function detectBrowserName() {
    const nav = typeof navigator !== "undefined" ? navigator : {};
    const ua = nav.userAgent || "";
    if (/Firefox\//.test(ua)) {
      return "Firefox";
    }
    try {
      if (nav.brave && typeof nav.brave.isBrave === "function" && (await nav.brave.isBrave())) {
        return "Brave";
      }
    } catch {
      /* not Brave */
    }
    let brands = "";
    try {
      brands = ((nav.userAgentData && nav.userAgentData.brands) || []).map((b) => b.brand).join(" ");
    } catch {
      brands = "";
    }
    if (/Brave/.test(brands)) {
      return "Brave";
    }
    if (/Edg\//.test(ua) || /Microsoft Edge/.test(brands)) {
      return "Microsoft Edge";
    }
    if (/OPR\//.test(ua) || /Opera/.test(brands)) {
      return "Opera";
    }
    if (/Vivaldi/.test(ua) || /Vivaldi/.test(brands)) {
      return "Vivaldi";
    }
    return "Chrome";
  }

  // ---------------------------------------------------------------------------
  // Pending request bookkeeping
  // ---------------------------------------------------------------------------

  function validTicket(t) {
    return Boolean(t && typeof t === "object" && typeof t.requestId === "string" && t.requestId && /^\d{4}$/.test(t.code));
  }

  async function readPending() {
    const { pendingPair } = await pendingArea().get(["pendingPair"]);
    return validTicket(pendingPair) ? pendingPair : null;
  }

  async function clearPending(requestId) {
    if (requestId) {
      const cur = await readPending();
      if (cur && cur.requestId !== requestId) {
        return;
      }
    }
    await pendingArea().remove(["pendingPair"]);
  }

  async function finishPending(ticket, status) {
    await clearPending(ticket.requestId);
    await pendingArea().set({ pairOutcome: { requestId: ticket.requestId, status, at: Date.now() } });
  }

  async function requestTicket(apiBase, browserName, extensionId) {
    const r = await request(apiBase, "/api/v1/browser/pair/request", {
      method: "POST",
      body: { browser_name: browserName, extension_id: extensionId },
      timeoutMs: 6000,
    });
    if (r.status === 404 || r.status === 405) {
      throw new ApiError(
        "This version of CatalystFDM can't connect with one click. Update the app, or use a token under Advanced.",
        { status: r.status, code: "unsupported" }
      );
    }
    if (!r.ok || !r.json || !r.json.success || !r.json.data) {
      throw failureFrom(r);
    }
    const d = r.json.data;
    const code = String(d.code == null ? "" : d.code);
    if (typeof d.request_id !== "string" || !d.request_id || !/^\d{4}$/.test(code)) {
      throw new ApiError("CatalystFDM sent an unexpected connection code.", { code: "http" });
    }
    const ttl = Number(d.expires_in) > 0 ? Number(d.expires_in) : 300;
    const now = Date.now();
    return { requestId: d.request_id, code, expiresAt: now + ttl * 1000, startedAt: now, apiBase, browserName };
  }

  async function tokenArrivedSince(ms) {
    const st = await local().get(["pairingToken", "pairedAt", "connection"]);
    if (st.pairingToken && (Number(st.pairedAt) || 0) >= ms) {
      return { status: "approved", connection: st.connection || null };
    }
    return null;
  }

  /**
   * Checks a ticket once. Resolves to {status}: "pending" | "offline" | "approved" | "denied" |
   * "expired" | "adopt" (another page started a newer request; `ticket` is that one).
   */
  async function pollOnce(ticket) {
    const cur = await readPending();
    if (!cur || cur.requestId !== ticket.requestId) {
      const done = await tokenArrivedSince(ticket.startedAt);
      if (done) {
        return done;
      }
      if (cur && cur.expiresAt > Date.now()) {
        return { status: "adopt", ticket: cur };
      }
      const { pairOutcome } = await pendingArea().get(["pairOutcome"]);
      if (pairOutcome && pairOutcome.requestId === ticket.requestId) {
        return { status: pairOutcome.status };
      }
      return { status: "expired" };
    }
    if (Date.now() > cur.expiresAt + 3000) {
      await finishPending(cur, "expired");
      return { status: "expired" };
    }
    let r;
    try {
      r = await request(cur.apiBase, `/api/v1/browser/pair/request/${encodeURIComponent(cur.requestId)}`, {
        timeoutMs: 6000,
      });
    } catch {
      return { status: "offline" };
    }
    const d = r.ok && r.json && r.json.success ? r.json.data : null;
    if (!d) {
      return { status: "pending" }; // transient server hiccup; keep waiting
    }
    if (d.status === "approved" && typeof d.token === "string" && d.token.trim()) {
      await saveToken({
        token: d.token.trim(),
        connection: d.connection,
        method: "one-click",
        browserName: cur.browserName,
      });
      await clearPending(cur.requestId);
      return { status: "approved", connection: d.connection || null };
    }
    if (d.status === "denied") {
      await finishPending(cur, "denied");
      return { status: "denied" };
    }
    if (d.status === "expired" || d.status === "approved") {
      // Another poller may have collected the token a moment ago.
      const done = await tokenArrivedSince(cur.startedAt);
      if (done) {
        return done;
      }
      await finishPending(cur, "expired");
      return { status: "expired" };
    }
    return { status: "pending" };
  }

  function holdPort() {
    try {
      const port = ns.runtime.connect({ name: PORT_NAME });
      // Reading lastError keeps Chrome quiet when no background is listening (standalone pages).
      port.onDisconnect.addListener(() => void (ns.runtime && ns.runtime.lastError));
      return port;
    } catch {
      return null;
    }
  }

  /**
   * Runs the whole connect flow for a page. onUpdate receives:
   *   {phase:"checking"} | {phase:"offline", retryAt} | {phase:"code", code, expiresAt, browserName, appUnreachable?}
   *   {phase:"connected", connection} | {phase:"denied"} | {phase:"expired"} | {phase:"error", message, code}
   * Returns {cancel(), retry(), restart()}. cancel() stops this page only: a request still
   * pending in the app is collected by background.js if the user clicks Allow later.
   */
  function startPairing(onUpdate, options) {
    const opts = options || {};
    let stopped = false;
    let timer = 0;
    let ticket = null;
    let port = null;

    const emit = (s) => {
      if (!stopped) {
        onUpdate(s);
      }
    };
    const release = () => {
      clearTimeout(timer);
      if (port) {
        try {
          port.disconnect();
        } catch {
          /* already gone */
        }
        port = null;
      }
    };
    const fail = (e) => {
      release();
      emit({ phase: "error", message: errMessage(e), code: (e && e.code) || "" });
    };
    const later = (fn, ms) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!stopped) {
          fn().catch(fail);
        }
      }, ms);
    };
    const showCode = (extra) =>
      emit(Object.assign({ phase: "code", code: ticket.code, expiresAt: ticket.expiresAt, browserName: ticket.browserName }, extra));

    async function begin(force) {
      clearTimeout(timer);
      if (!port) {
        port = holdPort();
      }
      emit({ phase: "checking" });
      const st = await getState();
      if (!force) {
        const existing = await readPending();
        if (existing && existing.apiBase === st.apiBase && existing.expiresAt > Date.now() + 5000) {
          ticket = existing;
          showCode();
          later(poll, 0);
          return;
        }
      }
      if (!(await health(st.apiBase))) {
        emit({ phase: "offline", retryAt: Date.now() + OFFLINE_RETRY_MS });
        later(() => begin(force), OFFLINE_RETRY_MS);
        return;
      }
      const browserName = await detectBrowserName();
      try {
        ticket = await requestTicket(st.apiBase, browserName, st.extensionId);
      } catch (e) {
        if (e && e.code === "offline") {
          emit({ phase: "offline", retryAt: Date.now() + OFFLINE_RETRY_MS });
          later(() => begin(force), OFFLINE_RETRY_MS);
          return;
        }
        throw e;
      }
      await pendingArea().set({ pendingPair: ticket });
      await local().set({ browserName });
      showCode();
      later(poll, POLL_MS);
    }

    async function poll() {
      const res = await pollOnce(ticket);
      switch (res.status) {
        case "pending":
          showCode();
          later(poll, POLL_MS);
          return;
        case "offline":
          showCode({ appUnreachable: true });
          later(poll, POLL_MS * 2);
          return;
        case "adopt":
          ticket = res.ticket;
          showCode();
          later(poll, POLL_MS);
          return;
        case "approved":
          release();
          emit({ phase: "connected", connection: res.connection || null });
          return;
        default:
          release();
          emit({ phase: res.status === "denied" ? "denied" : "expired" });
      }
    }

    begin(Boolean(opts.force)).catch(fail);

    return {
      cancel() {
        stopped = true;
        release();
      },
      retry() {
        stopped = false;
        begin(false).catch(fail);
      },
      restart() {
        stopped = false;
        begin(true).catch(fail);
      },
    };
  }

  /** Legacy fallback: a token copied from the app, registered with POST /api/v1/browser/pair. */
  async function manualPair(input) {
    const base = normalizeApiBase(input && input.apiBase);
    const token = String((input && input.token) || "").trim();
    if (!token) {
      throw new ApiError("Paste the token from CatalystFDM first.", { code: "input" });
    }
    const st = await getState();
    const browserName = await detectBrowserName();
    const r = await request(base, "/api/v1/browser/pair", {
      method: "POST",
      body: { browser_name: browserName, extension_id: st.extensionId },
      token,
      extensionId: st.extensionId,
    });
    if (r.status === 401) {
      throw new ApiError(
        "CatalystFDM didn't accept that token. If you removed this browser in the app, use Connect instead.",
        { status: 401, code: "unauthorized" }
      );
    }
    if (!r.ok || !r.json || !r.json.success) {
      throw failureFrom(r);
    }
    await local().set({ apiBase: base });
    await saveToken({ token, connection: r.json.data, method: "manual", browserName });
    await clearPending();
    return r.json.data;
  }

  /** Forgets this browser's token locally. The app still lists it until removed there. */
  async function disconnect() {
    await local().remove(TOKEN_KEYS);
    await local().set({ pairedOk: false, revokedAt: 0 });
    await clearPending();
  }

  /** runtime.sendMessage as a promise that never rejects. */
  function send(msg) {
    return new Promise((resolve) => {
      try {
        const p = ns.runtime.sendMessage(msg);
        if (p && typeof p.then === "function") {
          p.then((r) => resolve(r || { ok: false, error: "No response from CatalystFDM's background." }), (e) =>
            resolve({ ok: false, error: errMessage(e) })
          );
        }
      } catch (e) {
        resolve({ ok: false, error: errMessage(e) });
      }
    });
  }

  root.CatalystPair = Object.freeze({
    ns,
    DEFAULT_API,
    APP_URL,
    POLL_MS,
    PORT_NAME,
    NOT_CONNECTED,
    ApiError,
    available,
    errMessage,
    normalizeApiBase,
    getState,
    request,
    health,
    callApi,
    checkConnection,
    detectBrowserName,
    readPending,
    pollOnce,
    startPairing,
    manualPair,
    disconnect,
    forgetToken,
    send,
  });
})(typeof globalThis !== "undefined" ? globalThis : self);
