import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { api, type PairRequest } from "@/lib/api";
import { Button, Sheet } from "./ui";
import { AppIcon } from "./Brand";
import { useToast } from "./Toasts";

/* One-click pairing, the app side. When a browser extension asks to connect, this sheet pops
 * up wherever the user is — like a system permission prompt — with the same 4-digit code the
 * browser shows. One click on Allow and the browser is paired. */

const BROWSER_TINT: Record<string, string> = {
  brave: "from-[#ff6a3d] to-[#fb542b]",
  chrome: "from-[#34a853] via-[#fbbc04] to-[#ea4335]",
  chromium: "from-[#4b8bf5] to-[#1a73e8]",
  edge: "from-[#36c3f0] to-[#0c59a4]",
  firefox: "from-[#ffbd4f] via-[#ff7139] to-[#e31587]",
  opera: "from-[#ff1b2d] to-[#a70014]",
  vivaldi: "from-[#ef3939] to-[#b81d1d]",
};

export function BrowserGlyph({ name, size = 44 }: { name: string; size?: number }) {
  const key = Object.keys(BROWSER_TINT).find((k) => name.toLowerCase().includes(k)) ?? "chromium";
  const letter = (name.trim()[0] || "B").toUpperCase();
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-[30%] bg-gradient-to-br ${BROWSER_TINT[key]} font-bold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.35),0_4px_10px_rgb(0_0_0/0.18)]`}
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      aria-hidden
    >
      {letter}
    </span>
  );
}

export function PairingSheet() {
  const qc = useQueryClient();
  const toast = useToast();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const pending = useQuery({
    queryKey: ["pair-pending"],
    queryFn: api.pendingPairs,
    // Keep listening in the background too: the request usually arrives while the user is in
    // their browser, so the app should be ready (and say so) when they switch back.
    refetchInterval: () => (document.visibilityState === "visible" ? 1500 : 3000),
    refetchIntervalInBackground: true,
    retry: false,
  });
  const req: PairRequest | undefined = (pending.data ?? []).find((r) => !dismissed.has(r.id));
  const notified = useRef<string>("");

  useEffect(() => {
    if (!req || notified.current === req.id || document.visibilityState === "visible") return;
    notified.current = req.id;
    if ("Notification" in window && Notification.permission === "granted") {
      try {
        new Notification(`${req.browser_name} wants to connect`, {
          body: `Open CatalystFDM and click Allow. Code ${req.code}`,
          icon: "/brand/app-icon.svg",
        });
      } catch {
        /* notifications unavailable */
      }
    }
  }, [req]);

  const done = (r: PairRequest) => {
    setDismissed((s) => new Set(s).add(r.id));
    void qc.invalidateQueries({ queryKey: ["pair-pending"] });
    void qc.invalidateQueries({ queryKey: ["browser-connections"] });
  };

  const allow = useMutation({
    mutationFn: (r: PairRequest) => api.approvePair(r.id),
    onSuccess: (_c, r) => {
      done(r);
      toast({ title: `${r.browser_name} is connected`, subtitle: "Videos you watch now show a download button.", tone: "success" });
    },
    onError: (e: Error, r) => {
      done(r);
      toast({ title: "Couldn't connect", subtitle: e.message, tone: "error" });
    },
  });
  const deny = useMutation({
    mutationFn: (r: PairRequest) => api.denyPair(r.id),
    onSettled: (_d, _e, r) => done(r),
  });

  if (!req) return null;
  const busy = allow.isPending || deny.isPending;

  return (
    <Sheet open onClose={() => deny.mutate(req)} label="Browser connection request" className="max-w-[380px]">
      <div className="flex flex-col items-center px-7 pb-6 pt-7 text-center">
        <div className="relative mb-4 flex items-center">
          <BrowserGlyph name={req.browser_name} size={56} />
          <span className="mx-2 flex gap-1" aria-hidden>
            {[0, 1, 2].map((i) => (
              <span key={i} className="h-1.5 w-1.5 animate-breathe rounded-full bg-accent" style={{ animationDelay: `${i * 0.2}s` }} />
            ))}
          </span>
          <AppIcon size={56} />
        </div>
        <div className="text-[17px] font-semibold tracking-[-0.015em]">“{req.browser_name}” wants to connect</div>
        <p className="mt-1.5 text-[13px] leading-snug text-ink-2">
          Allow it to send videos and files to CatalystFDM. Check that your browser shows the same code.
        </p>
        <div className="mt-5 flex gap-2" aria-label={`Code ${req.code.split("").join(" ")}`}>
          {req.code.split("").map((d, i) => (
            <span
              key={i}
              className="num flex h-14 w-11 items-center justify-center rounded-xl bg-fill/[0.1] text-[28px] font-bold tracking-tight shadow-[inset_0_0_0_0.5px_rgb(var(--line-strong))]"
            >
              {d}
            </span>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-1.5 text-[11.5px] text-ink-3">
          <ShieldCheck className="h-3.5 w-3.5 text-ok" />
          Stays on this computer · you can disconnect any time
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 px-5 pb-5">
        <Button size="lg" onClick={() => deny.mutate(req)} disabled={busy}>
          Don't Allow
        </Button>
        <Button size="lg" variant="primary" onClick={() => allow.mutate(req)} disabled={busy} autoFocus>
          Allow
        </Button>
      </div>
    </Sheet>
  );
}
