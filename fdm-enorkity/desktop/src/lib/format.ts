import type { Download } from "./api";

export function formatBytes(n: number | undefined | null, empty = "—"): string {
  if (n == null || !Number.isFinite(n) || n < 0) return empty;
  if (n >= 1024 ** 4) return `${(n / 1024 ** 4).toFixed(2)} TB`;
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

export function formatSpeed(bps: number | undefined | null): string {
  if (!bps || bps <= 0) return "—";
  return `${formatBytes(bps)}/s`;
}

/** 635 → "10:35", 5432 → "1:30:32". */
export function formatDuration(seconds: number | undefined | null): string {
  if (!seconds || seconds <= 0) return "";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** 101 → "1m 41s", 4000 → "1h 6m". */
export function formatEta(seconds: number | undefined | null): string {
  if (!seconds || seconds <= 0) return "—";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Rough human time for an estimate: "under a minute", "about 4 min", "about 1 h 20 min". */
export function formatEstimate(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  if (seconds < 50) return "under a minute";
  const m = Math.round(seconds / 60);
  if (m < 60) return `about ${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `about ${h} h ${rest} min` : `about ${h} h`;
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const diff = (Date.now() - t) / 1000;
  if (diff < 45) return "just now";
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
  if (diff < 86400 * 2) return "yesterday";
  if (diff < 86400 * 7) return `${Math.round(diff / 86400)} days ago`;
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function greeting(d = new Date()): string {
  const h = d.getHours();
  if (h < 5) return "Up late";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export function displayTitle(d: Pick<Download, "title" | "filename" | "url">): string {
  return d.title?.trim() || d.filename?.trim() || d.url;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function isSameDay(iso: string | null | undefined, ref = new Date()): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth() && d.getDate() === ref.getDate();
}

/** Returns a normalized http(s) URL, or "" when the text isn't one. Bare "www.…" links get https://. */
export function asHttpUrl(text: string): string {
  const t = text.trim();
  if (!t || /\s/.test(t)) return "";
  const candidate = /^www\./i.test(t) ? `https://${t}` : t;
  try {
    const u = new URL(candidate);
    return (u.protocol === "http:" || u.protocol === "https:") && (u.hostname.includes(".") || u.hostname === "localhost") ? u.href : "";
  } catch {
    return "";
  }
}
