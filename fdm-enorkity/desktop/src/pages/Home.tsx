import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ClipboardPaste, Gauge, HardDrive, Library, Link2, Sparkles, Sun } from "lucide-react";
import { api } from "@/lib/api";
import { asHttpUrl, formatBytes, formatSpeed, greeting, isSameDay } from "@/lib/format";
import { isLive, useDownloads, useMediaStatus, useSpeedHistory, useStats } from "@/lib/hooks";
import { useActions } from "@/lib/actions";
import { cn } from "@/lib/utils";
import { Page, MOD } from "@/components/Layout";
import { Mark } from "@/components/Brand";
import { ActiveCard, LibraryCard } from "@/components/DownloadCards";
import { Button, Kbd } from "@/components/ui";

const SITES = ["YouTube", "TikTok", "Instagram", "Facebook", "X", "Vimeo", "SoundCloud", "Dailymotion", "Twitch", "Reddit", "Any file link"];

function Widget({
  icon,
  label,
  value,
  detail,
  tint,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  tint: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="relative overflow-hidden rounded-[20px] bg-surface p-4 shadow-card animate-fade-up">
      <div className="flex items-center gap-2 text-[12px] font-semibold text-ink-2">
        <span className={cn("flex h-6 w-6 items-center justify-center rounded-[7px] text-white [&_svg]:h-3.5 [&_svg]:w-3.5", tint)}>{icon}</span>
        {label}
      </div>
      <div className="num mt-3 text-[26px] font-bold leading-none tracking-[-0.03em]">{value}</div>
      {detail ? <div className="num mt-1.5 truncate text-[12px] text-ink-3">{detail}</div> : null}
      {children}
    </div>
  );
}

function MiniBars({ values }: { values: number[] }) {
  const recent = values.slice(-30);
  const max = Math.max(...recent, 1);
  return (
    <div className="mt-3 flex h-8 items-end gap-[3px]" aria-hidden>
      {recent.map((v, i) => (
        <span
          key={i}
          className="flex-1 rounded-full bg-accent/80 transition-[height] duration-700 ease-spring"
          style={{ height: `${Math.max(8, (v / max) * 100)}%`, opacity: v ? 0.35 + (i / recent.length) * 0.65 : 0.15 }}
        />
      ))}
    </div>
  );
}

export default function Home() {
  const { openSpotlight } = useActions();
  const downloads = useDownloads();
  const stats = useStats();
  const media = useMediaStatus();
  const speeds = useSpeedHistory();
  const conns = useQuery({ queryKey: ["browser-connections"], queryFn: api.browserConnections, staleTime: 10_000 });
  const [text, setText] = useState("");

  const items = downloads.data?.items ?? [];
  const live = items.filter(isLive);
  const active = items.filter((d) => d.status === "active");
  const completed = items.filter((d) => d.status === "completed");
  const today = completed.filter((d) => isSameDay(d.completed_at));
  const todayBytes = today.reduce((a, d) => a + (d.file_size > 0 ? d.file_size : d.downloaded_bytes), 0);
  const speed = speeds[speeds.length - 1] ?? 0;
  const browsers = (conns.data ?? []).filter((c) => c.status === "active").length;

  const go = (value = text) => {
    const u = asHttpUrl(value);
    if (u) {
      openSpotlight(u);
      setText("");
    } else openSpotlight();
  };

  return (
    <Page title={greeting()} subtitle="What would you like to download today?" wide>
      {/* Hero */}
      <section className="relative mb-8 overflow-hidden rounded-[28px] brand-gradient px-8 pb-8 pt-9 text-white shadow-float animate-fade-up">
        <div aria-hidden className="pointer-events-none absolute -right-10 -top-6 opacity-[0.16]">
          <img src="/brand/mark-reverse.svg" alt="" className="h-[340px] w-[340px] animate-float" />
        </div>
        <div aria-hidden className="absolute -bottom-24 left-1/3 h-64 w-64 rounded-full bg-[#3ea2f0]/30 blur-3xl" />
        <div className="relative max-w-[640px]">
          <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-white/70">
            <Sparkles className="h-3.5 w-3.5" />
            Every video · every quality
          </div>
          <h2 className="mt-2 text-[34px] font-bold leading-[1.08] tracking-[-0.03em]" style={{ fontFamily: "var(--font-display)" }}>
            Paste a link. Pick a quality.
            <br />
            <span className="text-[#8cc8f7]">It's yours.</span>
          </h2>
          <form
            className="mt-6 flex h-[56px] items-center gap-2 rounded-[18px] bg-white/95 pl-4 pr-2 text-ink shadow-[0_10px_40px_-10px_rgb(0_0_0/0.5)] transition focus-within:ring-4 focus-within:ring-[#3ea2f0]/40 dark:bg-[#0f192e]/95"
            onSubmit={(e) => {
              e.preventDefault();
              go();
            }}
          >
            <Link2 className="h-5 w-5 shrink-0 text-accent" />
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onPaste={(e) => {
                const u = asHttpUrl(e.clipboardData.getData("text/plain"));
                if (u) {
                  e.preventDefault();
                  go(u);
                }
              }}
              placeholder="https://www.youtube.com/watch?v=…"
              spellCheck={false}
              autoComplete="off"
              aria-label="Video or file link"
              className="h-full min-w-0 flex-1 bg-transparent text-[15.5px] outline-none placeholder:text-ink-3 focus-visible:shadow-none"
            />
            {text ? (
              <Button type="submit" variant="primary" className="h-10 rounded-[13px] px-5">
                Download
                <ArrowRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                className="h-10 rounded-[13px] bg-fill/[0.12] px-4"
                onClick={async () => {
                  try {
                    go(await navigator.clipboard.readText());
                  } catch {
                    openSpotlight();
                  }
                }}
              >
                <ClipboardPaste className="h-4 w-4" />
                Paste
              </Button>
            )}
          </form>
          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[12px] text-white/60">Works with</span>
            {SITES.map((s) => (
              <span key={s} className="rounded-full bg-white/10 px-2.5 py-[3px] text-[11.5px] font-medium text-white/85 backdrop-blur">
                {s}
              </span>
            ))}
          </div>
          <div className="mt-4 text-[12px] text-white/55">
            Tip: press <Kbd className="bg-white/15 text-white shadow-none">{MOD}</Kbd>{" "}
            <Kbd className="bg-white/15 text-white shadow-none">K</Kbd> anywhere, or just paste a link into the window.
          </div>
        </div>
      </section>

      {/* Widgets */}
      <section className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Widget
          icon={<Gauge />}
          label="Speed"
          value={active.length ? formatSpeed(speed) : "Idle"}
          detail={active.length ? `${active.length} active · ${live.length - active.length} waiting` : "Nothing downloading right now"}
          tint="bg-gradient-to-br from-[#0b7fd4] to-[#3ea2f0]"
        >
          <MiniBars values={speeds} />
        </Widget>
        <Widget
          icon={<Sun />}
          label="Today"
          value={today.length}
          detail={today.length ? `${formatBytes(todayBytes)} saved` : "No downloads finished today"}
          tint="bg-gradient-to-br from-[#f59e0b] to-[#f97316]"
        />
        <Widget
          icon={<HardDrive />}
          label="Library"
          value={stats.data?.completed ?? completed.length}
          detail={`${formatBytes(stats.data?.total_bytes_completed ?? 0, "0 B")} on disk`}
          tint="bg-gradient-to-br from-[#00316b] to-[#0b7fd4]"
        />
        <Widget
          icon={<Sparkles />}
          label="Engine"
          value={media.data?.available ? "Ready" : media.isLoading ? "…" : "Setup"}
          detail={
            media.data?.available
              ? `yt-dlp ${media.data.version} · ${browsers} ${browsers === 1 ? "browser" : "browsers"}`
              : "Install yt-dlp for streaming sites"
          }
          tint={media.data?.available ? "bg-gradient-to-br from-[#059669] to-[#34d399]" : "bg-gradient-to-br from-[#b45309] to-[#f59e0b]"}
        />
      </section>

      {/* Live downloads */}
      {live.length ? (
        <section className="mb-8">
          <div className="mb-3 flex items-end justify-between">
            <h3 className="text-title-2">Downloading now</h3>
            <Link to="/downloading" className="text-[13px] font-medium text-accent-ink hover:underline dark:text-accent">
              See all
            </Link>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {live.slice(0, 4).map((d) => (
              <ActiveCard key={d.id} d={d} compact />
            ))}
          </div>
        </section>
      ) : null}

      {/* Recent */}
      <section>
        <div className="mb-3 flex items-end justify-between">
          <h3 className="text-title-2">Recently added</h3>
          {completed.length ? (
            <Link to="/library" className="text-[13px] font-medium text-accent-ink hover:underline dark:text-accent">
              Open library
            </Link>
          ) : null}
        </div>
        {completed.length ? (
          <div className="grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-3 xl:grid-cols-4">
            {completed.slice(0, 8).map((d) => (
              <LibraryCard key={d.id} d={d} />
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-5 rounded-[20px] bg-surface p-6 shadow-card">
            <Mark size={72} />
            <div className="flex-1">
              <div className="text-headline">Your library is waiting</div>
              <div className="mt-1 text-[13px] text-ink-2">
                Finished videos, music and files appear here — ready to play with one click.
              </div>
            </div>
            <Button variant="primary" onClick={() => openSpotlight()}>
              <Library className="h-4 w-4" />
              Start a download
            </Button>
          </div>
        )}
      </section>
    </Page>
  );
}
