import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

/* Notification banners in the style of macOS: top-right, glass, auto-dismiss, with up to two
 * actions. Hovering a banner pauses its timer. */

export type ToastAction = { label: string; onClick: () => void };
export type Toast = {
  id?: number;
  title: string;
  subtitle?: string;
  tone?: "info" | "success" | "error";
  image?: string;
  actions?: ToastAction[];
  duration?: number;
};

const Ctx = createContext<(t: Toast) => void>(() => {});

export function useToast() {
  return useContext(Ctx);
}

function Banner({ t, onClose }: { t: Required<Pick<Toast, "id">> & Toast; onClose: () => void }) {
  const [hover, setHover] = useState(false);
  const [broken, setBroken] = useState(false);
  const left = useRef(t.duration ?? 5000);
  useEffect(() => {
    if (hover) return;
    const started = Date.now();
    const timer = window.setTimeout(onClose, left.current);
    return () => {
      window.clearTimeout(timer);
      left.current -= Date.now() - started;
    };
  }, [hover, onClose]);
  const Icon = t.tone === "error" ? CircleAlert : t.tone === "success" ? CircleCheck : Info;
  return (
    <div
      role="status"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="pointer-events-auto flex w-[360px] animate-slide-in gap-3 rounded-2xl p-3 shadow-float glass"
    >
      {t.image && !broken ? (
        <img
          src={t.image}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
          className="h-11 w-[70px] shrink-0 rounded-lg object-cover"
        />
      ) : (
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-white",
            t.tone === "error" ? "bg-bad" : t.tone === "success" ? "bg-ok" : "brand-gradient",
          )}
        >
          <Icon className="h-[18px] w-[18px]" />
        </span>
      )}
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="text-[13px] font-semibold leading-tight">{t.title}</div>
        {t.subtitle ? <div className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-ink-2">{t.subtitle}</div> : null}
        {t.actions?.length ? (
          <div className="mt-2 flex gap-1.5">
            {t.actions.map((a) => (
              <button
                key={a.label}
                type="button"
                onClick={() => {
                  a.onClick();
                  onClose();
                }}
                className="h-6 rounded-full bg-fill/[0.15] px-2.5 text-[11.5px] font-semibold text-ink transition hover:bg-fill/[0.25]"
              >
                {a.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onClose}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-ink-3 transition hover:bg-fill/[0.15] hover:text-ink"
      >
        <X className="h-3 w-3" strokeWidth={2.5} />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<(Toast & { id: number })[]>([]);
  const seq = useRef(0);
  const push = useCallback((t: Toast) => {
    seq.current += 1;
    const id = seq.current;
    setItems((cur) => [...cur.slice(-3), { ...t, id }]);
  }, []);
  const close = useCallback((id: number) => setItems((cur) => cur.filter((t) => t.id !== id)), []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-[70] flex flex-col gap-2">
        {items.map((t) => (
          <Banner key={t.id} t={t} onClose={() => close(t.id)} />
        ))}
      </div>
    </Ctx.Provider>
  );
}
