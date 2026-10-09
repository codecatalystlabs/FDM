import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Button, Card, Input } from "@/components/ui";

export default function SettingsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const [dir, setDir] = useState("");
  const [conc, setConc] = useState(3);
  const [bw, setBw] = useState(0);
  const initialized = useRef(false);

  useEffect(() => {
    if (!q.isSuccess || !q.data || initialized.current) return;
    initialized.current = true;
    setDir(q.data.download_directory);
    setConc(q.data.max_concurrent_downloads);
    setBw(Number(q.data.bandwidth_limit_bps ?? 0));
  }, [q.isSuccess, q.data]);

  const save = useMutation({
    mutationFn: () =>
      api.putSettings({
        download_directory: dir,
        max_concurrent_downloads: conc,
        bandwidth_limit_bps: bw,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted">These values persist in SQLite via the Go API.</p>
      </div>

      <Card className="p-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <div className="text-xs font-semibold uppercase text-muted">Download directory</div>
            <Input className="mt-2 font-mono text-xs" value={dir} onChange={(e) => setDir(e.target.value)} />
          </div>
          <div>
            <div className="text-xs font-semibold uppercase text-muted">Max concurrent downloads</div>
            <Input className="mt-2" type="number" value={conc} onChange={(e) => setConc(Number(e.target.value))} />
          </div>
          <div className="md:col-span-2">
            <div className="text-xs font-semibold uppercase text-muted">Bandwidth limit (bytes/sec, 0 = unlimited)</div>
            <Input className="mt-2 font-mono text-xs" type="number" value={bw} onChange={(e) => setBw(Number(e.target.value))} />
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <Button onClick={() => save.mutate()}>
            <Save className="mr-2 h-4 w-4" />
            Save
          </Button>
          {save.isSuccess ? <span className="text-xs text-muted">Saved.</span> : null}
          {save.isError ? <span className="text-xs text-red-300">{(save.error as Error).message}</span> : null}
        </div>
      </Card>

      <Card className="p-5 text-sm text-muted">
        Advanced toggles (private URL allowance, executable confirmations) are exposed on the API today; UI wiring can
        expand in Phase 5 without changing the engine contract.
      </Card>
    </div>
  );
}
