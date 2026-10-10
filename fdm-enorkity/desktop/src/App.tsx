import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  CircleAlert,
  ClipboardPaste,
  Globe,
  House,
  Library,
  Link2,
  ListOrdered,
  Moon,
  Pause,
  Play,
  RotateCcw,
  ScrollText,
  Settings,
  Sun,
} from "lucide-react";
import { api, type Download } from "@/lib/api";
import { ActionsContext } from "@/lib/actions";
import { asHttpUrl, displayTitle, hostOf } from "@/lib/format";
import { friendlyError } from "@/lib/errors";
import { useDownloads, useDownloadWatcher, useSettings } from "@/lib/hooks";
import { useAppearance, usePref } from "@/lib/prefs";
import { Layout } from "@/components/Layout";
import { Spotlight, type Command } from "@/components/Spotlight";
import { PairingSheet } from "@/components/PairingSheet";
import { QuickLook, canPreview } from "@/components/QuickLook";
import { ToastProvider, useToast } from "@/components/Toasts";
import Home from "@/pages/Home";
import Downloading from "@/pages/Downloading";
import QueuePage from "@/pages/Queue";
import LibraryPage from "@/pages/Library";
import Failed from "@/pages/Failed";
import BrowsersPage from "@/pages/Browsers";
import SettingsPage from "@/pages/Settings";
import ActivityPage from "@/pages/Activity";

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

function Shell() {
  useAppearance();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const downloads = useDownloads();
  const settings = useSettings();
  const [appearance, setAppearance] = usePref("appearance");
  const [detectClipboard] = usePref("detectClipboard");
  const [spotlight, setSpotlight] = useState<{ open: boolean; url?: string; key: number }>({ open: false, key: 0 });
  const [preview, setPreview] = useState<Download | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const lastClip = useRef("");

  const openSpotlight = useCallback((url?: string) => setSpotlight((s) => ({ open: true, url, key: s.key + 1 })), []);
  const closeSpotlight = useCallback(() => setSpotlight((s) => ({ ...s, open: false })), []);
  const actions = useMemo(() => ({ openSpotlight, quickLook: (d: Download) => setPreview(d) }), [openSpotlight]);

  // Finished downloads → banner (and a system notification when the window is in the background).
  useDownloadWatcher(downloads.data?.items, (d, ok) => {
    const title = displayTitle(d);
    toast(
      ok
        ? {
            title: "Download complete",
            subtitle: title,
            tone: "success",
            image: d.thumbnail || undefined,
            actions: [
              ...(canPreview(d) ? [{ label: "Play", onClick: () => setPreview(d) }] : []),
              { label: "Show in folder", onClick: () => void api.revealFile(d.id).catch(() => {}) },
            ],
          }
        : {
            title: friendlyError(d.error_message).title,
            subtitle: title,
            tone: "error",
            actions: [{ label: "Retry", onClick: () => void api.retry(d.id) }],
          },
    );
    if (settings.data?.notifications_enabled && document.visibilityState === "hidden" && "Notification" in window && Notification.permission === "granted") {
      try {
        new Notification(ok ? "Download complete" : "Download failed", { body: title, icon: "/brand/app-icon.svg", silent: !ok });
      } catch {
        /* notifications unavailable */
      }
    }
  });

  // Offer to download a link the user copied elsewhere (opt-in in Settings).
  useEffect(() => {
    if (!detectClipboard) return;
    const check = async () => {
      if (document.visibilityState !== "visible" || spotlight.open) return;
      try {
        const text = (await navigator.clipboard.readText()).trim();
        const url = asHttpUrl(text);
        if (!url || url === lastClip.current) return;
        lastClip.current = url;
        toast({
          title: "Download the link you copied?",
          subtitle: `${hostOf(url)} · ${url.length > 60 ? `${url.slice(0, 60)}…` : url}`,
          actions: [{ label: "Download", onClick: () => openSpotlight(url) }],
          duration: 9000,
        });
      } catch {
        /* clipboard permission not granted */
      }
    };
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, [detectClipboard, spotlight.open, toast, openSpotlight]);

  // ⌘K / Ctrl+K opens Spotlight; paste a link anywhere or drop one onto the window to download it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (spotlight.open) closeSpotlight();
        else openSpotlight();
      }
    };
    const onPaste = (e: ClipboardEvent) => {
      if (spotlight.open || isEditable(e.target)) return;
      const url = asHttpUrl(e.clipboardData?.getData("text/plain") ?? "");
      if (url) {
        e.preventDefault();
        openSpotlight(url);
      }
    };
    const hasLink = (e: DragEvent) =>
      !!e.dataTransfer && Array.from(e.dataTransfer.types).some((t) => t === "text/uri-list" || t === "text/plain");
    const onDragEnter = (e: DragEvent) => {
      if (!hasLink(e)) return;
      dragDepth.current += 1;
      setDragging(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (hasLink(e)) e.preventDefault();
    };
    const onDragLeave = () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      dragDepth.current = 0;
      setDragging(false);
      if (!e.dataTransfer) return;
      const uri = e.dataTransfer.getData("text/uri-list").split("\n").find((l) => l && !l.startsWith("#"));
      const url = asHttpUrl(uri || e.dataTransfer.getData("text/plain"));
      if (url) {
        e.preventDefault();
        openSpotlight(url);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("paste", onPaste);
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [spotlight.open, openSpotlight, closeSpotlight]);

  const refresh = () => void qc.invalidateQueries({ queryKey: ["downloads"] });
  const pauseAll = useMutation({ mutationFn: api.queuePauseAll, onSettled: refresh });
  const startAll = useMutation({ mutationFn: api.queueStartAll, onSettled: refresh });
  const retryFailed = useMutation({ mutationFn: api.queueRetryFailed, onSettled: refresh });

  const readClipboard = useCallback(async () => {
    try {
      return await navigator.clipboard.readText();
    } catch {
      toast({ title: "Clipboard is blocked", subtitle: `Click the field and press ${navigator.platform.includes("Mac") ? "⌘" : "Ctrl"}+V instead.` });
      return "";
    }
  }, [toast]);

  const commands: Command[] = useMemo(() => {
    const dark = document.documentElement.classList.contains("dark");
    return [
      {
        id: "paste",
        title: "Download the link on my clipboard",
        icon: <ClipboardPaste />,
        keywords: "paste clipboard add new",
        run: async () => {
          const url = asHttpUrl(await readClipboard());
          if (url) window.setTimeout(() => openSpotlight(url), 0);
        },
      },
      { id: "home", title: "Home", hint: "Go to", icon: <House />, keywords: "go dashboard", run: () => navigate("/") },
      { id: "downloading", title: "Downloading", hint: "Go to", icon: <ArrowDownToLine />, keywords: "go active progress", run: () => navigate("/downloading") },
      { id: "library", title: "Library", hint: "Go to", icon: <Library />, keywords: "go completed finished files videos music", run: () => navigate("/library") },
      { id: "queue", title: "Queue", hint: "Go to", icon: <ListOrdered />, keywords: "go order", run: () => navigate("/queue") },
      { id: "failed", title: "Failed downloads", hint: "Go to", icon: <CircleAlert />, keywords: "go errors", run: () => navigate("/failed") },
      { id: "browsers", title: "Connect a browser", hint: "Go to", icon: <Globe />, keywords: "extension chrome brave edge firefox pair", run: () => navigate("/browsers") },
      { id: "settings", title: "Settings", hint: "Go to", icon: <Settings />, keywords: "preferences quality folder speed", run: () => navigate("/settings") },
      { id: "activity", title: "Activity log", hint: "Go to", icon: <ScrollText />, keywords: "logs", run: () => navigate("/activity") },
      { id: "pause", title: "Pause all downloads", icon: <Pause />, keywords: "stop", run: () => pauseAll.mutate() },
      { id: "resume", title: "Resume all downloads", icon: <Play />, keywords: "start continue", run: () => startAll.mutate() },
      { id: "retry", title: "Retry failed downloads", icon: <RotateCcw />, keywords: "again", run: () => retryFailed.mutate() },
      {
        id: "theme",
        title: dark ? "Switch to light appearance" : "Switch to dark appearance",
        icon: dark ? <Sun /> : <Moon />,
        keywords: "theme dark light mode appearance",
        run: () => setAppearance(dark ? "light" : "dark"),
      },
    ];
    // appearance is a dependency so the theme command label stays right
  }, [navigate, pauseAll, startAll, retryFailed, setAppearance, readClipboard, openSpotlight, appearance]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <ActionsContext.Provider value={actions}>
      <Layout>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/downloading" element={<Downloading />} />
          <Route path="/queue" element={<QueuePage />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/failed" element={<Failed />} />
          <Route path="/browsers" element={<BrowsersPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/activity" element={<ActivityPage />} />
          {/* Old paths from earlier versions */}
          <Route path="/active" element={<Navigate to="/downloading" replace />} />
          <Route path="/completed" element={<Navigate to="/library" replace />} />
          <Route path="/browser" element={<Navigate to="/browsers" replace />} />
          <Route path="/logs" element={<Navigate to="/activity" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>

      <Spotlight
        key={spotlight.key}
        open={spotlight.open}
        initialUrl={spotlight.url}
        onClose={closeSpotlight}
        commands={commands}
        onPaste={readClipboard}
        onDone={({ title, count, thumbnail, label, tonight }) => {
          closeSpotlight();
          toast({
            title: tonight
              ? `Scheduled for tonight${count > 1 ? ` · ${count} videos` : ""}`
              : count > 1
                ? `Downloading ${count} videos`
                : label
                  ? `Downloading ${label}`
                  : "Download started",
            subtitle: title,
            image: thumbnail || undefined,
            actions: [{ label: "Show", onClick: () => navigate("/downloading") }],
          });
        }}
      />
      <PairingSheet />
      <QuickLook d={preview} onClose={() => setPreview(null)} />

      {dragging && !spotlight.open ? (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-[rgb(10_17_33/0.35)] backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-[28px] px-14 py-11 text-center shadow-sheet glass-strong animate-scale-in">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl brand-gradient text-white">
              <Link2 className="h-7 w-7" />
            </span>
            <div className="text-title-2">Drop to download</div>
            <div className="text-[13px] text-ink-2">Video pages, streams and direct file links</div>
          </div>
        </div>
      ) : null}
    </ActionsContext.Provider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <Shell />
      </ToastProvider>
    </BrowserRouter>
  );
}
