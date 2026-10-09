import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { Button, Card } from "@/components/ui";

export default function Completed() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["downloads", "completed"],
    queryFn: () => api.listDownloads({ status: "completed" }),
    refetchInterval: 4000,
  });

  const del = useMutation({
    mutationFn: api.deleteDownload,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["downloads"] }),
  });

  const items = q.data?.items ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Completed</h1>
        <p className="mt-1 text-sm text-muted">Finished downloads stored in SQLite.</p>
      </div>
      <div className="space-y-2">
        {items.length === 0 ? (
          <Card className="p-10 text-center text-sm text-muted">No completed downloads.</Card>
        ) : (
          items.map((d) => (
            <Card key={d.id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{d.filename}</div>
                  <div className="truncate text-xs text-muted">{d.url}</div>
                </div>
                <Button variant="danger" onClick={() => del.mutate(d.id)}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete record
                </Button>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
