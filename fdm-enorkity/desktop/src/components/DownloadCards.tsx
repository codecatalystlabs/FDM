import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, FolderOpen, Moon, Pause, Play, RotateCcw, ShieldAlert, Trash2, X } from "lucide-react";
import { api, type Download } from "@/lib/api";
import { displayTitle, formatBytes, formatEta, formatSpeed, hostOf, relativeTime } from "@/lib/format";
import { useActions } from "@/lib/actions";
import { friendlyError } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { Button, IconButton, Progress, ProgressRing } from "./ui";
import { DownloadBadges, DownloadThumb, downloadKind } from "./media";
import { canPreview } from "./QuickLook";
import { useToast } from "./Toasts";

function useAction(fn: (id: string) => Promise<unknown>, failTitle: string) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSettled: () => void qc.invalidateQueries({ queryKey: ["downloads"] }),
    onError: (e: Error) => toast({ title: failTitle, subtitle: e.message, tone: "error" }),
  });
}

/* Shared download actions, used by every list in the app. */
export function useDownloadActions() {
  return {
    pause: useAction(api.pause, "Couldn't pause"),
    resume: useAction(api.resume, "Couldn't resume"),
    cancel: useAction(api.cancel, "Couldn't cancel"),
    retry: useAction(api.retry, "Couldn't retry"),
    remove: useAction(api.deleteDownload, "Couldn't remove"),
    removeFile: useAction(api.deleteDownloadFile, "Couldn't delete the file"),
    open: useAction(api.openFile, "Couldn't open the file"),
    reveal: useAction(api.revealFile, "Couldn't show the file"),
    confirm: useAction(api.confirmExecutable, "Couldn't start"),
    startNow: useAction(api.startNow, "Couldn't start"),
  };
}

/** "tonight at 00:00" / "tomorrow at 23:00" for a night download's start time. */
export function nightStart(iso: string | null | undefined): string {
  if (!iso) return "tonight";
  const t = new Date(iso);
  const time = t.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const days = Math.round((new Date(t).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86_400_000);
  return days <= 1 ? `tonight at ${time}` : `${t.toLocaleDateString(undefined, { weekday: "long" })} at ${time}`;
}

export const isNightWaiting = (d: Download) => d.status === "paused" && !!d.night_only && !!d.start_after;

export function statusLine(d: Download): string {
  if (d.requires_exec_confirm && !d.exec_confirmed) return "Waiting for your OK";
  if (isNightWaiting(d)) return `Starts ${nightStart(d.start_after)} · night data`;
  if (d.status === "paused") return "Paused";
  if (d.status === "queued" || d.status === "pending") return "Up next";
  if (d.engine === "media" && d.stage) return d.night_only ? `${d.stage} · night data` : d.stage;
  return d.night_only ? "Downloading · night data" : "Downloading";
}

/** A live download: thumbnail with a progress ring, stage, speed, ETA and controls. */
export function ActiveCard({ d, compact }: { d: Download; compact?: boolean }) {
  const a = useDownloadActions();
  const pct = Math.floor(d.progress_percent || 0);
  const merging = d.engine === "media" && /merg|convert|final/i.test(d.stage ?? "");
  const paused = d.status === "paused";
  const waiting = d.status === "queued" || d.status === "pending";
  const needsOk = d.requires_exec_confirm && !d.exec_confirmed;
  const nightWait = isNightWaiting(d);
  const sizeText = d.file_size > 0 ? `${formatBytes(d.downloaded_bytes)} of ${d.engine === "media" ? "~" : ""}${formatBytes(d.file_size)}` : formatBytes(d.downloaded_bytes);

  return (
    <div
      className={cn(
        "group flex items-center gap-4 rounded-2xl bg-surface p-3 shadow-card transition duration-300 ease-spring animate-fade-up",
        paused && "opacity-80",
      )}
    >
      <DownloadThumb d={d} className={compact ? "w-[112px]" : "w-[150px]"}>
        <div className="absolute inset-0 flex items-center justify-center bg-black/35">
          <ProgressRing value={merging ? 100 : pct} size={compact ? 38 : 46} stroke={3.5} tone="white" className="text-white">
            <span className="num text-[11px] font-bold text-white">{merging ? "…" : `${pct}%`}</span>
          </ProgressRing>
        </div>
      </DownloadThumb>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-semibold tracking-[-0.01em]" title={displayTitle(d)}>
          {displayTitle(d)}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-2">
          <DownloadBadges d={d} />
          <span
            className={cn(
              "inline-flex items-center gap-1 font-medium",
              needsOk ? "text-warn" : nightWait ? "text-[#6366f1] dark:text-[#a5b4fc]" : paused ? "text-ink-3" : "text-accent-ink dark:text-accent",
            )}
          >
            {nightWait || d.night_only ? <Moon className="h-3 w-3" /> : null}
            {statusLine(d)}
          </span>
        </div>
        <Progress
          value={merging ? 100 : d.progress_percent || 0}
          indeterminate={merging || (d.status === "active" && pct === 0 && !d.downloaded_bytes)}
          tone={paused ? "warn" : "accent"}
          className="mt-2.5"
        />
        <div className="num mt-1.5 flex flex-wrap gap-x-3 text-[11.5px] text-ink-3">
          <span>{sizeText}</span>
          {d.status === "active" && !merging ? (
            <>
              <span>{formatSpeed(d.speed_bytes_per_second)}</span>
              <span>{d.eta_seconds > 0 ? `${formatEta(d.eta_seconds)} left` : ""}</span>
            </>
          ) : null}
          {!compact && !d.site ? <span className="truncate">{hostOf(d.url)}</span> : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {needsOk ? (
          <>
            <Button size="sm" variant="tinted" onClick={() => a.confirm.mutate(d.id)}>
              <ShieldAlert className="h-3.5 w-3.5" />
              Allow
            </Button>
            <IconButton label="Remove" onClick={() => a.remove.mutate(d.id)}>
              <X />
            </IconButton>
          </>
        ) : (
          <>
            {nightWait ? (
              <Button size="sm" variant="tinted" onClick={() => a.startNow.mutate(d.id)}>
                <Play className="h-3 w-3" fill="currentColor" />
                Start now
              </Button>
            ) : paused ? (
              <IconButton label="Resume" variant="tinted" onClick={() => a.resume.mutate(d.id)}>
                <Play className="translate-x-[1px]" fill="currentColor" />
              </IconButton>
            ) : waiting ? null : (
              <IconButton label="Pause" onClick={() => a.pause.mutate(d.id)}>
                <Pause fill="currentColor" />
              </IconButton>
            )}
            <IconButton label="Cancel" onClick={() => a.cancel.mutate(d.id)} className="hover:bg-bad/[0.12] hover:text-bad">
              <X />
            </IconButton>
          </>
        )}
      </div>
    </div>
  );
}

/** A finished download as an Apple TV–style poster card. */
export function LibraryCard({ d }: { d: Download }) {
  const a = useDownloadActions();
  const { quickLook } = useActions();
  const previewable = canPreview(d);
  return (
    <div className="group animate-fade-up">
      <button
        type="button"
        onClick={() => (previewable ? quickLook(d) : a.open.mutate(d.id))}
        className="relative block w-full overflow-hidden rounded-[14px] text-left shadow-card transition duration-300 ease-spring hover:-translate-y-0.5 hover:shadow-float focus-visible:shadow-glow"
        title={previewable ? "Play (Space)" : "Open"}
      >
        <DownloadThumb d={d} className="w-full" rounded="rounded-[14px]">
          <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition duration-300 group-hover:bg-black/30">
            <span className="flex h-12 w-12 scale-90 items-center justify-center rounded-full bg-white/85 text-[#0b1733] opacity-0 shadow-lg backdrop-blur transition duration-300 ease-spring group-hover:scale-100 group-hover:opacity-100">
              {previewable ? <Play className="ml-0.5 h-5 w-5" fill="currentColor" /> : <ExternalLink className="h-5 w-5" />}
            </span>
          </div>
          {d.quality_label ? (
            <span className="absolute left-1.5 top-1.5 rounded-md bg-black/60 px-1.5 py-[1px] text-[10px] font-bold text-white backdrop-blur-sm">
              {d.quality_label}
            </span>
          ) : null}
        </DownloadThumb>
      </button>
      <div className="mt-2 flex items-start gap-2 px-0.5">
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-[13px] font-semibold leading-snug" title={displayTitle(d)}>
            {displayTitle(d)}
          </div>
          <div className="num mt-0.5 truncate text-[11.5px] text-ink-3">
            {[d.site || hostOf(d.url), formatBytes(d.file_size, ""), relativeTime(d.completed_at)].filter(Boolean).join(" · ")}
          </div>
        </div>
        <div className="flex shrink-0 gap-0.5 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
          <IconButton size="sm" variant="plain" label="Show in folder" onClick={() => a.reveal.mutate(d.id)}>
            <FolderOpen />
          </IconButton>
          <IconButton size="sm" variant="plain" label="Remove from library (keeps the file)" onClick={() => a.remove.mutate(d.id)}>
            <Trash2 />
          </IconButton>
        </div>
      </div>
    </div>
  );
}

/** A finished download as a compact list row. */
export function LibraryRow({ d, onDeleteFile }: { d: Download; onDeleteFile: (d: Download) => void }) {
  const a = useDownloadActions();
  const { quickLook } = useActions();
  const previewable = canPreview(d);
  const kind = downloadKind(d);
  return (
    <div className="group flex items-center gap-3 px-3 py-2.5 transition hover:bg-fill/[0.05]">
      <button type="button" onClick={() => (previewable ? quickLook(d) : a.open.mutate(d.id))} className="shrink-0 rounded-lg">
        <DownloadThumb d={d} className="w-[84px]" rounded="rounded-lg" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-semibold" title={displayTitle(d)}>
          {displayTitle(d)}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-ink-3">
          <DownloadBadges d={d} />
          <span className="num truncate">{[formatBytes(d.file_size, ""), relativeTime(d.completed_at)].filter(Boolean).join(" · ")}</span>
        </div>
        {d.file_path ? (
          <div className="mt-0.5 truncate font-mono text-[10.5px] text-ink-3" title={d.file_path}>
            {d.file_path}
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {previewable ? (
          <IconButton label="Play" variant="tinted" onClick={() => quickLook(d)}>
            <Play className="ml-[1px]" fill="currentColor" />
          </IconButton>
        ) : null}
        <IconButton label={kind === "software" ? "Show in folder" : "Open"} onClick={() => (kind === "software" ? a.reveal.mutate(d.id) : a.open.mutate(d.id))}>
          <ExternalLink />
        </IconButton>
        <IconButton label="Show in folder" onClick={() => a.reveal.mutate(d.id)}>
          <FolderOpen />
        </IconButton>
        <IconButton label="Delete file…" onClick={() => onDeleteFile(d)} className="hover:bg-bad/[0.12] hover:text-bad">
          <Trash2 />
        </IconButton>
      </div>
    </div>
  );
}

export function FailedRow({ d }: { d: Download }) {
  const a = useDownloadActions();
  const why = friendlyError(d.error_message);
  return (
    <div className="flex items-start gap-4 rounded-2xl bg-surface p-3 shadow-card animate-fade-up">
      <DownloadThumb d={d} className="w-[120px] opacity-80 grayscale-[35%]" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-semibold" title={displayTitle(d)}>
          {displayTitle(d)}
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-[11.5px] text-ink-3">
          <DownloadBadges d={d} />
          <span className="truncate">{hostOf(d.url)}</span>
        </div>
        <div className="mt-2 rounded-lg bg-bad/[0.07] px-2.5 py-2">
          <div className="text-[12.5px] font-semibold text-bad">{why.title}</div>
          <div className="mt-0.5 text-[12px] leading-snug text-ink-2">
            {why.hint}
            {why.settings ? (
              <Link to="/settings" className="ml-1 font-medium text-accent-ink hover:underline dark:text-accent">
                Open Settings
              </Link>
            ) : null}
          </div>
          {d.error_message ? (
            <div className="mt-1 truncate font-mono text-[10.5px] text-ink-3" title={d.error_message}>
              {d.error_message}
            </div>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 gap-1.5">
        <Button size="sm" variant="tinted" onClick={() => a.retry.mutate(d.id)}>
          <RotateCcw className="h-3.5 w-3.5" />
          Retry
        </Button>
        <IconButton size="sm" label="Remove" onClick={() => a.remove.mutate(d.id)}>
          <Trash2 />
        </IconButton>
      </div>
    </div>
  );
}
