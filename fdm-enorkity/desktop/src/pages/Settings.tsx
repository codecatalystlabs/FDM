import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Captions,
  ClipboardPaste,
  Cookie,
  Folder,
  Gauge,
  Layers,
  Monitor,
  Moon,
  Palette,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Sun,
  Wand2,
  Zap,
} from "lucide-react";
import { api, type CookiesBrowser, type PreferredQuality, type Settings } from "@/lib/api";
import { useMediaStatus, useSettings } from "@/lib/hooks";
import { usePref } from "@/lib/prefs";
import { Page } from "@/components/Layout";
import { AppIcon, Wordmark } from "@/components/Brand";
import { Badge, Button, Group, Input, Row, Segmented, Select, Stepper, Switch } from "@/components/ui";
import { useToast } from "@/components/Toasts";

const QUALITIES: { value: PreferredQuality; label: string }[] = [
  { value: "", label: "Smart (1080p)" },
  { value: "best", label: "Best available" },
  { value: "v2160", label: "4K" },
  { value: "v1440", label: "1440p" },
  { value: "v1080", label: "1080p" },
  { value: "v720", label: "720p" },
  { value: "v480", label: "480p (saves data)" },
  { value: "v360", label: "360p" },
  { value: "a-mp3", label: "MP3 audio" },
  { value: "a-m4a", label: "M4A audio" },
];

const COOKIE_BROWSERS: { value: CookiesBrowser; label: string }[] = [
  { value: "", label: "Off" },
  { value: "chrome", label: "Chrome" },
  { value: "brave", label: "Brave" },
  { value: "edge", label: "Edge" },
  { value: "firefox", label: "Firefox" },
  { value: "chromium", label: "Chromium" },
];

const LIMITS = [
  { value: "0", label: "Unlimited" },
  { value: String(256 * 1024), label: "256 KB/s" },
  { value: String(512 * 1024), label: "512 KB/s" },
  { value: String(1024 * 1024), label: "1 MB/s" },
  { value: String(2 * 1024 * 1024), label: "2 MB/s" },
  { value: String(5 * 1024 * 1024), label: "5 MB/s" },
  { value: String(10 * 1024 * 1024), label: "10 MB/s" },
];

export default function SettingsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useSettings();
  const media = useMediaStatus();
  const [appearance, setAppearance] = usePref("appearance");
  const [detectClipboard, setDetectClipboard] = usePref("detectClipboard");
  const [dir, setDir] = useState("");

  useEffect(() => {
    if (q.data) setDir(q.data.download_directory);
  }, [q.data?.download_directory]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: (patch: Partial<Settings>) => api.putSettings(patch),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: ["settings"] });
      const prev = qc.getQueryData<Settings>(["settings"]);
      if (prev) qc.setQueryData<Settings>(["settings"], { ...prev, ...patch });
      return { prev };
    },
    onError: (e: Error, _p, ctx) => {
      if (ctx?.prev) qc.setQueryData(["settings"], ctx.prev);
      toast({ title: "Couldn't save", subtitle: e.message, tone: "error" });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["settings"] });
      void qc.invalidateQueries({ queryKey: ["media-status"] });
    },
  });

  const update = useMutation({
    mutationFn: api.updateEngine,
    onSuccess: (r) =>
      toast(
        r.updated
          ? { title: "Engine updated", subtitle: `yt-dlp ${r.before} → ${r.after}`, tone: "success" }
          : { title: "Already up to date", subtitle: `yt-dlp ${r.after || r.before} is the latest` },
      ),
    onError: (e: Error) => toast({ title: "Couldn't update the engine", subtitle: e.message, tone: "error" }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["media-status"] }),
  });

  const s = q.data;
  const limitValue = String(s?.bandwidth_limit_bps ?? 0);
  const limitOptions = LIMITS.some((l) => l.value === limitValue)
    ? LIMITS
    : [...LIMITS, { value: limitValue, label: `${Math.round(Number(limitValue) / 1024)} KB/s` }];

  const askNotifications = async (on: boolean) => {
    if (on && "Notification" in window && Notification.permission === "default") {
      try {
        await Notification.requestPermission();
      } catch {
        /* the in-app banner still works */
      }
    }
    save.mutate({ notifications_enabled: on });
  };

  return (
    <Page title="Settings" subtitle="Changes save as you make them" narrow>
      <div className="space-y-7">
        <Group title="General">
          <Row icon={<Palette />} iconClass="bg-gradient-to-br from-[#7c3aed] to-[#c084fc]" title="Appearance">
            <Segmented
              size="sm"
              value={appearance}
              onChange={setAppearance}
              options={[
                { value: "auto", label: <><Monitor />Auto</> },
                { value: "light", label: <><Sun />Light</> },
                { value: "dark", label: <><Moon />Dark</> },
              ]}
            />
          </Row>
          <Row
            icon={<Bell />}
            iconClass="bg-gradient-to-br from-[#dc2626] to-[#f87171]"
            title="Notify me when downloads finish"
            subtitle="A banner in the app, plus a system notification when CatalystFDM is in the background"
          >
            <Switch label="Notifications" checked={!!s?.notifications_enabled} onChange={(v) => void askNotifications(v)} />
          </Row>
          <Row
            icon={<ClipboardPaste />}
            iconClass="bg-gradient-to-br from-[#0891b2] to-[#22d3ee]"
            title="Offer to download copied links"
            subtitle="When you come back to CatalystFDM with a video link on the clipboard"
          >
            <Switch label="Detect copied links" checked={detectClipboard} onChange={setDetectClipboard} />
          </Row>
        </Group>

        <Group title="Downloads">
          <Row icon={<Folder />} iconClass="bg-gradient-to-br from-[#0b7fd4] to-[#3ea2f0]" title="Save to">
            <span />
          </Row>
          <div className="flex gap-2 px-4 pb-3 pt-0">
            <Input value={dir} onChange={(e) => setDir(e.target.value)} className="font-mono text-[12px]" aria-label="Download folder" />
            <Button
              variant="tinted"
              disabled={!dir.trim() || dir === s?.download_directory}
              onClick={() => save.mutate({ download_directory: dir.trim() })}
            >
              Save
            </Button>
          </div>
          <Row icon={<Layers />} iconClass="bg-gradient-to-br from-[#00316b] to-[#0b7fd4]" title="Downloads at the same time">
            <Stepper
              label="simultaneous downloads"
              min={1}
              max={8}
              value={s?.max_concurrent_downloads ?? 3}
              onChange={(v) => save.mutate({ max_concurrent_downloads: v })}
            />
          </Row>
          <Row
            icon={<Zap />}
            iconClass="bg-gradient-to-br from-[#0891b2] to-[#38bdf8]"
            title="Connections per file"
            subtitle="Big files download over several connections at once — often 2–4× faster"
          >
            <Stepper
              label="connections per file"
              min={1}
              max={16}
              value={s?.connections_per_download ?? 4}
              onChange={(v) => save.mutate({ connections_per_download: v })}
            />
          </Row>
          <Row
            icon={<Moon />}
            iconClass="bg-gradient-to-br from-[#1e1b4b] to-[#4f46e5]"
            title="Night data window"
            subtitle="“Tonight” downloads run only in this window — set it to your night bundle's hours"
          >
            <input
              type="time"
              aria-label="Night window starts"
              value={s?.night_start ?? "00:00"}
              onChange={(e) => e.target.value && save.mutate({ night_start: e.target.value })}
              className="num h-8 rounded-lg bg-fill/[0.12] px-2 text-[13px] font-medium text-ink outline-none shadow-[inset_0_0_0_0.5px_rgb(var(--line-strong)/0.6)] focus-visible:shadow-glow"
            />
            <span className="text-[12px] text-ink-3">to</span>
            <input
              type="time"
              aria-label="Night window ends"
              value={s?.night_end ?? "06:00"}
              onChange={(e) => e.target.value && save.mutate({ night_end: e.target.value })}
              className="num h-8 rounded-lg bg-fill/[0.12] px-2 text-[13px] font-medium text-ink outline-none shadow-[inset_0_0_0_0.5px_rgb(var(--line-strong)/0.6)] focus-visible:shadow-glow"
            />
          </Row>
          <Row
            icon={<Gauge />}
            iconClass="bg-gradient-to-br from-[#059669] to-[#34d399]"
            title="Speed limit"
            subtitle="Keep some bandwidth for browsing or calls"
          >
            <Select value={limitValue} onChange={(e) => save.mutate({ bandwidth_limit_bps: Number(e.target.value) })} aria-label="Speed limit">
              {limitOptions.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </Select>
          </Row>
          <Row
            icon={<ShieldAlert />}
            iconClass="bg-gradient-to-br from-[#b45309] to-[#f59e0b]"
            title="Ask before downloading programs"
            subtitle="Installers and scripts wait for your OK"
          >
            <Switch label="Confirm executables" checked={!!s?.executable_confirm_enabled} onChange={(v) => save.mutate({ executable_confirm_enabled: v })} />
          </Row>
        </Group>

        <Group
          title="Video & music"
          footer="“Use my browser login” lets the engine reuse sites you're already signed in to (members-only or private videos your account can watch). It never bypasses DRM or paywalls."
        >
          <Row
            icon={<Sparkles />}
            iconClass="bg-gradient-to-br from-[#0b7fd4] to-[#8cc8f7]"
            title="Preferred quality"
            subtitle="Pre-selected for every video and in the browser button"
          >
            <Select
              value={s?.preferred_quality ?? ""}
              onChange={(e) => save.mutate({ preferred_quality: e.target.value as PreferredQuality })}
              aria-label="Preferred quality"
            >
              {QUALITIES.map((o) => (
                <option key={o.value || "smart"} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Row>
          <Row
            icon={<Wand2 />}
            iconClass="bg-gradient-to-br from-[#7c3aed] to-[#a78bfa]"
            title="Add title, cover art and chapters"
            subtitle="Files look right in music players and TV apps"
          >
            <Switch label="Embed metadata" checked={s?.media_embed_metadata ?? true} onChange={(v) => save.mutate({ media_embed_metadata: v })} />
          </Row>
          <Row
            icon={<Captions />}
            iconClass="bg-gradient-to-br from-[#334155] to-[#64748b]"
            title="Embed English subtitles"
            subtitle="When the video has them"
          >
            <Switch label="Embed subtitles" checked={!!s?.media_subtitles} onChange={(v) => save.mutate({ media_subtitles: v })} />
          </Row>
          <Row icon={<Cookie />} iconClass="bg-gradient-to-br from-[#92400e] to-[#d97706]" title="Use my browser login">
            <Select
              value={s?.media_cookies_browser ?? ""}
              onChange={(e) => save.mutate({ media_cookies_browser: e.target.value as CookiesBrowser })}
              aria-label="Use my browser login"
            >
              {COOKIE_BROWSERS.map((b) => (
                <option key={b.value || "off"} value={b.value}>
                  {b.label}
                </option>
              ))}
            </Select>
          </Row>
        </Group>

        <Group
          title="Engine"
          footer="Video sites change their players often; when a video that plays fine won't download, updating the engine usually fixes it."
        >
          <Row title="yt-dlp" subtitle="Reads 1,800+ video sites">
            {media.data?.available ? <Badge tone="success">{media.data.version}</Badge> : <Badge tone="warning">Not installed</Badge>}
            {media.data?.available ? (
              <Button size="sm" variant="tinted" onClick={() => update.mutate()} disabled={update.isPending}>
                <RefreshCw className={update.isPending ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
                {update.isPending ? "Checking…" : "Update"}
              </Button>
            ) : null}
          </Row>
          <Row title="ffmpeg" subtitle="Merges video and audio, converts music">
            {media.data?.ffmpeg ? <Badge tone="success">Ready</Badge> : <Badge tone="warning">Missing</Badge>}
          </Row>
          <Row title="Local API" subtitle="Only this computer can reach it">
            <span className="font-mono text-[12px] text-ink-3">{api.getApiBase()}</span>
          </Row>
        </Group>

        <div className="flex flex-col items-center pb-4 pt-2 text-center">
          <AppIcon size={64} />
          <Wordmark className="mt-3 text-[20px]" />
          <div className="mt-1 text-[12px] text-ink-3">Downloads, built for Africa · version 0.3.0</div>
        </div>
      </div>
    </Page>
  );
}
