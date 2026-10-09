import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pause, Play, RotateCcw, Square } from "lucide-react";
import { api } from "@/lib/api";
import { Button, Card, Progress } from "@/components/ui";

export default function ActiveDownloads() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["downloads", "active"],
    queryFn: () => api.listDownloads({}),
    refetchInterval: 800,
  });

  const items = (q.data?.items ?? []).filter((d) => d.status === "active" || d.status === "queued" || d.status === "paused");

  const pause = useMutation({
    mutationFn: api.pause,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["downloads"] }),
  });
  const resume = useMutation({
    mutationFn: api.resume,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["downloads"] }),
  });
  const cancel = useMutation({
    mutationFn: api.cancel,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["downloads"] }),
  });
  const retry = useMutation({
    mutationFn: api.retry,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["downloads"] }),
  });

  const fmtBytes = (n: number) => {
    if (!n || n < 0) return "—";
    if (n > 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
    if (n > 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${n} B`;
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Active downloads</h1>
        <p className="mt-1 text-sm text-muted">Live progress, speed, and ETA from the Go engine.</p>
      </div>

      <div className="space-y-3">
        {items.length === 0 ? (
          <Card className="p-10 text-center text-sm text-muted">No active downloads right now.</Card>
        ) : (
          items.map((d) => (
            <Card key={d.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{d.filename}</div>
                  <div className="truncate text-xs text-muted">{d.url}</div>
                  <div className="mt-3">
                    <Progress value={d.progress_percent || 0} />
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted md:grid-cols-4">
                    <div>
                      <div className="text-[11px] uppercase tracking-wide">Speed</div>
                      <div className="font-mono text-foreground">{fmtBytes(d.speed_bytes_per_second)}/s</div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-wide">ETA</div>
                      <div className="font-mono text-foreground">{d.eta_seconds ? `${d.eta_seconds}s` : "—"}</div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-wide">Downloaded</div>
                      <div className="font-mono text-foreground">{fmtBytes(d.downloaded_bytes)}</div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-wide">Size</div>
                      <div className="font-mono text-foreground">{d.file_size > 0 ? fmtBytes(d.file_size) : "unknown"}</div>
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {d.status === "paused" ? (
                    <Button variant="outline" onClick={() => resume.mutate(d.id)} title="Resume">
                      <Play className="h-4 w-4" />
                    </Button>
                  ) : (
                    <Button variant="outline" onClick={() => pause.mutate(d.id)} title="Pause">
                      <Pause className="h-4 w-4" />
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => retry.mutate(d.id)} title="Retry">
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                  <Button variant="danger" onClick={() => cancel.mutate(d.id)} title="Cancel">
                    <Square className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="mt-2 text-xs font-mono uppercase text-muted">{d.status}</div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
