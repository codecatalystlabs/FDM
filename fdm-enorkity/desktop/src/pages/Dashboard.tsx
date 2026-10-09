import { useQuery } from "@tanstack/react-query";
import { ArrowDownCircle, Gauge, HardDrive, ListChecks } from "lucide-react";
import { api } from "@/lib/api";
import { Card } from "@/components/ui";

function Stat({ title, value, hint }: { title: string; value: string; hint?: string }) {
  return (
    <Card className="p-5">
      <div className="text-xs font-medium text-muted">{title}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
      {hint ? <div className="mt-2 text-xs text-muted">{hint}</div> : null}
    </Card>
  );
}

export default function Dashboard() {
  const summary = useQuery({ queryKey: ["stats"], queryFn: api.statsSummary, refetchInterval: 2000 });
  const downloads = useQuery({ queryKey: ["downloads"], queryFn: () => api.listDownloads({}), refetchInterval: 2000 });

  const s = summary.data ?? {};
  const items = downloads.data?.items ?? [];
  const recent = items.slice(0, 6);

  const totalBytes = Number(s.total_bytes_completed ?? 0);
  const fmtBytes = (n: number) => {
    if (n > 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
    if (n > 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
    if (n > 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${n} B`;
  };

  const active = items.filter((d) => d.status === "active");
  const speed = active.reduce((acc, d) => acc + (d.speed_bytes_per_second || 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-muted">A quick pulse on your local download engine.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Stat title="Total downloads (records)" value={String(downloads.data?.total ?? items.length)} />
        <Stat title="Active" value={String(s.active ?? 0)} hint="Across all sessions" />
        <Stat title="Completed" value={String(s.completed ?? 0)} />
        <Stat title="Failed" value={String(s.failed ?? 0)} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-muted" />
              <div className="text-sm font-semibold">Recent downloads</div>
            </div>
            <div className="text-xs text-muted">auto-refresh</div>
          </div>
          <div className="mt-4 space-y-3">
            {recent.length === 0 ? (
              <div className="rounded-md border border-dashed border-white/10 p-8 text-center text-sm text-muted html.light:border-slate-200">
                No downloads yet. Paste a URL in the top bar to start.
              </div>
            ) : (
              recent.map((d) => (
                <div key={d.id} className="flex items-center justify-between gap-3 rounded-md border border-white/10 p-3 html.light:border-slate-200">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{d.filename}</div>
                    <div className="truncate text-xs text-muted">{d.url}</div>
                  </div>
                  <div className="shrink-0 text-xs font-mono uppercase text-muted">{d.status}</div>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-muted" />
            <div className="text-sm font-semibold">Throughput</div>
          </div>
          <div className="mt-4 space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted">Current speed</span>
              <span className="font-mono">{fmtBytes(speed)}/s</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted">Total completed bytes</span>
              <span className="font-mono">{fmtBytes(totalBytes)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted">Queued / pending</span>
              <span className="font-mono">{String((s.pending as number) ?? 0)}</span>
            </div>
          </div>
          <div className="mt-6 rounded-md border border-white/10 p-3 text-xs text-muted html.light:border-slate-200">
            <div className="flex items-center gap-2">
              <ListChecks className="h-4 w-4" />
              Tip: keep the Go server running while using the desktop UI.
            </div>
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <div className="flex items-center gap-2">
          <ArrowDownCircle className="h-4 w-4 text-muted" />
          <div className="text-sm font-semibold">Safety</div>
        </div>
        <p className="mt-2 text-sm text-muted">
          FDM-Enorkity only supports direct <span className="font-mono">http/https</span> downloads you are allowed to access. DRM,
          paywalled streams, and authentication bypass are intentionally out of scope.
        </p>
      </Card>
    </div>
  );
}
