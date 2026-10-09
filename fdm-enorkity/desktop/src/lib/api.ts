/** Resolved after `bootstrapApi()` in the Tauri webview (runtime port from Rust). */
let resolvedBase =
  typeof import.meta.env.VITE_API_BASE === "string" && import.meta.env.VITE_API_BASE !== ""
    ? String(import.meta.env.VITE_API_BASE).replace(/\/$/, "")
    : "http://127.0.0.1:8765";

export function getApiBase(): string {
  return resolvedBase;
}

/** Call once before mounting the React tree when running inside Tauri. Safe no-op on web-only dev. */
export async function bootstrapApi(): Promise<void> {
  if (typeof window === "undefined") return;
  const w = window as Window & { __TAURI__?: unknown; __TAURI_IPC__?: unknown };
  const inTauriShell = typeof w.__TAURI__ !== "undefined" || typeof w.__TAURI_IPC__ !== "undefined";
  if (!inTauriShell) return;
  try {
    const { invoke } = await import("@tauri-apps/api/tauri");
    const url = await invoke<string>("get_api_base_url");
    resolvedBase = url.replace(/\/$/, "");
  } catch {
    console.warn("[fdm-enorkity] could not resolve API base from Tauri; using fallback", resolvedBase);
  }
}

export type ApiEnvelope<T> = {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
};

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${resolvedBase}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = (await res.json()) as ApiEnvelope<T>;
  if (!body.success) {
    throw new Error(body.error || body.message || "request failed");
  }
  return body.data as T;
}

export const api = {
  getApiBase,

  health: () => req<{ service: string }>("/api/v1/health"),
  listDownloads: (params?: { status?: string; search?: string }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    if (params?.search) q.set("search", params.search);
    const s = q.toString();
    return req<{ items: Download[]; total: number }>(`/api/v1/downloads${s ? `?${s}` : ""}`);
  },
  addDownload: (url: string, execConfirmed?: boolean) =>
    req<Download>("/api/v1/downloads", {
      method: "POST",
      body: JSON.stringify({ url, source: "desktop", exec_confirmed: !!execConfirmed }),
    }),
  confirmExecutable: (id: string) =>
    req<{ id: string }>(`/api/v1/downloads/${id}/confirm-executable`, { method: "POST" }),
  pause: (id: string) => req(`/api/v1/downloads/${id}/pause`, { method: "POST" }),
  resume: (id: string) => req(`/api/v1/downloads/${id}/resume`, { method: "POST" }),
  cancel: (id: string) => req(`/api/v1/downloads/${id}/cancel`, { method: "POST" }),
  retry: (id: string) => req(`/api/v1/downloads/${id}/retry`, { method: "POST" }),
  deleteDownload: (id: string) => req(`/api/v1/downloads/${id}`, { method: "DELETE" }),
  deleteDownloadFile: (id: string) => req(`/api/v1/downloads/${id}/file`, { method: "DELETE" }),
  statsSummary: () => req<Record<string, unknown>>("/api/v1/stats/summary"),
  settings: () => req<Settings>("/api/v1/settings"),
  generatePairingToken: () =>
    req<{ token: string }>("/api/v1/settings/generate-pairing-token", { method: "POST" }),
  browserConnections: () => req<BrowserConnection[]>("/api/v1/browser/connections"),
  revokeBrowser: (id: string) => req(`/api/v1/browser/connections/${id}`, { method: "DELETE" }),
  queue: () => req<QueueItem[]>("/api/v1/queue"),
  queueStartAll: () => req("/api/v1/queue/start-all", { method: "POST" }),
  queuePauseAll: () => req("/api/v1/queue/pause-all", { method: "POST" }),
  queueMoveUp: (id: string) => req(`/api/v1/queue/${id}/move-up`, { method: "POST" }),
  queueMoveDown: (id: string) => req(`/api/v1/queue/${id}/move-down`, { method: "POST" }),
  logs: (params?: { limit?: number; level?: string }) => {
    const q = new URLSearchParams();
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.level) q.set("level", params.level);
    const s = q.toString();
    return req<LogRow[]>(`/api/v1/logs${s ? `?${s}` : ""}`);
  },
  putSettings: (patch: Partial<Settings> & Record<string, unknown>) =>
    req<Settings>("/api/v1/settings", { method: "PUT", body: JSON.stringify(patch) }),
};

export type QueueItem = {
  id: string;
  download_id: string;
  priority: number;
  position: number;
  status: string;
  download?: Download;
};

export type LogRow = {
  id: string;
  download_id: string;
  level: string;
  message: string;
  details?: string;
  created_at: string;
};

export type Download = {
  id: string;
  url: string;
  filename: string;
  status: string;
  progress_percent: number;
  downloaded_bytes: number;
  file_size: number;
  speed_bytes_per_second: number;
  eta_seconds: number;
  error_message?: string;
  requires_exec_confirm?: boolean;
  exec_confirmed?: boolean;
};

export type Settings = {
  download_directory: string;
  max_concurrent_downloads: number;
  bandwidth_limit_bps: number;
  allow_private_urls: boolean;
  theme: string;
  notifications_enabled: boolean;
  startup_behavior: string;
  executable_confirm_enabled: boolean;
  pairing_configured: boolean;
};

export type BrowserConnection = {
  id: string;
  browser_name: string;
  extension_id: string;
  status: string;
  last_seen_at?: string | null;
};
