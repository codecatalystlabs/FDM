import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDownToLine, Pause, Play, Plus } from "lucide-react";
import { api, type Download } from "@/lib/api";
import { formatSpeed } from "@/lib/format";
import { isLive, useDownloads, useSpeedHistory } from "@/lib/hooks";
import { useActions } from "@/lib/actions";
import { Page } from "@/components/Layout";
import { ActiveCard, isNightWaiting } from "@/components/DownloadCards";
import { Button, EmptyState, Skeleton } from "@/components/ui";

function Section({ title, items }: { title: string; items: Download[] }) {
  if (!items.length) return null;
  return (
    <section className="mb-7">
      <div className="section-label mb-2.5 px-1">
        {title} · {items.length}
      </div>
      <div className="space-y-2.5">
        {items.map((d) => (
          <ActiveCard key={d.id} d={d} />
        ))}
      </div>
    </section>
  );
}

export default function Downloading() {
  const qc = useQueryClient();
  const { openSpotlight } = useActions();
  const q = useDownloads();
  const speeds = useSpeedHistory();
  const items = (q.data?.items ?? []).filter(isLive);
  const needsOk = items.filter((d) => d.requires_exec_confirm && !d.exec_confirmed);
  const rest = items.filter((d) => !needsOk.includes(d));
  const active = rest.filter((d) => d.status === "active");
  const waiting = rest.filter((d) => d.status === "queued" || d.status === "pending");
  const tonight = rest.filter(isNightWaiting);
  const paused = rest.filter((d) => d.status === "paused" && !isNightWaiting(d));

  const refresh = () => void qc.invalidateQueries({ queryKey: ["downloads"] });
  const pauseAll = useMutation({ mutationFn: api.queuePauseAll, onSettled: refresh });
  const startAll = useMutation({ mutationFn: api.queueStartAll, onSettled: refresh });

  const speed = speeds[speeds.length - 1] ?? 0;

  return (
    <Page
      title="Downloading"
      subtitle={
        items.length
          ? `${active.length} active${waiting.length ? ` · ${waiting.length} up next` : ""}${tonight.length ? ` · ${tonight.length} tonight` : ""}${paused.length ? ` · ${paused.length} paused` : ""}${active.length ? ` · ${formatSpeed(speed)}` : ""}`
          : "Live progress for everything on its way"
      }
      actions={
        items.length ? (
          <>
            {paused.length ? (
              <Button onClick={() => startAll.mutate()}>
                <Play className="h-3.5 w-3.5" fill="currentColor" />
                Resume all
              </Button>
            ) : null}
            {active.length || waiting.length ? (
              <Button onClick={() => pauseAll.mutate()}>
                <Pause className="h-3.5 w-3.5" fill="currentColor" />
                Pause all
              </Button>
            ) : null}
          </>
        ) : null
      }
    >
      {q.isLoading ? (
        <div className="space-y-2.5">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[104px] rounded-2xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<ArrowDownToLine />}
          title="Nothing downloading"
          action={
            <Button variant="primary" onClick={() => openSpotlight()}>
              <Plus className="h-4 w-4" />
              New download
            </Button>
          }
        >
          Paste a link anywhere in the window, or use the download button your browser shows on videos.
        </EmptyState>
      ) : (
        <>
          <Section title="Needs your OK" items={needsOk} />
          <Section title="Active" items={active} />
          <Section title="Up next" items={waiting} />
          <Section title="Tonight · night data" items={tonight} />
          <Section title="Paused" items={paused} />
        </>
      )}
    </Page>
  );
}
