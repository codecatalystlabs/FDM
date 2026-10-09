import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card } from "@/components/ui";

export default function LogsPage() {
  const q = useQuery({ queryKey: ["logs"], queryFn: () => api.logs({ limit: 300 }), refetchInterval: 5000 });

  const rows = q.data ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Logs</h1>
        <p className="mt-1 text-sm text-muted">Structured download and engine messages from SQLite.</p>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="grid grid-cols-12 gap-2 border-b border-white/10 px-4 py-3 text-xs font-semibold uppercase text-muted html.light:border-slate-200">
          <div className="col-span-2">Time</div>
          <div className="col-span-1">Lvl</div>
          <div className="col-span-3">Download</div>
          <div className="col-span-6">Message</div>
        </div>
        <div className="max-h-[640px] divide-y divide-white/10 overflow-auto html.light:divide-slate-200">
          {rows.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted">No logs yet.</div>
          ) : (
            rows.map((r) => (
              <div key={r.id} className="grid grid-cols-12 gap-2 px-4 py-2 text-xs">
                <div className="col-span-2 font-mono text-muted">{new Date(r.created_at).toLocaleString()}</div>
                <div className="col-span-1 font-mono uppercase">{r.level}</div>
                <div className="col-span-3 truncate font-mono text-muted">{r.download_id}</div>
                <div className="col-span-6">
                  <div className="text-sm text-foreground">{r.message}</div>
                  {r.details ? <div className="mt-1 text-[11px] text-muted">{r.details}</div> : null}
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
