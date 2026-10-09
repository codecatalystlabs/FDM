import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { Button, Card } from "@/components/ui";

export default function Failed() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["downloads", "failed"],
    queryFn: () => api.listDownloads({ status: "failed" }),
    refetchInterval: 4000,
  });

  const retry = useMutation({
    mutationFn: api.retry,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["downloads"] }),
  });
  const del = useMutation({
    mutationFn: api.deleteDownload,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["downloads"] }),
  });

  const items = q.data?.items ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Failed</h1>
        <p className="mt-1 text-sm text-muted">Inspect errors and retry when the server supports it.</p>
      </div>
      <div className="space-y-2">
        {items.length === 0 ? (
          <Card className="p-10 text-center text-sm text-muted">No failed downloads.</Card>
        ) : (
          items.map((d) => (
            <Card key={d.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{d.filename}</div>
                  <div className="truncate text-xs text-muted">{d.url}</div>
                  <div className="mt-2 rounded-md border border-white/10 bg-black/20 p-3 text-xs text-red-200 html.light:border-slate-200 html.light:bg-slate-50 html.light:text-red-700">
                    {d.error_message || "Unknown error"}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="outline" onClick={() => retry.mutate(d.id)}>
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Retry
                  </Button>
                  <Button variant="danger" onClick={() => del.mutate(d.id)}>
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </Button>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
