import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import {
  Activity,
  CheckCircle2,
  Download,
  Globe,
  LayoutDashboard,
  ListOrdered,
  ScrollText,
  Settings,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getApiBase } from "@/lib/api";
import { Button, Input } from "./ui";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/active", label: "Active", icon: Activity },
  { to: "/queue", label: "Queue", icon: ListOrdered },
  { to: "/completed", label: "Completed", icon: CheckCircle2 },
  { to: "/failed", label: "Failed", icon: XCircle },
  { to: "/browser", label: "Browser", icon: Globe },
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/logs", label: "Logs", icon: ScrollText },
];

export function Layout(props: {
  theme: "dark" | "light";
  onToggleTheme: () => void;
  quickUrl: string;
  setQuickUrl: (v: string) => void;
  onQuickAdd: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex h-screen overflow-hidden text-foreground bg-[radial-gradient(1200px_600px_at_20%_0%,rgba(99,102,241,0.25),transparent),radial-gradient(900px_500px_at_80%_10%,rgba(34,211,238,0.18),transparent)]">
      <aside className="w-64 shrink-0 border-r border-white/10 bg-black/20 p-4 backdrop-blur-md html.light:border-slate-200 html.light:bg-white/70">
        <div className="mb-8 flex items-center gap-2 px-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent text-white shadow-soft">
            <Download className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-semibold tracking-tight">FDM-Enorkity</div>
            <div className="text-xs text-muted">Local download manager</div>
          </div>
        </div>
        <nav className="space-y-1">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === "/"}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition",
                  isActive
                    ? "bg-white/10 text-white html.light:bg-slate-900/5 html.light:text-slate-900"
                    : "text-muted hover:bg-white/5 hover:text-foreground html.light:hover:bg-slate-900/5",
                )
              }
            >
              <n.icon className="h-4 w-4" />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-8 px-2 text-xs text-muted">
          Runs against your local Go API on{" "}
          <span className="font-mono text-foreground/80">{getApiBase()}</span>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-white/10 bg-black/10 px-6 py-4 backdrop-blur-md html.light:border-slate-200 html.light:bg-white/60">
          <div className="flex flex-1 items-center gap-2">
            <Input
              value={props.quickUrl}
              onChange={(e) => props.setQuickUrl(e.target.value)}
              placeholder="Paste a direct download URL (http/https)…"
              onKeyDown={(e) => e.key === "Enter" && props.onQuickAdd()}
            />
            <Button onClick={props.onQuickAdd} className="shrink-0">
              Add
            </Button>
          </div>
          <Button variant="outline" onClick={props.onToggleTheme} className="shrink-0">
            {props.theme === "dark" ? "Light" : "Dark"}
          </Button>
        </header>
        <main className="min-h-0 flex-1 overflow-auto p-6">
          {props.children}
        </main>
      </div>
    </div>
  );
}
