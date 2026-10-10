import { useCallback, useEffect, useSyncExternalStore } from "react";

/* Per-viewer conveniences (appearance, layout choices). They live in localStorage, which can be
 * missing or throw (private windows, blocked storage), so every access is guarded and each
 * preference has a sensible default. */

type Prefs = {
  appearance: "auto" | "light" | "dark";
  libraryView: "grid" | "list";
  detectClipboard: boolean;
  sidebarCollapsed: boolean;
};

const DEFAULTS: Prefs = { appearance: "auto", libraryView: "grid", detectClipboard: false, sidebarCollapsed: false };
const KEY = "catalystfdm.prefs";

function read(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    return DEFAULTS;
  }
}

let current: Prefs = read();
const listeners = new Set<() => void>();

function set<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  current = { ...current, [key]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* storage unavailable: keep the in-memory value */
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function usePref<K extends keyof Prefs>(key: K): [Prefs[K], (v: Prefs[K]) => void] {
  const value = useSyncExternalStore(subscribe, () => current[key]);
  const setter = useCallback((v: Prefs[K]) => set(key, v), [key]);
  return [value, setter];
}

/** Applies the appearance preference to <html> and follows the OS when set to auto. */
export function useAppearance() {
  const [appearance] = usePref("appearance");
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = appearance === "dark" || (appearance === "auto" && mq.matches);
      document.documentElement.classList.toggle("dark", dark);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [appearance]);
}
