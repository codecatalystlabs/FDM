import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Shield } from "lucide-react";
import { api, getApiBase } from "@/lib/api";
import { Button, Card, Input } from "@/components/ui";

export default function BrowserPage() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const conns = useQuery({ queryKey: ["browser-connections"], queryFn: api.browserConnections, refetchInterval: 5000 });

  const gen = useMutation({
    mutationFn: api.generatePairingToken,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });

  const revoke = useMutation({
    mutationFn: api.revokeBrowser,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["browser-connections"] }),
  });

  const token = gen.data?.token;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Browser integration</h1>
        <p className="mt-1 text-sm text-muted">
          Extensions must authenticate with a localhost-only pairing token. This never uploads your browsing history.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-muted" />
            <div className="text-sm font-semibold">Pairing token</div>
          </div>
          <p className="mt-2 text-sm text-muted">
            Generate a token, paste it into the extension popup, then use the context menu on direct file links.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => gen.mutate()}>Generate new token</Button>
            <div className="text-xs text-muted">
              Configured: <span className="font-mono">{String(settings.data?.pairing_configured ?? false)}</span>
            </div>
          </div>
          {token ? (
            <div className="mt-4">
              <div className="text-xs font-semibold uppercase text-muted">One-time token</div>
              <Input readOnly value={token} className="mt-2 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
              <div className="mt-2 text-xs text-muted">Store this in the extension immediately; the server only keeps a hash.</div>
            </div>
          ) : null}
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-muted" />
            <div className="text-sm font-semibold">Connected browsers</div>
          </div>
          <div className="mt-4 space-y-2">
            {(conns.data ?? []).length === 0 ? (
              <div className="text-sm text-muted">No connections yet. Pair from the extension after generating a token.</div>
            ) : (
              (conns.data ?? []).map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 rounded-md border border-white/10 p-3 text-sm html.light:border-slate-200">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{c.browser_name || "Browser"}</div>
                    <div className="truncate text-xs text-muted font-mono">{c.extension_id}</div>
                    <div className="text-xs text-muted">status: {c.status}</div>
                  </div>
                  <Button variant="danger" onClick={() => revoke.mutate(c.id)} disabled={c.status === "revoked"}>
                    Revoke
                  </Button>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <div className="text-sm font-semibold">Extension install (dev)</div>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-muted">
          <li>Open Chrome/Edge → Extensions → Developer mode → Load unpacked → select `fdm-enorkity/extension/chrome`.</li>
          <li>Firefox → about:debugging → Load Temporary Add-on → select `fdm-enorkity/extension/firefox/manifest.json`.</li>
            <li>
              Set API base in the popup to <span className="font-mono">{getApiBase()}</span> (default).
            </li>
        </ol>
      </Card>
    </div>
  );
}
