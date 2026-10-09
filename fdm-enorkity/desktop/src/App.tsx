import { useCallback, useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { api } from "@/lib/api";
import Dashboard from "@/pages/Dashboard";
import ActiveDownloads from "@/pages/ActiveDownloads";
import QueuePage from "@/pages/Queue";
import Completed from "@/pages/Completed";
import Failed from "@/pages/Failed";
import BrowserPage from "@/pages/Browser";
import SettingsPage from "@/pages/Settings";
import LogsPage from "@/pages/Logs";

export default function App() {
  const qc = useQueryClient();
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [quickUrl, setQuickUrl] = useState("");
  const [banner, setBanner] = useState<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem("fdm_theme");
    if (saved === "light" || saved === "dark") setTheme(saved);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
    localStorage.setItem("fdm_theme", theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  const onQuickAdd = useCallback(async () => {
    setBanner(null);
    const url = quickUrl.trim();
    if (!url) return;
    try {
      const dl = await api.addDownload(url, false);
      if (dl.requires_exec_confirm && !dl.exec_confirmed) {
        const ok = window.confirm(
          "This download looks like an executable package. Only continue if you trust the source. Proceed?",
        );
        if (!ok) {
          setBanner("Executable download not confirmed.");
          return;
        }
        await api.confirmExecutable(dl.id);
      }
      setQuickUrl("");
      setBanner("Download added.");
      await qc.invalidateQueries();
    } catch (e) {
      setBanner((e as Error).message);
    }
  }, [quickUrl, qc]);

  return (
    <BrowserRouter>
      <div className={banner ? "pt-10" : ""}>
        {banner ? (
          <div className="fixed inset-x-0 top-0 z-50 border-b border-white/10 bg-black/70 px-4 py-2 text-center text-sm text-white backdrop-blur-md html.light:border-slate-200 html.light:bg-white/80 html.light:text-slate-900">
            {banner}
          </div>
        ) : null}
        <Layout
          theme={theme}
          onToggleTheme={toggleTheme}
          quickUrl={quickUrl}
          setQuickUrl={setQuickUrl}
          onQuickAdd={() => void onQuickAdd()}
        >
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/active" element={<ActiveDownloads />} />
            <Route path="/queue" element={<QueuePage />} />
            <Route path="/completed" element={<Completed />} />
            <Route path="/failed" element={<Failed />} />
            <Route path="/browser" element={<BrowserPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/logs" element={<LogsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      </div>
    </BrowserRouter>
  );
}
