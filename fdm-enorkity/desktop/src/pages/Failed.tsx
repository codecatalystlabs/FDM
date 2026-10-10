import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, RotateCcw } from "lucide-react";
import { api } from "@/lib/api";
import { useDownloads } from "@/lib/hooks";
import { Page } from "@/components/Layout";
import { FailedRow } from "@/components/DownloadCards";
import { Button, EmptyState } from "@/components/ui";

export default function Failed() {
  const qc = useQueryClient();
  const q = useDownloads();
  const items = (q.data?.items ?? []).filter((d) => d.status === "failed");
  const retryAll = useMutation({
    mutationFn: api.queueRetryFailed,
    onSettled: () => void qc.invalidateQueries({ queryKey: ["downloads"] }),
  });

  return (
    <Page
      title="Failed"
      subtitle={items.length ? "These didn't finish. Most can simply be retried." : "Downloads that couldn't finish show up here"}
      actions={
        items.length > 1 ? (
          <Button variant="tinted" onClick={() => retryAll.mutate()}>
            <RotateCcw className="h-3.5 w-3.5" />
            Retry all
          </Button>
        ) : null
      }
    >
      {items.length === 0 ? (
        <EmptyState icon={<CircleCheck className="text-ok" />} title="All clear">
          Nothing has failed. When something does, you'll see why — in plain words — and can retry with one click.
        </EmptyState>
      ) : (
        <div className="space-y-2.5">
          {items.map((d) => (
            <FailedRow key={d.id} d={d} />
          ))}
        </div>
      )}
    </Page>
  );
}
