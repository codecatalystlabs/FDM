import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  Check,
  FolderDown,
  Headphones,
  ListVideo,
  Lock,
  MonitorPlay,
  Moon,
  Pencil,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { api, type AddDownloadInput, type Download, type InspectResult, type QualityOption } from "@/lib/api";
import { formatBytes, formatDuration, formatEstimate, hostOf } from "@/lib/format";
import { useMediaStatus, useSettings, useStats } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { Badge, Button, Input, Kbd, Skeleton } from "./ui";
import { FileGlyph, Thumb, fileKind } from "./media";
import { Mark } from "./Brand";

/* The heart of the app: paste a link, see what it is, pick a quality, go.
 * Media pages get quality tiles with sizes and a time estimate from this connection's recent
 * speed; playlists get one preset for every video plus a checklist; files go straight in. */

function resolutionTag(height: number): string {
  if (height >= 4320) return "8K";
  if (height >= 2160) return "4K";
  if (height >= 1440) return "QHD";
  if (height >= 720) return "HD";
  if (height > 0) return "SD";
  return "";
}

/** Shorter side of the display in physical pixels, e.g. 1080 for a 1920×1080 screen. Browser
 * zoom shrinks devicePixelRatio below 1, so the CSS size is a floor. */
function screenRes(): number {
  const s = window.screen;
  const css = Math.min(s.width, s.height);
  return Math.round(Math.max(css, css * (window.devicePixelRatio || 1)));
}

function screenName(res: number): string {
  if (res >= 2160) return "4K";
  if (res >= 1440) return "1440p";
  if (res >= 1050) return "1080p";
  if (res >= 700) return "720p";
  return `${res}p`;
}

function useEstimate() {
  const stats = useStats();
  const recent = Number(stats.data?.recent_speed_bps ?? 0);
  return (bytes: number) => (recent > 0 && bytes > 0 ? bytes / recent : 0);
}

function QualityTile({
  option,
  selected,
  onSelect,
  estimate,
  approx,
}: {
  option: QualityOption;
  selected: boolean;
  onSelect: () => void;
  estimate: number;
  approx?: boolean;
}) {
  const isAudio = option.kind === "audio";
  const tag = isAudio ? option.ext.toUpperCase() : resolutionTag(option.height);
  const est = formatEstimate(estimate);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "group relative flex min-w-0 flex-col rounded-[14px] p-3 text-left transition duration-200 ease-spring active:scale-[0.98]",
        "bg-fill/[0.07] shadow-[inset_0_0_0_0.5px_rgb(var(--line-strong)/0.8)] hover:bg-fill/[0.12]",
        selected && "bg-accent/[0.1] shadow-[inset_0_0_0_2px_rgb(var(--accent))] hover:bg-accent/[0.12]",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[19px] font-bold leading-none tracking-[-0.02em]">{option.label}</span>
        {selected ? (
          <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-accent text-white">
            <Check className="h-3 w-3" strokeWidth={3.2} />
          </span>
        ) : tag ? (
          <span className="rounded-[5px] bg-fill/[0.16] px-1 py-px text-[9.5px] font-bold uppercase tracking-wide text-ink-2">{tag}</span>
        ) : null}
      </div>
      <div className="mt-1.5 truncate text-[11.5px] text-ink-3" title={option.detail}>
        {option.detail || " "}
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <span className="num text-[12px] font-semibold text-ink-2">
          {option.size_bytes > 0 ? `${approx ? "≈ " : ""}${formatBytes(option.size_bytes)}` : "Size varies"}
        </span>
        {est ? <span className="text-[10.5px] text-ink-3">{est.replace("about ", "~")}</span> : null}
      </div>
      {option.recommended ? (
        <span className="absolute -top-2 left-2.5 inline-flex items-center gap-0.5 rounded-full bg-gradient-to-r from-[#0b7fd4] to-[#3ea2f0] px-1.5 py-[1px] text-[9.5px] font-bold uppercase tracking-wide text-white shadow">
          <Sparkles className="h-2.5 w-2.5" />
          Smart pick
        </span>
      ) : null}
    </button>
  );
}

/* Typical bitrates (video + audio, bits/s) of what the engine fetches for each playlist preset,
 * measured on YouTube's H.264/AAC streams. Good enough to say "≈ 4 GB" before committing. */
const PRESET_BPS: Record<string, number> = {
  best: 4_500_000,
  v1080: 2_600_000,
  v720: 1_400_000,
  v480: 750_000,
  v360: 450_000,
  "a-mp3": 245_000,
  "a-m4a": 130_000,
};

const LOADING_LINES = ["Reading the page…", "Finding every quality…", "Measuring file sizes…", "Almost there…"];

function LoadingState({ url }: { url: string }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setI((n) => Math.min(n + 1, LOADING_LINES.length - 1)), 1800);
    return () => window.clearInterval(t);
  }, []);
  return (
    <div className="space-y-5 p-5 animate-fade-in">
      <div className="flex gap-4">
        <div className="relative aspect-video w-[220px] shrink-0 overflow-hidden rounded-xl">
          <Skeleton className="absolute inset-0 rounded-xl" />
          <div className="absolute inset-0 flex items-center justify-center">
            <Mark size={56} className="animate-breathe" />
          </div>
        </div>
        <div className="min-w-0 flex-1 space-y-2.5 pt-1">
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-3/5" />
          <div className="pt-2 text-[13px] font-medium text-ink-2">{LOADING_LINES[i]}</div>
          <div className="truncate text-[11.5px] text-ink-3">{hostOf(url)}</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, k) => (
          <Skeleton key={k} className="h-[86px] rounded-[14px]" />
        ))}
      </div>
    </div>
  );
}

export type AddFlowProps = {
  url: string;
  onDone: (result: { title: string; count: number; thumbnail?: string; label?: string; tonight?: boolean }) => void;
};

export function AddFlow({ url, onDone }: AddFlowProps) {
  const qc = useQueryClient();
  const inspect = useQuery({
    queryKey: ["inspect", url],
    queryFn: () => api.inspect(url),
    retry: false,
    staleTime: 120_000,
  });
  const status = useMediaStatus();
  const settings = useSettings();
  const estimate = useEstimate();

  const info: InspectResult | undefined = inspect.data;
  const options = useMemo(() => info?.options ?? [], [info]);
  const videoOptions = options.filter((o) => o.kind === "video");
  const audioOptions = options.filter((o) => o.kind === "audio");

  const [selectedId, setSelectedId] = useState("");
  const [filename, setFilename] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [execPending, setExecPending] = useState<Download | null>(null);
  const [tonight, setTonight] = useState(false);

  useEffect(() => {
    if (!info) return;
    const rec = info.options.find((o) => o.recommended) ?? info.options[0];
    setSelectedId(rec?.id ?? "");
    setFilename(info.filename || info.title || "");
    setRenaming(false);
    setPicked(new Set((info.entries ?? []).map((_, i) => i)));
  }, [info]);

  const selected = options.find((o) => o.id === selectedId);
  const kind = info?.kind;
  const blocked = !!info?.drm;
  const entries = info?.entries ?? [];

  const add = useMutation({
    mutationFn: async (mode: "inspected" | "direct-fallback") => {
      const addOne = (input: AddDownloadInput) => api.addDownload(tonight ? { ...input, when: "night" } : input);
      const name = renaming && filename.trim() !== (info?.filename || info?.title || "") ? filename.trim() : "";
      if (mode === "direct-fallback" || !info) {
        const dl = await addOne({ url, engine: "http" });
        return { dls: [dl], count: 1 };
      }
      if (info.kind === "playlist") {
        const chosen = entries.filter((_, i) => picked.has(i));
        const dls: Download[] = [];
        // A few at a time keeps the UI responsive on 300-video channels.
        for (let i = 0; i < chosen.length; i += 4) {
          const batch = await Promise.all(
            chosen.slice(i, i + 4).map((e) =>
              addOne({
                url: e.url,
                engine: "media",
                quality_id: selected?.id ?? "best",
                title: e.title,
                thumbnail: e.thumbnail,
                site: info.site,
                duration_seconds: e.duration_seconds,
              }),
            ),
          );
          dls.push(...batch);
        }
        return { dls, count: chosen.length };
      }
      const input: AddDownloadInput =
        info.kind === "media"
          ? {
              url: info.url || url,
              engine: "media",
              quality_id: selected?.id ?? "best",
              title: info.title,
              thumbnail: info.thumbnail,
              site: info.site,
              duration_seconds: info.duration_seconds,
              size_bytes: selected?.size_bytes,
            }
          : { url: info.url || url, engine: "http" };
      if (name) input.filename = name;
      const dl = await addOne(input);
      return { dls: [dl], count: 1 };
    },
    onSuccess: async ({ dls, count }) => {
      await qc.invalidateQueries({ queryKey: ["downloads"] });
      const needsOk = dls.find((d) => d.requires_exec_confirm && !d.exec_confirmed);
      if (needsOk) {
        setExecPending(needsOk);
        return;
      }
      onDone({
        title: info?.title || filename || hostOf(url),
        count,
        thumbnail: info?.thumbnail,
        label: kind === "direct" ? undefined : selected?.label,
        tonight,
      });
    },
  });

  const confirmExec = useMutation({
    mutationFn: (id: string) => api.confirmExecutable(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["downloads"] });
      onDone({ title: info?.title || filename || hostOf(url), count: 1 });
    },
  });
  const discardExec = useMutation({
    mutationFn: (id: string) => api.deleteDownload(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["downloads"] });
      setExecPending(null);
    },
  });

  const canSubmit =
    !!info && !blocked && !add.isPending && (kind === "direct" || !!selected) && (kind !== "playlist" || picked.size > 0);
  const submit = useCallback(() => {
    if (canSubmit) add.mutate("inspected");
  }, [canSubmit, add]);

  // Enter downloads, ←/→ moves through qualities (when not typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        if (typing && (e.target as HTMLInputElement).dataset.spotlight !== "1" && !renaming) return;
        if (canSubmit) {
          e.preventDefault();
          submit();
        }
        return;
      }
      if (typing || options.length === 0) return;
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const i = Math.max(0, options.findIndex((o) => o.id === selectedId));
        const next = (i + (e.key === "ArrowRight" ? 1 : -1) + options.length) % options.length;
        setSelectedId(options[next].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [submit, canSubmit, options, selectedId, renaming]);

  const engineMissing = status.data && !status.data.available;
  const host = hostOf(url);
  const screen = screenRes();
  const pref = settings.data?.preferred_quality ?? "";

  if (inspect.isLoading) return <LoadingState url={url} />;

  if (inspect.isError) {
    return (
      <div className="space-y-4 p-5 animate-fade-in">
        <div className="flex gap-3 rounded-2xl bg-bad/[0.08] p-4">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-bad" />
          <div className="min-w-0 text-[13px]">
            <div className="font-semibold">Couldn't read this link</div>
            <div className="mt-1 break-words text-ink-2">{(inspect.error as Error).message}</div>
            {engineMissing ? (
              <div className="mt-2 text-[12px] text-ink-3">
                Streaming sites need <span className="font-mono">yt-dlp</span> and ffmpeg. Install them, then try again.
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void inspect.refetch()}>
            <RotateCcw className="h-4 w-4" />
            Try again
          </Button>
          <Button onClick={() => add.mutate("direct-fallback")} disabled={add.isPending}>
            <FolderDown className="h-4 w-4" />
            Download as a plain file
          </Button>
        </div>
      </div>
    );
  }

  if (!info) return null;

  if (execPending) {
    return (
      <div className="space-y-4 p-5 animate-fade-in">
        <div className="flex gap-3 rounded-2xl bg-warn/[0.1] p-4">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-warn" />
          <div className="text-[13px]">
            <div className="font-semibold">This is a program or installer</div>
            <div className="mt-1 text-ink-2">
              Programs can change your computer. Only continue if you trust <span className="font-medium text-ink">{host}</span>.
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button onClick={() => discardExec.mutate(execPending.id)}>Don't download</Button>
          <Button variant="primary" onClick={() => confirmExec.mutate(execPending.id)}>
            Download anyway
          </Button>
        </div>
      </div>
    );
  }

  const totalPlaylist = entries.filter((_, i) => picked.has(i)).reduce((a, e) => a + (e.duration_seconds || 0), 0);
  // Playlist presets carry no sizes; estimate them from the selected videos' total length.
  const sized = (o: QualityOption): QualityOption =>
    kind === "playlist" && totalPlaylist > 0 && PRESET_BPS[o.id] ? { ...o, size_bytes: (totalPlaylist * PRESET_BPS[o.id]) / 8 } : o;
  const estFor = (o?: QualityOption) => estimate(o ? sized(o).size_bytes : 0);
  const selectedSized = selected ? sized(selected) : undefined;

  let smartLine = "";
  if (selected?.recommended && kind === "media") {
    const est = formatEstimate(estFor(selected));
    const top = videoOptions.reduce((m, o) => Math.max(m, o.height), 0);
    if (pref) smartLine = `${selected.label} is your preferred quality`;
    else if (selected.kind === "video" && selected.height > 0 && selected.height === top)
      smartLine = `${selected.label} is the best this video offers`;
    else if (selected.kind === "video" && selected.height > 0 && selected.height <= screen)
      smartLine = `${selected.label} looks sharp on your ${screenName(screen)} screen without wasting data`;
    else smartLine = `${selected.label} is the best balance of quality and size`;
    if (est) smartLine += ` · ready in ${est}`;
  }

  const night = `${settings.data?.night_start ?? "00:00"}–${settings.data?.night_end ?? "06:00"}`;
  const baseLabel = blocked
    ? "Not available"
    : kind === "playlist"
      ? `Download ${picked.size} ${picked.size === 1 ? "video" : "videos"}${selected ? ` · ${selected.label}` : ""}${selectedSized && selectedSized.size_bytes > 0 ? ` · ≈ ${formatBytes(selectedSized.size_bytes)}` : ""}`
      : kind === "media" && selected
        ? `Download ${selected.label}${selected.size_bytes > 0 ? ` · ${formatBytes(selected.size_bytes)}` : ""}`
        : `Download${info.size_bytes > 0 ? ` · ${formatBytes(info.size_bytes)}` : ""}`;
  const buttonLabel = tonight && !blocked ? baseLabel.replace(/^Download/, "Download tonight") : baseLabel;

  return (
    <div className="animate-fade-in">
      <div className="space-y-5 p-5">
        {/* Header: what is this? */}
        <div className="flex gap-4">
          {kind === "direct" ? (
            <FileGlyph
              kind={fileKind({ mime: info.mime_type, filename: info.filename })}
              className="aspect-video w-[200px] shrink-0 rounded-xl"
            />
          ) : (
            <Thumb
              src={info.thumbnail}
              kind="video"
              duration={kind === "media" ? info.duration_seconds : undefined}
              live={info.is_live}
              className="w-[220px] shadow-float"
              rounded="rounded-xl"
            >
              {kind === "playlist" ? (
                <span className="absolute inset-y-0 right-0 flex w-[38%] flex-col items-center justify-center gap-1 bg-black/60 text-white backdrop-blur-md">
                  <ListVideo className="h-5 w-5" />
                  <span className="num text-[15px] font-bold">{entries.length}</span>
                  <span className="text-[10px] font-semibold uppercase tracking-wide opacity-80">videos</span>
                </span>
              ) : null}
            </Thumb>
          )}
          <div className="min-w-0 flex-1">
            <div className="line-clamp-2 text-[17px] font-semibold leading-snug tracking-[-0.015em]" title={info.title}>
              {info.title || info.filename || host}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {info.site ? <Badge tone="accent">{info.site}</Badge> : null}
              {info.uploader ? <Badge>{info.uploader}</Badge> : null}
              {kind === "playlist" ? <Badge>{formatDuration(info.duration_seconds) || `${entries.length} videos`}</Badge> : null}
              {info.is_live ? <Badge tone="danger">LIVE</Badge> : null}
              {info.drm ? (
                <Badge tone="danger">
                  <Lock />
                  DRM
                </Badge>
              ) : null}
              {kind === "direct" && info.mime_type ? <Badge>{info.mime_type}</Badge> : null}
              {kind === "direct" ? <Badge tone="accent">{formatBytes(info.size_bytes, "Size unknown")}</Badge> : null}
            </div>
            {kind !== "playlist" ? (
              renaming ? (
                <Input
                  autoFocus
                  className="mt-3"
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                  disabled={blocked}
                  aria-label="File name"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setRenaming(true)}
                  disabled={blocked}
                  className="group mt-3 flex max-w-full items-center gap-1.5 rounded-md text-[12px] text-ink-3 transition hover:text-ink"
                >
                  <span className="truncate">Save as “{filename || host}”</span>
                  <Pencil className="h-3 w-3 shrink-0 opacity-60 group-hover:opacity-100" />
                </button>
              )
            ) : null}
          </div>
        </div>

        {blocked ? (
          <div className="flex gap-3 rounded-2xl bg-warn/[0.1] p-4 text-[13px]">
            <Lock className="mt-0.5 h-5 w-5 shrink-0 text-warn" />
            <div>
              <div className="font-semibold">Protected with DRM</div>
              <div className="mt-1 text-ink-2">
                This video is encrypted by its owner. CatalystFDM doesn't download DRM content — watch it on the site instead.
              </div>
            </div>
          </div>
        ) : null}

        {smartLine ? (
          <div className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-accent/[0.1] to-transparent px-3 py-2 text-[12.5px] text-ink-2">
            <Sparkles className="h-3.5 w-3.5 shrink-0 text-accent" />
            <span>{smartLine}</span>
          </div>
        ) : null}

        {kind !== "direct" && !blocked && videoOptions.length > 0 ? (
          <section>
            <div className="section-label mb-2.5 flex items-center gap-1.5">
              <MonitorPlay className="h-3.5 w-3.5" />
              {kind === "playlist" ? "Video quality for every item" : "Video"}
            </div>
            <div role="radiogroup" aria-label="Video quality" className="grid grid-cols-2 gap-2.5 pt-1 sm:grid-cols-3 md:grid-cols-4">
              {videoOptions.map((o) => (
                <QualityTile
                  key={o.id}
                  option={sized(o)}
                  approx={kind === "playlist"}
                  selected={o.id === selectedId}
                  onSelect={() => setSelectedId(o.id)}
                  estimate={estFor(o)}
                />
              ))}
            </div>
          </section>
        ) : null}

        {kind !== "direct" && !blocked && audioOptions.length > 0 ? (
          <section>
            <div className="section-label mb-2.5 flex items-center gap-1.5">
              <Headphones className="h-3.5 w-3.5" />
              Audio only
            </div>
            <div role="radiogroup" aria-label="Audio format" className="grid grid-cols-2 gap-2.5 pt-1 sm:grid-cols-3 md:grid-cols-4">
              {audioOptions.map((o) => (
                <QualityTile
                  key={o.id}
                  option={sized(o)}
                  approx={kind === "playlist"}
                  selected={o.id === selectedId}
                  onSelect={() => setSelectedId(o.id)}
                  estimate={estFor(o)}
                />
              ))}
            </div>
          </section>
        ) : null}

        {kind === "playlist" ? (
          <section>
            <div className="mb-2 flex items-center justify-between">
              <div className="section-label flex items-center gap-1.5">
                <ListVideo className="h-3.5 w-3.5" />
                {picked.size} of {entries.length} selected{totalPlaylist ? ` · ${formatDuration(totalPlaylist)}` : ""}
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="plain" onClick={() => setPicked(new Set(entries.map((_, i) => i)))}>
                  Select all
                </Button>
                <Button size="sm" variant="plain" onClick={() => setPicked(new Set())}>
                  None
                </Button>
              </div>
            </div>
            <div className="max-h-[260px] divide-y divide-line overflow-y-auto rounded-xl bg-fill/[0.05] shadow-[inset_0_0_0_0.5px_rgb(var(--line-strong)/0.8)]">
              {entries.map((e, i) => {
                const on = picked.has(i);
                return (
                  <label key={`${e.url}-${i}`} className="flex cursor-pointer items-center gap-3 px-3 py-2 transition hover:bg-fill/[0.06]">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => {
                        const next = new Set(picked);
                        if (on) next.delete(i);
                        else next.add(i);
                        setPicked(next);
                      }}
                      className="h-4 w-4 shrink-0 accent-[rgb(var(--accent))]"
                    />
                    <span className="num w-6 shrink-0 text-right text-[11px] text-ink-3">{i + 1}</span>
                    <Thumb src={e.thumbnail} kind="video" className="w-[72px]" rounded="rounded-md" />
                    <span className={cn("min-w-0 flex-1 truncate text-[13px]", !on && "text-ink-3")}>{e.title || e.url}</span>
                    <span className="num shrink-0 text-[11.5px] text-ink-3">{formatDuration(e.duration_seconds)}</span>
                  </label>
                );
              })}
            </div>
          </section>
        ) : null}

        {add.isError ? (
          <div className="rounded-xl bg-bad/[0.08] px-3 py-2.5 text-[13px] text-bad">{(add.error as Error).message}</div>
        ) : null}
      </div>

      <div className="glass-strong sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 px-5 py-3 hairline-t">
        <div className="min-w-0 flex-1 text-[11.5px] text-ink-3">
          {tonight ? (
            <div className="leading-snug text-ink-2">
              <span className="font-semibold text-ink">Waits for night data ({night}).</span> If it isn't done by morning it pauses and
              carries on the next night.
            </div>
          ) : (
          <span className="hidden items-center gap-1 sm:inline-flex">
            <Kbd>↵</Kbd> download
            {kind !== "direct" ? (
              <>
                <span className="mx-1">·</span>
                <Kbd>←</Kbd>
                <Kbd>→</Kbd> quality
              </>
            ) : null}
          </span>
          )}
          {settings.data?.download_directory ? (
            <div className="truncate" title={settings.data.download_directory}>
              Saves to <span className="font-mono text-[11px]">{settings.data.download_directory}</span>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setTonight((v) => !v)}
          aria-pressed={tonight}
          disabled={blocked}
          title={`Cheaper night bundles: wait until ${night}`}
          className={cn(
            "flex h-11 shrink-0 items-center gap-2 rounded-full px-4 text-[13px] font-semibold transition duration-200 ease-spring active:scale-[0.97] disabled:opacity-40",
            tonight
              ? "bg-gradient-to-br from-[#1e1b4b] to-[#312e81] text-[#c7d2fe] shadow-[0_0_0_1px_rgb(129_140_248/0.5),0_6px_18px_-6px_rgb(49_46_129/0.8)]"
              : "bg-fill/[0.12] text-ink-2 hover:bg-fill/[0.18] hover:text-ink",
          )}
        >
          <Moon className="h-4 w-4" fill={tonight ? "currentColor" : "none"} />
          Tonight
        </button>
        <Button variant="primary" size="lg" onClick={submit} disabled={!canSubmit} className="min-w-[200px]">
          {add.isPending ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          ) : (
            <ArrowDownToLine className="h-[18px] w-[18px]" />
          )}
          {buttonLabel}
        </Button>
      </div>
    </div>
  );
}
