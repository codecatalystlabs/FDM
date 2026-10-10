import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LayoutGrid, Library as LibraryIcon, List, Trash2 } from "lucide-react";
import { api, type Download } from "@/lib/api";
import { displayTitle, formatBytes } from "@/lib/format";
import { useDownloads } from "@/lib/hooks";
import { usePref } from "@/lib/prefs";
import { useActions } from "@/lib/actions";
import { Page } from "@/components/Layout";
import { LibraryCard, LibraryRow } from "@/components/DownloadCards";
import { downloadKind } from "@/components/media";
import { canPreview } from "@/components/QuickLook";
import { Button, EmptyState, Panel, SearchField, Segmented, Sheet, Skeleton } from "@/components/ui";
import { useToast } from "@/components/Toasts";

type Filter = "all" | "video" | "audio" | "other";

export default function LibraryPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { openSpotlight, quickLook } = useActions();
  const q = useDownloads();
  const [view, setView] = usePref("libraryView");
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [toDelete, setToDelete] = useState<Download | null>(null);
  const hovered = useRef<Download | null>(null);

  const all = useMemo(() => (q.data?.items ?? []).filter((d) => d.status === "completed"), [q.data]);
  const items = useMemo(() => {
    const s = search.trim().toLowerCase();
    return all.filter((d) => {
      const k = downloadKind(d);
      if (filter === "video" && k !== "video") return false;
      if (filter === "audio" && k !== "audio") return false;
      if (filter === "other" && (k === "video" || k === "audio")) return false;
      if (!s) return true;
      return `${displayTitle(d)} ${d.site ?? ""} ${d.filename}`.toLowerCase().includes(s);
    });
  }, [all, filter, search]);
  const total = all.reduce((a, d) => a + (d.file_size > 0 ? d.file_size : 0), 0);

  // Space previews the item under the pointer, like Quick Look in Finder.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== " " || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (hovered.current && canPreview(hovered.current)) {
        e.preventDefault();
        quickLook(hovered.current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [quickLook]);
  const track = (d: Download) => ({
    onMouseEnter: () => (hovered.current = d),
    onMouseLeave: () => {
      if (hovered.current?.id === d.id) hovered.current = null;
    },
  });

  const delFile = useMutation({
    mutationFn: (d: Download) => api.deleteDownloadFile(d.id),
    onSuccess: (_r, d) => toast({ title: "File deleted", subtitle: displayTitle(d), tone: "success" }),
    onError: (e: Error) => toast({ title: "Couldn't delete the file", subtitle: e.message, tone: "error" }),
    onSettled: () => {
      setToDelete(null);
      void qc.invalidateQueries({ queryKey: ["downloads"] });
    },
  });

  return (
    <Page
      title="Library"
      subtitle={all.length ? `${all.length} ${all.length === 1 ? "item" : "items"} · ${formatBytes(total, "0 B")}` : "Everything you've downloaded"}
      wide
      actions={
        all.length ? (
          <>
            <SearchField value={search} onChange={setSearch} placeholder="Search library" className="w-56" />
            <Segmented
              size="sm"
              value={view}
              onChange={setView}
              options={[
                { value: "grid", label: <LayoutGrid />, title: "Grid" },
                { value: "list", label: <List />, title: "List" },
              ]}
            />
          </>
        ) : null
      }
    >
      {all.length ? (
        <div className="mb-5">
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All" },
              { value: "video", label: "Videos" },
              { value: "audio", label: "Music" },
              { value: "other", label: "Files" },
            ]}
          />
        </div>
      ) : null}

      {q.isLoading ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="aspect-video rounded-[14px]" />
          ))}
        </div>
      ) : all.length === 0 ? (
        <EmptyState
          icon={<LibraryIcon />}
          title="No downloads yet"
          action={
            <Button variant="primary" onClick={() => openSpotlight()}>
              Start a download
            </Button>
          }
        >
          Finished videos, music and files land here, ready to play right in the app.
        </EmptyState>
      ) : items.length === 0 ? (
        <EmptyState icon={<LibraryIcon />} title="Nothing matches">
          Try another search or filter.
        </EmptyState>
      ) : view === "grid" ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {items.map((d) => (
            <div key={d.id} {...track(d)}>
              <LibraryCard d={d} />
            </div>
          ))}
        </div>
      ) : (
        <Panel className="divide-y divide-line overflow-hidden">
          {items.map((d) => (
            <div key={d.id} {...track(d)}>
              <LibraryRow d={d} onDeleteFile={setToDelete} />
            </div>
          ))}
        </Panel>
      )}

      <Sheet open={!!toDelete} onClose={() => setToDelete(null)} label="Delete file" className="max-w-[340px]">
        {toDelete ? (
          <div className="p-6 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-bad/[0.12] text-bad">
              <Trash2 className="h-6 w-6" />
            </div>
            <div className="text-headline">Delete this file?</div>
            <p className="mt-1.5 line-clamp-3 text-[13px] text-ink-2">
              “{displayTitle(toDelete)}” will be removed from your computer. This can't be undone.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <Button onClick={() => setToDelete(null)}>Cancel</Button>
              <Button variant="destructive" onClick={() => delFile.mutate(toDelete)} disabled={delFile.isPending}>
                Delete
              </Button>
            </div>
          </div>
        ) : null}
      </Sheet>
    </Page>
  );
}
