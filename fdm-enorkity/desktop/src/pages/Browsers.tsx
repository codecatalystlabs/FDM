import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, Copy, KeyRound, MousePointerClick, Puzzle, ShieldCheck, Unplug } from "lucide-react";
import { api, type BrowserConnection } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { Page } from "@/components/Layout";
import { BrowserGlyph } from "@/components/PairingSheet";
import { Badge, Button, Group, Input, Panel, Row, Sheet } from "@/components/ui";
import { useToast } from "@/components/Toasts";

const STEPS = [
  {
    icon: <Puzzle />,
    title: "Add the extension",
    body: (
      <>
        In Chrome, Brave or Edge open <code className="font-mono text-[11.5px]">chrome://extensions</code>, switch on{" "}
        <b>Developer mode</b>, click <b>Load unpacked</b> and pick the <code className="font-mono text-[11.5px]">extension/chrome</code>{" "}
        folder. Firefox: <code className="font-mono text-[11.5px]">about:debugging</code> → Load Temporary Add-on.
      </>
    ),
  },
  {
    icon: <MousePointerClick />,
    title: "It asks to connect",
    body: <>A welcome tab opens and asks right away. Later you can also click the CatalystFDM icon → Connect.</>,
  },
  {
    icon: <ShieldCheck />,
    title: "Click Allow here",
    body: <>CatalystFDM pops up the request with a 4-digit code. If it matches your browser, click Allow. Done.</>,
  },
];

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          window.setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard blocked: the field is selectable */
        }
      }}
    >
      {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {done ? "Copied" : "Copy"}
    </Button>
  );
}

export default function BrowsersPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const conns = useQuery({ queryKey: ["browser-connections"], queryFn: api.browserConnections, refetchInterval: 4000 });
  const [revoking, setRevoking] = useState<BrowserConnection | null>(null);
  const [manualToken, setManualToken] = useState("");

  const revoke = useMutation({
    mutationFn: (c: BrowserConnection) => api.revokeBrowser(c.id),
    onSuccess: (_r, c) => toast({ title: `${c.browser_name || "Browser"} disconnected`, tone: "success" }),
    onSettled: () => {
      setRevoking(null);
      void qc.invalidateQueries({ queryKey: ["browser-connections"] });
    },
  });
  const gen = useMutation({
    mutationFn: api.generatePairingToken,
    onSuccess: (r) => setManualToken(r.token),
  });

  const active = (conns.data ?? []).filter((c) => c.status === "active");

  return (
    <Page title="Browsers" subtitle="Download videos straight from the page you're watching">
      <section className="mb-8 grid gap-3 md:grid-cols-3">
        {STEPS.map((s, i) => (
          <Panel key={s.title} className="relative p-5 animate-fade-up" style={{ animationDelay: `${i * 60}ms` }}>
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-[10px] brand-gradient text-white [&_svg]:h-4 [&_svg]:w-4">
                {s.icon}
              </span>
              <span className="num text-[11px] font-bold uppercase tracking-[0.1em] text-ink-3">Step {i + 1}</span>
            </div>
            <div className="mt-3 text-headline">{s.title}</div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">{s.body}</p>
            {i < STEPS.length - 1 ? (
              <ChevronRight className="absolute -right-3 top-1/2 z-10 hidden h-5 w-5 -translate-y-1/2 text-ink-3 md:block" />
            ) : null}
          </Panel>
        ))}
      </section>

      <Group
        title="Connected"
        footer="Each browser gets its own key. Disconnecting one locks it out immediately without touching the others."
      >
        {active.length === 0 ? (
          <div className="px-4 py-8 text-center text-[13px] text-ink-3">No browsers yet — follow the three steps above.</div>
        ) : (
          active.map((c) => (
            <Row
              key={c.id}
              title={
                <span className="flex items-center gap-2">
                  {c.browser_name || "Browser"}
                  <Badge tone="success">Connected</Badge>
                </span>
              }
              subtitle={c.last_seen_at ? `Last active ${relativeTime(c.last_seen_at)}` : "Never used yet"}
              icon={<BrowserGlyph name={c.browser_name || "Browser"} size={26} />}
              iconClass="bg-transparent"
            >
              <Button size="sm" variant="destructive" onClick={() => setRevoking(c)}>
                <Unplug className="h-3.5 w-3.5" />
                Disconnect
              </Button>
            </Row>
          ))
        )}
      </Group>

      <details className="group mt-8">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 px-4 text-[12px] font-semibold text-ink-3 hover:text-ink">
          <ChevronRight className="h-3.5 w-3.5 transition group-open:rotate-90" />
          Advanced: manual pairing key (older extensions)
        </summary>
        <Panel className="mt-2 p-4 animate-fade-in">
          <div className="flex items-start gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-fill/[0.14] text-ink-2">
              <KeyRound className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1 text-[12.5px] text-ink-2">
              Only needed for extensions older than 0.3. Making a new key replaces the previous manual key, and browsers using it must
              paste the new one.
              {manualToken ? (
                <div className="mt-3 flex gap-2">
                  <Input readOnly value={manualToken} className="font-mono text-[12px]" onFocus={(e) => e.currentTarget.select()} />
                  <CopyButton text={manualToken} />
                </div>
              ) : (
                <div className="mt-3">
                  <Button size="sm" onClick={() => gen.mutate()} disabled={gen.isPending}>
                    Make a manual key
                  </Button>
                </div>
              )}
            </div>
          </div>
        </Panel>
      </details>

      <Sheet open={!!revoking} onClose={() => setRevoking(null)} label="Disconnect browser" className="max-w-[340px]">
        {revoking ? (
          <div className="p-6 text-center">
            <div className="mb-3 flex justify-center">
              <BrowserGlyph name={revoking.browser_name || "Browser"} size={48} />
            </div>
            <div className="text-headline">Disconnect {revoking.browser_name || "this browser"}?</div>
            <p className="mt-1.5 text-[13px] text-ink-2">It won't be able to send downloads until you connect it again.</p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <Button onClick={() => setRevoking(null)}>Cancel</Button>
              <Button variant="destructive" onClick={() => revoke.mutate(revoking)} disabled={revoke.isPending}>
                Disconnect
              </Button>
            </div>
          </div>
        ) : null}
      </Sheet>
    </Page>
  );
}
