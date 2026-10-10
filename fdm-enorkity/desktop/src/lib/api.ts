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
    console.warn("[catalystfdm] could not resolve API base from Tauri; using fallback", resolvedBase);
  }
}

export type ApiEnvelope<T> = {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
};

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${resolvedBase}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError("CatalystFDM's engine isn't running.", 0);
  }
  let body: ApiEnvelope<T>;
  try {
    body = (await res.json()) as ApiEnvelope<T>;
  } catch {
    throw new ApiError(`Unexpected response (${res.status})`, res.status);
  }
  if (!body.success) {
    throw new ApiError(body.error || body.message || "request failed", res.status);
  }
  return body.data as T;
}

const post = <T = unknown>(path: string, body?: unknown) =>
  req<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  getApiBase,

  health: () => req<{ service: string }>("/api/v1/health"),
  listDownloads: (params?: { status?: string; search?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    if (params?.search) q.set("search", params.search);
    q.set("limit", String(params?.limit ?? 500));
    return req<{ items: Download[]; total: number }>(`/api/v1/downloads?${q.toString()}`);
  },
  addDownload: (input: AddDownloadInput) =>
    post<Download>("/api/v1/downloads", { source: "desktop", ...input, exec_confirmed: !!input.exec_confirmed }),
  inspect: (url: string, referrer?: string) => post<InspectResult>("/api/v1/inspect", { url, referrer: referrer ?? "" }),
  mediaStatus: () => req<MediaStatus>("/api/v1/media/status"),
  confirmExecutable: (id: string) => post<{ id: string }>(`/api/v1/downloads/${id}/confirm-executable`),
  startNow: (id: string) => post(`/api/v1/downloads/${id}/start-now`),
  tonight: (id: string) => post<Download>(`/api/v1/downloads/${id}/tonight`),
  updateEngine: () => post<{ before: string; after: string; updated: boolean; output: string }>("/api/v1/media/update"),
  pause: (id: string) => post(`/api/v1/downloads/${id}/pause`),
  resume: (id: string) => post(`/api/v1/downloads/${id}/resume`),
  cancel: (id: string) => post(`/api/v1/downloads/${id}/cancel`),
  retry: (id: string) => post(`/api/v1/downloads/${id}/retry`),
  openFile: (id: string) => post(`/api/v1/downloads/${id}/open`),
  revealFile: (id: string) => post(`/api/v1/downloads/${id}/reveal`),
  streamUrl: (id: string) => `${resolvedBase}/api/v1/downloads/${id}/stream`,
  posterUrl: (id: string) => `${resolvedBase}/api/v1/downloads/${id}/poster`,
  deleteDownload: (id: string) => req(`/api/v1/downloads/${id}`, { method: "DELETE" }),
  deleteDownloadFile: (id: string) => req(`/api/v1/downloads/${id}/file`, { method: "DELETE" }),
  statsSummary: () => req<StatsSummary>("/api/v1/stats/summary"),
  settings: () => req<Settings>("/api/v1/settings"),
  putSettings: (patch: Partial<Settings> & Record<string, unknown>) =>
    req<Settings>("/api/v1/settings", { method: "PUT", body: JSON.stringify(patch) }),
  generatePairingToken: () => post<{ token: string }>("/api/v1/settings/generate-pairing-token"),
  browserConnections: () => req<BrowserConnection[]>("/api/v1/browser/connections"),
  revokeBrowser: (id: string) => req(`/api/v1/browser/connections/${id}`, { method: "DELETE" }),
  pendingPairs: () => req<PairRequest[]>("/api/v1/browser/pair/pending"),
  approvePair: (id: string) => post<BrowserConnection>(`/api/v1/browser/pair/pending/${id}/approve`),
  denyPair: (id: string) => post(`/api/v1/browser/pair/pending/${id}/deny`),
  queue: () => req<QueueItem[]>("/api/v1/queue"),
  queueStartAll: () => post("/api/v1/queue/start-all"),
  queuePauseAll: () => post("/api/v1/queue/pause-all"),
  queueRetryFailed: () => post("/api/v1/queue/retry-failed"),
  queueClearCompleted: () => post("/api/v1/queue/clear-completed"),
  queueMoveUp: (id: string) => post(`/api/v1/queue/${id}/move-up`),
  queueMoveDown: (id: string) => post(`/api/v1/queue/${id}/move-down`),
  logs: (params?: { limit?: number; level?: string }) => {
    const q = new URLSearchParams();
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.level) q.set("level", params.level);
    const s = q.toString();
    return req<LogRow[]>(`/api/v1/logs${s ? `?${s}` : ""}`);
  },
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

export type DownloadEngine = "http" | "media";

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
  category?: string;
  mime_type?: string;
  extension?: string;
  file_path?: string;
  error_message?: string;
  requires_exec_confirm?: boolean;
  exec_confirmed?: boolean;
  created_at?: string;
  started_at?: string | null;
  completed_at?: string | null;
  // Media engine fields (empty for plain http downloads).
  engine?: DownloadEngine | "";
  quality_id?: string;
  quality_label?: string;
  title?: string;
  thumbnail?: string;
  site?: string;
  duration_seconds?: number;
  stage?: string;
  night_only?: boolean;
  start_after?: string | null;
};

export type AddDownloadInput = {
  url: string;
  engine?: DownloadEngine;
  quality_id?: string;
  filename?: string;
  title?: string;
  thumbnail?: string;
  site?: string;
  duration_seconds?: number;
  size_bytes?: number;
  referrer?: string;
  exec_confirmed?: boolean;
  /** "night" waits for the night data window. */
  when?: "now" | "night";
};

export type QualityOption = {
  id: string;
  kind: "video" | "audio";
  label: string;
  detail: string;
  height: number;
  fps: number;
  ext: string;
  size_bytes: number;
  recommended: boolean;
};

export type PlaylistEntry = {
  url: string;
  title: string;
  thumbnail: string;
  duration_seconds: number;
  uploader: string;
};

export type InspectResult = {
  kind: "direct" | "media" | "playlist";
  url: string;
  title: string;
  filename: string;
  thumbnail: string;
  duration_seconds: number;
  uploader: string;
  site: string;
  mime_type: string;
  size_bytes: number;
  is_live: boolean;
  drm: boolean;
  options: QualityOption[];
  entries?: PlaylistEntry[];
};

export type MediaStatus = {
  available: boolean;
  version: string;
  ffmpeg: boolean;
  cookies_browser: string;
  error?: string;
};

export type StatsSummary = Partial<Record<"active" | "completed" | "failed" | "paused" | "queued" | "pending" | "cancelled", number>> & {
  total_bytes_completed?: number;
  recent_speed_bps?: number;
};

export type CookiesBrowser = "" | "chrome" | "chromium" | "brave" | "edge" | "firefox";

export type PreferredQuality = "" | "best" | "v2160" | "v1440" | "v1080" | "v720" | "v480" | "v360" | "a-mp3" | "a-m4a";

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
  media_cookies_browser?: CookiesBrowser;
  preferred_quality?: PreferredQuality;
  media_embed_metadata?: boolean;
  media_subtitles?: boolean;
  connections_per_download?: number;
  night_start?: string;
  night_end?: string;
};

export type BrowserConnection = {
  id: string;
  browser_name: string;
  extension_id: string;
  status: string;
  last_seen_at?: string | null;
  created_at?: string;
};

export type PairRequest = {
  id: string;
  browser_name: string;
  extension_id: string;
  code: string;
  created_at: string;
  expires_at: string;
};
