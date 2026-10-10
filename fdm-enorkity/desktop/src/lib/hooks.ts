import { useEffect, useRef, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type Download } from "./api";

/* One poll feeds the whole app: the sidebar counts, Home, Downloading and the Library all read
 * the same ["downloads"] query, so the engine sees one request per second, not one per view. */

export function useDownloads() {
  return useQuery({
    queryKey: ["downloads"],
    queryFn: () => api.listDownloads({ limit: 500 }),
    // Keep polling (slower) in the background so "download finished" notifications still fire.
    refetchInterval: () => (document.visibilityState === "visible" ? 1000 : 4000),
    refetchIntervalInBackground: true,
  });
}

export function useSettings() {
  return useQuery({ queryKey: ["settings"], queryFn: api.settings, staleTime: 10_000 });
}

export function useMediaStatus() {
  return useQuery({ queryKey: ["media-status"], queryFn: api.mediaStatus, retry: false, staleTime: 60_000 });
}

export function useStats() {
  return useQuery({ queryKey: ["stats"], queryFn: api.statsSummary, refetchInterval: 5000 });
}

export const isLive = (d: Download) => d.status === "active" || d.status === "queued" || d.status === "pending" || d.status === "paused";

/* ---------- speed history (sparkline) ---------- */

const HISTORY = 60;
let samples: number[] = Array(HISTORY).fill(0);
const speedListeners = new Set<() => void>();

function pushSample(v: number) {
  samples = [...samples.slice(1), v];
  speedListeners.forEach((l) => l());
}

export function useSpeedHistory(): number[] {
  return useSyncExternalStore(
    (l) => {
      speedListeners.add(l);
      return () => speedListeners.delete(l);
    },
    () => samples,
  );
}

/** Mount once (App): samples total throughput every poll and reports finished downloads. */
export function useDownloadWatcher(items: Download[] | undefined, onFinish: (d: Download, ok: boolean) => void) {
  const seen = useRef<Map<string, string> | null>(null);
  const cb = useRef(onFinish);
  cb.current = onFinish;
  useEffect(() => {
    if (!items) return;
    pushSample(items.filter((d) => d.status === "active").reduce((a, d) => a + (d.speed_bytes_per_second || 0), 0));
    const prev = seen.current;
    const next = new Map(items.map((d) => [d.id, d.status]));
    if (prev) {
      for (const d of items) {
        const before = prev.get(d.id);
        if (before && before !== d.status && (before === "active" || before === "queued")) {
          if (d.status === "completed") cb.current(d, true);
          else if (d.status === "failed") cb.current(d, false);
        }
      }
    }
    seen.current = next;
  }, [items]);
}

/** Calls fn on an interval while the tab is visible. */
export function useInterval(fn: () => void, ms: number | null) {
  const saved = useRef(fn);
  saved.current = fn;
  useEffect(() => {
    if (ms == null) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") saved.current();
    }, ms);
    return () => window.clearInterval(id);
  }, [ms]);
}
