import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, ListOrdered, Pause, Play } from "lucide-react";
import { api } from "@/lib/api";
import { displayTitle, formatBytes } from "@/lib/format";
import { useSettings } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { Page } from "@/components/Layout";
import { DownloadBadges, DownloadThumb } from "@/components/media";
import { statusLine } from "@/components/DownloadCards";
import { Badge, Button, EmptyState, IconButton, Panel } from "@/components/ui";

const LIVE = new Set(["active", "queued", "pending", "paused"]);

export default function QueuePage() {
  const qc = useQueryClient();
  const settings = useSettings();
  const q = useQuery({ queryKey: ["queue"], queryFn: api.queue, refetchInterval: 1500 });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["queue"] });
    void qc.invalidateQueries({ queryKey: ["downloads"] });
  };
  const startAll = useMutation({ mutationFn: api.queueStartAll, onSettled: refresh });
  const pauseAll = useMutation({ mutationFn: api.queuePauseAll, onSettled: refresh });
  const up = useMutation({ mutationFn: api.queueMoveUp, onSettled: refresh });
  const down = useMutation({ mutationFn: api.queueMoveDown, onSettled: refresh });

  const items = (q.data ?? []).filter((qi) => qi.download && LIVE.has(qi.download.status));
  const slots = settings.data?.max_concurrent_downloads ?? 3;

  return (
    <Page
      title="Queue"
      subtitle={`Downloads run ${slots} at a time, top to bottom. Change it in Settings.`}
      actions={
        items.length ? (
          <>
            <Button onClick={() => startAll.mutate()}>
              <Play className="h-3.5 w-3.5" fill="currentColor" />
              Start all
            </Button>
            <Button onClick={() => pauseAll.mutate()}>
              <Pause className="h-3.5 w-3.5" fill="currentColor" />
              Pause all
            </Button>
          </>
        ) : null
      }
    >
      {items.length === 0 ? (
        <EmptyState icon={<ListOrdered />} title="The queue is empty">
          When you add more downloads than can run at once, they wait here in order.
        </EmptyState>
      ) : (
        <Panel className="divide-y divide-line overflow-hidden">
          {items.map((qi, i) => {
            const d = qi.download!;
            return (
              <div key={qi.id} className="flex items-center gap-3 px-3 py-2.5 animate-fade-up">
                <span className="num w-6 text-center text-[13px] font-semibold text-ink-3">{i + 1}</span>
                <DownloadThumb d={d} className="w-[88px]" rounded="rounded-lg" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-semibold">{displayTitle(d)}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-ink-3">
                    <DownloadBadges d={d} />
                    <span
                      className={cn(
                        d.status === "active" && "font-medium text-accent-ink dark:text-accent",
                        d.status === "paused" && "text-warn",
                      )}
                    >
                      {statusLine(d)}
                    </span>
                    {d.file_size > 0 ? <span className="num">· {formatBytes(d.file_size)}</span> : null}
                  </div>
                </div>
                {qi.priority > 0 ? <Badge tone="accent">Priority {qi.priority}</Badge> : null}
                <div className="flex gap-1">
                  <IconButton size="sm" label="Move up" disabled={i === 0} onClick={() => up.mutate(qi.id)}>
                    <ChevronUp />
                  </IconButton>
                  <IconButton size="sm" label="Move down" disabled={i === items.length - 1} onClick={() => down.mutate(qi.id)}>
                    <ChevronDown />
                  </IconButton>
                </div>
              </div>
            );
          })}
        </Panel>
      )}
    </Page>
  );
}
