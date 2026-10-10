import { useState } from "react";
import { File, FileArchive, FileImage, FileText, Film, Music, Package, type LucideIcon } from "lucide-react";
import { api, type Download } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/format";
import { Badge } from "./ui";

const VIDEO_EXT = /^(mp4|mkv|webm|mov|avi|m4v|3gp|ts|flv)$/i;
const AUDIO_EXT = /^(mp3|m4a|aac|wav|flac|ogg|opus)$/i;

export type FileKind = "video" | "audio" | "image" | "archive" | "software" | "document" | "file";

/** Picks a kind from whatever type hints we have: category, extension, or MIME type. */
export function fileKind(hint: { category?: string; extension?: string; mime?: string; filename?: string }): FileKind {
  const ext = (hint.extension || hint.filename?.split(".").pop() || "").replace(/^\./, "").toLowerCase();
  const mime = (hint.mime || "").toLowerCase();
  const cat = (hint.category || "").toLowerCase();
  if (cat === "video" || mime.startsWith("video/") || VIDEO_EXT.test(ext)) return "video";
  if (cat === "audio" || mime.startsWith("audio/") || AUDIO_EXT.test(ext)) return "audio";
  if (cat === "images" || mime.startsWith("image/")) return "image";
  if (cat === "archives" || /^(zip|rar|7z|tar|gz|xz|bz2)$/.test(ext)) return "archive";
  if (cat === "software") return "software";
  if (cat === "documents" || mime.startsWith("text/") || mime === "application/pdf") return "document";
  return "file";
}

export const downloadKind = (d: Download) =>
  fileKind({ category: d.category, extension: d.extension, mime: d.mime_type, filename: d.filename });

const KIND_ICON: Record<FileKind, LucideIcon> = {
  video: Film,
  audio: Music,
  image: FileImage,
  archive: FileArchive,
  software: Package,
  document: FileText,
  file: File,
};

const KIND_TINT: Record<FileKind, string> = {
  video: "from-[#0b1733] via-[#00316b] to-[#0b7fd4]",
  audio: "from-[#3b1d6e] via-[#7c3aed] to-[#c084fc]",
  image: "from-[#064e3b] via-[#047857] to-[#34d399]",
  archive: "from-[#78350f] via-[#b45309] to-[#fbbf24]",
  software: "from-[#1e293b] via-[#334155] to-[#64748b]",
  document: "from-[#1e3a8a] via-[#2563eb] to-[#93c5fd]",
  file: "from-[#1e293b] via-[#475569] to-[#94a3b8]",
};

export function FileGlyph({ kind, className }: { kind: FileKind; className?: string }) {
  const Icon = KIND_ICON[kind];
  return (
    <div className={cn("relative flex items-center justify-center overflow-hidden bg-gradient-to-br text-white", KIND_TINT[kind], className)}>
      <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_20%_0%,rgb(255_255_255/0.25),transparent_60%)]" />
      <Icon className="relative h-[32%] max-h-10 min-h-4 w-[32%] min-w-4 max-w-10 opacity-90 drop-shadow" strokeWidth={1.6} />
    </div>
  );
}

/** 16:9 thumbnail with a type-gradient fallback and an optional duration chip. */
export function Thumb({
  src,
  kind,
  duration,
  className,
  live,
  rounded = "rounded-[10px]",
  children,
}: {
  src?: string;
  kind: FileKind;
  duration?: number;
  className?: string;
  live?: boolean;
  rounded?: string;
  children?: React.ReactNode;
}) {
  const [broken, setBroken] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const dur = formatDuration(duration);
  return (
    <div className={cn("relative aspect-video shrink-0 overflow-hidden bg-surface-3 shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.08)]", rounded, className)}>
      {src && !broken ? (
        <>
          {!loaded ? <div className="skeleton absolute inset-0" /> : null}
          <img
            src={src}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onLoad={() => setLoaded(true)}
            onError={() => setBroken(true)}
            className={cn("h-full w-full object-cover transition duration-500", loaded ? "opacity-100" : "opacity-0")}
          />
        </>
      ) : (
        <FileGlyph kind={kind} className="h-full w-full" />
      )}
      {live ? (
        <span className="absolute left-1.5 top-1.5 rounded-md bg-bad px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
          Live
        </span>
      ) : null}
      {dur ? (
        <span className="num absolute bottom-1.5 right-1.5 rounded-md bg-black/65 px-1.5 py-[1px] text-[10.5px] font-semibold text-white backdrop-blur-sm">
          {dur}
        </span>
      ) : null}
      {children}
    </div>
  );
}

/** Site thumbnail, else (finished videos) a poster frame the engine grabs from the file. */
export function thumbFor(d: Download): string | undefined {
  if (d.thumbnail) return d.thumbnail;
  if (d.status === "completed" && downloadKind(d) === "video") return api.posterUrl(d.id);
  return undefined;
}

export function DownloadThumb({ d, className, children, rounded }: { d: Download; className?: string; children?: React.ReactNode; rounded?: string }) {
  return (
    <Thumb src={thumbFor(d)} kind={downloadKind(d)} duration={d.duration_seconds} className={className} rounded={rounded}>
      {children}
    </Thumb>
  );
}

export function DownloadBadges({ d, className }: { d: Download; className?: string }) {
  const site = d.site?.trim();
  const quality = d.quality_label?.trim();
  if (!site && !quality) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {quality ? <Badge tone="accent">{quality}</Badge> : null}
      {site ? <Badge>{site}</Badge> : null}
    </div>
  );
}
