import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ExternalLink, FolderOpen, X } from "lucide-react";
import { api, type Download } from "@/lib/api";
import { displayTitle, formatBytes, formatDuration } from "@/lib/format";
import { Badge, IconButton } from "./ui";
import { FileGlyph, downloadKind } from "./media";
import { useToast } from "./Toasts";

/* Quick Look: press Space (or click Play) on a finished download to watch or listen right in
 * the app. The engine streams the file with byte ranges, so seeking is instant. */

export function canPreview(d: Download) {
  const k = downloadKind(d);
  return d.status === "completed" && (k === "video" || k === "audio" || k === "image");
}

export function QuickLook({ d, onClose }: { d: Download | null; onClose: () => void }) {
  const toast = useToast();
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [d?.id]);
  useEffect(() => {
    if (!d) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || (e.key === " " && !(e.target instanceof HTMLMediaElement))) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [d, onClose]);

  const open = useMutation({
    mutationFn: (id: string) => api.openFile(id),
    onError: (e: Error) => toast({ title: "Couldn't open the file", subtitle: e.message, tone: "error" }),
  });
  const reveal = useMutation({
    mutationFn: (id: string) => api.revealFile(id),
    onError: (e: Error) => toast({ title: "Couldn't show the file", subtitle: e.message, tone: "error" }),
  });

  if (!d) return null;
  const kind = downloadKind(d);
  const src = api.streamUrl(d.id);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 animate-fade-in backdrop-blur-md"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label={`Preview ${displayTitle(d)}`}
    >
      <div className="flex max-h-full w-full max-w-5xl animate-scale-in flex-col overflow-hidden rounded-2xl bg-[#0b1220] text-white shadow-sheet">
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-semibold">{displayTitle(d)}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-white/60">
              {d.quality_label ? <Badge className="bg-white/15 text-white">{d.quality_label}</Badge> : null}
              {d.site ? <span>{d.site}</span> : null}
              <span>{formatBytes(d.file_size)}</span>
              {d.duration_seconds ? <span>· {formatDuration(d.duration_seconds)}</span> : null}
            </div>
          </div>
          <IconButton label="Open with default app" variant="glass" className="bg-white/10 text-white" onClick={() => open.mutate(d.id)}>
            <ExternalLink />
          </IconButton>
          <IconButton label="Show in folder" variant="glass" className="bg-white/10 text-white" onClick={() => reveal.mutate(d.id)}>
            <FolderOpen />
          </IconButton>
          <IconButton label="Close (Esc)" variant="glass" className="bg-white/10 text-white" onClick={onClose}>
            <X />
          </IconButton>
        </div>
        <div className="flex min-h-[200px] flex-1 items-center justify-center bg-black">
          {failed ? (
            <div className="p-10 text-center text-[13px] text-white/70">
              This file can't be previewed here. Use <span className="font-semibold text-white">Open</span> to play it in your
              usual app.
            </div>
          ) : kind === "video" ? (
            <video src={src} controls autoPlay className="max-h-[75vh] w-full bg-black" onError={() => setFailed(true)} />
          ) : kind === "audio" ? (
            <div className="flex w-full flex-col items-center gap-6 p-10">
              {d.thumbnail ? (
                <img src={d.thumbnail} alt="" referrerPolicy="no-referrer" className="aspect-square w-56 rounded-2xl object-cover shadow-2xl" />
              ) : (
                <FileGlyph kind="audio" className="aspect-square w-56 rounded-2xl" />
              )}
              <audio src={src} controls autoPlay className="w-full max-w-lg" onError={() => setFailed(true)} />
            </div>
          ) : (
            <img src={src} alt="" className="max-h-[75vh] object-contain" onError={() => setFailed(true)} />
          )}
        </div>
      </div>
    </div>
  );
}
