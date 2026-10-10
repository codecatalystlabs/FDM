import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  CircleAlert,
  Globe,
  House,
  Library,
  ListOrdered,
  Plus,
  ScrollText,
  Settings,
} from "lucide-react";
import { api } from "@/lib/api";
import { formatSpeed } from "@/lib/format";
import { isLive, useDownloads, useMediaStatus, useSpeedHistory } from "@/lib/hooks";
import { useActions } from "@/lib/actions";
import { cn } from "@/lib/utils";
import { AppIcon, Wordmark } from "./Brand";
import { Kbd } from "./ui";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? "⌘" : "Ctrl";

function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const max = Math.max(...values, 1);
  const w = 120;
  const h = 28;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - (v / max) * (h - 3) - 1.5]);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={className} aria-hidden>
      <defs>
        <linearGradient id="spark" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="rgb(var(--accent))" stopOpacity="0.35" />
          <stop offset="100%" stopColor="rgb(var(--accent))" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${w},${h} L0,${h} Z`} fill="url(#spark)" />
      <path d={line} fill="none" stroke="rgb(var(--accent))" strokeWidth="1.6" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function NavItem({
  to,
  icon: Icon,
  label,
  count,
  tone,
  dot,
}: {
  to: string;
  icon: typeof House;
  label: string;
  count?: number;
  tone?: "accent" | "bad";
  dot?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        cn(
          "group flex h-8 items-center gap-2.5 rounded-[8px] px-2.5 text-[13.5px] font-medium transition-colors duration-150",
          isActive ? "bg-accent text-white shadow-[0_1px_2px_rgb(var(--shadow)/0.15)]" : "text-ink hover:bg-fill/[0.12]",
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon className={cn("h-[17px] w-[17px] shrink-0", isActive ? "text-white" : "text-accent dark:text-sky")} strokeWidth={2} />
          <span className="flex-1 truncate">{label}</span>
          {dot ? <span className="h-2 w-2 animate-breathe rounded-full bg-warn" /> : null}
          {count ? (
            <span
              className={cn(
                "num min-w-[20px] rounded-full px-1.5 text-center text-[11px] font-semibold leading-[18px]",
                isActive ? "bg-white/25 text-white" : tone === "bad" ? "bg-bad/[0.14] text-bad" : "bg-fill/[0.16] text-ink-2",
              )}
            >
              {count}
            </span>
          ) : null}
        </>
      )}
    </NavLink>
  );
}

function Sidebar() {
  const downloads = useDownloads();
  const media = useMediaStatus();
  const pending = useQuery({ queryKey: ["pair-pending"], queryFn: api.pendingPairs, retry: false });
  const speeds = useSpeedHistory();
  const { openSpotlight } = useActions();
  const items = downloads.data?.items ?? [];
  const live = items.filter(isLive).length;
  const failed = items.filter((d) => d.status === "failed").length;
  const active = items.filter((d) => d.status === "active");
  const speed = speeds[speeds.length - 1] ?? 0;
  const offline = downloads.isError;

  return (
    <aside className="vibrancy relative z-10 flex w-[232px] shrink-0 flex-col hairline-r">
      <div className="flex items-center gap-2.5 px-4 pb-4 pt-5">
        <AppIcon size={30} />
        <Wordmark className="text-[16.5px]" />
      </div>

      <div className="px-3">
        <button
          type="button"
          onClick={() => openSpotlight()}
          className="group mb-4 flex h-9 w-full items-center gap-2 rounded-[10px] bg-surface/70 px-2.5 text-[13px] text-ink-3 shadow-card transition hover:text-ink dark:bg-surface-2/70"
        >
          <Plus className="h-4 w-4 text-accent" strokeWidth={2.4} />
          <span className="flex-1 text-left">New download</span>
          <Kbd>{MOD}K</Kbd>
        </button>
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto px-3 pb-3">
        <div className="space-y-0.5">
          <NavItem to="/" icon={House} label="Home" />
          <NavItem to="/downloading" icon={ArrowDownToLine} label="Downloading" count={live} />
          <NavItem to="/queue" icon={ListOrdered} label="Queue" />
          <NavItem to="/library" icon={Library} label="Library" />
          <NavItem to="/failed" icon={CircleAlert} label="Failed" count={failed} tone="bad" />
        </div>
        <div>
          <div className="mb-1 px-2.5 text-[11px] font-semibold text-ink-3">Connect</div>
          <NavItem to="/browsers" icon={Globe} label="Browsers" dot={(pending.data?.length ?? 0) > 0} />
        </div>
        <div>
          <div className="mb-1 px-2.5 text-[11px] font-semibold text-ink-3">System</div>
          <div className="space-y-0.5">
            <NavItem to="/settings" icon={Settings} label="Settings" />
            <NavItem to="/activity" icon={ScrollText} label="Activity" />
          </div>
        </div>
      </nav>

      <div className="m-3 rounded-xl bg-surface/60 p-3 shadow-card dark:bg-surface-2/60">
        <div className="flex items-center justify-between text-[11px] font-semibold text-ink-3">
          <span className="flex items-center gap-1.5">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                offline ? "bg-bad" : active.length ? "animate-breathe bg-ok" : "bg-ok/70",
              )}
            />
            {offline ? "Engine offline" : active.length ? `${active.length} downloading` : "Ready"}
          </span>
          <span className="num text-ink">{active.length ? formatSpeed(speed) : ""}</span>
        </div>
        <Sparkline values={speeds} className="mt-2 h-7 w-full" />
        <div className="mt-1.5 truncate text-[10.5px] text-ink-3" title={media.data?.error}>
          {media.data?.available ? `yt-dlp ${media.data.version}${media.data.ffmpeg ? " · ffmpeg" : ""}` : media.isLoading ? "Checking engine…" : "Streaming engine missing"}
        </div>
      </div>
    </aside>
  );
}

function OfflineBanner() {
  const downloads = useDownloads();
  if (!downloads.isError) return null;
  return (
    <div className="absolute inset-x-0 top-0 z-30 flex justify-center px-6 pt-3 animate-fade-in">
      <div className="flex max-w-xl items-center gap-3 rounded-2xl bg-warn/[0.12] px-4 py-2.5 text-[12.5px] text-ink shadow-float glass">
        <span className="h-2 w-2 shrink-0 animate-breathe rounded-full bg-warn" />
        <span>
          <b>Can't reach the CatalystFDM engine.</b> It starts with the app; when running from source, start it with{" "}
          <code className="font-mono text-[11.5px]">go run ./cmd/server</code>. Retrying…
        </span>
      </div>
    </div>
  );
}

export function Layout({ children }: { children?: ReactNode }) {
  return (
    <div className="relative flex h-screen overflow-hidden">
      {/* Brand aurora behind the translucent sidebar and toolbars. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-40 -top-40 h-[520px] w-[520px] animate-aurora rounded-full bg-[#0b7fd4]/25 blur-[90px] dark:bg-[#0b7fd4]/30" />
        <div className="absolute -bottom-52 left-24 h-[480px] w-[480px] animate-aurora rounded-full bg-[#00316b]/20 blur-[100px] [animation-delay:-6s] dark:bg-[#00316b]/60" />
        <div className="absolute -right-32 top-24 h-[420px] w-[420px] animate-aurora rounded-full bg-[#3ea2f0]/15 blur-[100px] [animation-delay:-12s]" />
      </div>
      <Sidebar />
      <main className="relative z-0 flex min-w-0 flex-1 flex-col bg-bg/80 dark:bg-bg/70">
        <OfflineBanner />
        {children}
      </main>
    </div>
  );
}

/** Page chrome: a toolbar that turns into vibrancy once content scrolls under it. */
export function Page({
  title,
  subtitle,
  actions,
  children,
  wide,
  narrow,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  wide?: boolean;
  narrow?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const loc = useLocation();
  const width = wide ? "max-w-[1400px]" : narrow ? "max-w-[760px]" : "max-w-[1100px]";
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = 0;
    const onScroll = () => setScrolled(el.scrollTop > 8);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [loc.pathname]);
  return (
    <div ref={ref} className="h-full overflow-y-auto">
      <header
        className={cn(
          "sticky top-0 z-20 transition-[background,box-shadow] duration-300",
          scrolled ? "vibrancy hairline-b" : "",
        )}
      >
        <div className={cn("mx-auto flex min-h-[64px] items-end gap-4 px-8 pb-3 pt-5", width)}>
          <div className="min-w-0 flex-1">
            <h1 className="text-large-title truncate">{title}</h1>
            {subtitle ? <div className="mt-1 truncate text-[13px] text-ink-2">{subtitle}</div> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2 pb-0.5">{actions}</div> : null}
        </div>
      </header>
      <div className={cn("mx-auto px-8 pb-12 pt-2", width)}>{children}</div>
    </div>
  );
}
