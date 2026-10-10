import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";
import { api } from "@/lib/api";
import { useDownloads } from "@/lib/hooks";
import { displayTitle } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Page } from "@/components/Layout";
import { EmptyState, Panel, SearchField, Segmented } from "@/components/ui";

type Level = "all" | "info" | "warn" | "error";

const LEVEL_DOT: Record<string, string> = {
  info: "bg-accent",
  warn: "bg-warn",
  warning: "bg-warn",
  error: "bg-bad",
  debug: "bg-ink-3",
};

export default function ActivityPage() {
  const [level, setLevel] = useState<Level>("all");
  const [search, setSearch] = useState("");
  const q = useQuery({
    queryKey: ["logs", level],
    queryFn: () => api.logs({ limit: 400, level: level === "all" ? undefined : level }),
    refetchInterval: 4000,
  });
  const downloads = useDownloads();
  const names = useMemo(() => new Map((downloads.data?.items ?? []).map((d) => [d.id, displayTitle(d)])), [downloads.data]);
  const rows = (q.data ?? []).filter((r) => {
    const s = search.trim().toLowerCase();
    return !s || `${r.message} ${r.details ?? ""} ${names.get(r.download_id) ?? ""}`.toLowerCase().includes(s);
  });

  return (
    <Page
      title="Activity"
      subtitle="What the engine has been doing"
      actions={<SearchField value={search} onChange={setSearch} placeholder="Filter" className="w-52" />}
    >
      <div className="mb-4">
        <Segmented
          value={level}
          onChange={setLevel}
          options={[
            { value: "all", label: "All" },
            { value: "info", label: "Info" },
            { value: "warn", label: "Warnings" },
            { value: "error", label: "Errors" },
          ]}
        />
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={<ScrollText />} title="No activity yet" />
      ) : (
        <Panel className="divide-y divide-line overflow-hidden">
          {rows.map((r) => (
            <div key={r.id} className="grid grid-cols-[14px_118px_1fr] items-start gap-3 px-4 py-2.5">
              <span className={cn("mt-[7px] h-2 w-2 rounded-full", LEVEL_DOT[r.level] ?? "bg-ink-3")} title={r.level} />
              <span className="num pt-px text-[11.5px] text-ink-3">
                {new Date(r.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
              <div className="min-w-0">
                <div className="text-[13px] text-ink first-letter:uppercase">{r.message}</div>
                {names.get(r.download_id) ? <div className="truncate text-[11.5px] text-ink-3">{names.get(r.download_id)}</div> : null}
                {r.details ? <div className="mt-0.5 break-words font-mono text-[11px] text-ink-3">{r.details}</div> : null}
              </div>
            </div>
          ))}
        </Panel>
      )}
    </Page>
  );
}
