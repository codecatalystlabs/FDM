import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Pause, Play } from "lucide-react";
import { api } from "@/lib/api";
import { Button, Card } from "@/components/ui";

export default function QueuePage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["queue"], queryFn: api.queue, refetchInterval: 1500 });

  const startAll = useMutation({
    mutationFn: api.queueStartAll,
    onSuccess: () => qc.invalidateQueries(),
  });
  const pauseAll = useMutation({
    mutationFn: api.queuePauseAll,
    onSuccess: () => qc.invalidateQueries(),
  });
  const up = useMutation({
    mutationFn: api.queueMoveUp,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["queue"] }),
  });
  const down = useMutation({
    mutationFn: api.queueMoveDown,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["queue"] }),
  });

  const items = q.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Queue</h1>
          <p className="mt-1 text-sm text-muted">Ordering and bulk controls (MVP).</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => startAll.mutate()}>
            <Play className="mr-2 h-4 w-4" />
            Start all
          </Button>
          <Button variant="outline" onClick={() => pauseAll.mutate()}>
            <Pause className="mr-2 h-4 w-4" />
            Pause all
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="grid grid-cols-12 gap-2 border-b border-white/10 px-4 py-3 text-xs font-semibold uppercase text-muted html.light:border-slate-200">
          <div className="col-span-5">Download</div>
          <div className="col-span-2">Priority</div>
          <div className="col-span-2">Position</div>
          <div className="col-span-3 text-right">Actions</div>
        </div>
        <div className="divide-y divide-white/10 html.light:divide-slate-200">
          {items.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted">Queue is empty.</div>
          ) : (
            items.map((qi) => (
              <div key={qi.id} className="grid grid-cols-12 items-center gap-2 px-4 py-3 text-sm">
                <div className="col-span-5 min-w-0">
                  <div className="truncate font-medium">{qi.download?.filename ?? qi.download_id}</div>
                  <div className="truncate text-xs text-muted">{qi.download?.url}</div>
                </div>
                <div className="col-span-2 font-mono text-xs">{qi.priority}</div>
                <div className="col-span-2 font-mono text-xs">{qi.position}</div>
                <div className="col-span-3 flex justify-end gap-2">
                  <Button variant="outline" onClick={() => up.mutate(qi.id)} title="Move up">
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" onClick={() => down.mutate(qi.id)} title="Move down">
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
