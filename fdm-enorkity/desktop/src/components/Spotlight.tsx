import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowRight, ClipboardPaste, CornerDownLeft, Link2, Search } from "lucide-react";
import { asHttpUrl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Kbd } from "./ui";
import { AddFlow, type AddFlowProps } from "./AddFlow";

/* Spotlight: one floating field for everything. Paste a link and it becomes the add flow;
 * type words and it becomes a command palette (go to…, pause all, appearance…). */

export type Command = {
  id: string;
  title: string;
  hint?: string;
  icon: ReactNode;
  keywords?: string;
  run: () => void;
};

function score(c: Command, q: string): number {
  if (!q) return 1;
  const hay = `${c.title} ${c.keywords ?? ""}`.toLowerCase();
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  let s = 0;
  for (const w of words) {
    const i = hay.indexOf(w);
    if (i < 0) return 0;
    s += i === 0 ? 3 : hay[i - 1] === " " ? 2 : 1;
  }
  return s;
}

export function Spotlight({
  open,
  initialUrl,
  onClose,
  commands,
  onDone,
  onPaste,
}: {
  open: boolean;
  initialUrl?: string;
  onClose: () => void;
  commands: Command[];
  onDone: AddFlowProps["onDone"];
  onPaste: () => Promise<string>;
}) {
  const [text, setText] = useState(initialUrl ?? "");
  const [url, setUrl] = useState(initialUrl ? asHttpUrl(initialUrl) : "");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setText(initialUrl ?? "");
    setUrl(initialUrl ? asHttpUrl(initialUrl) : "");
    setActive(0);
    window.setTimeout(() => inputRef.current?.focus(), 20);
  }, [open, initialUrl]);

  const typedUrl = asHttpUrl(text);
  const results = useMemo(
    () =>
      commands
        .map((c) => ({ c, s: score(c, text.trim()) }))
        .filter((r) => r.s > 0)
        .sort((a, b) => b.s - a.s)
        .map((r) => r.c)
        .slice(0, 8),
    [commands, text],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const showFlow = !!url && url === typedUrl;

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      if (typedUrl && typedUrl !== url) {
        e.preventDefault();
        setUrl(typedUrl);
        return;
      }
      if (!typedUrl && results[active]) {
        e.preventDefault();
        results[active].run();
        onClose();
      }
      return;
    }
    if (!typedUrl && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      const n = results.length || 1;
      setActive((a) => (a + (e.key === "ArrowDown" ? 1 : -1) + n) % n);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto px-4 pb-8 pt-[9vh]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="New download"
    >
      {/* The dim layer is a sibling, not a parent: an animating parent would stop the panel's
          backdrop blur from seeing the app behind it. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 bg-[rgb(10_17_33/0.28)] animate-fade-in dark:bg-black/45" />
      <div className="relative w-full max-w-[760px] animate-scale-in overflow-hidden rounded-[22px] shadow-sheet glass-strong">
        <div className="flex h-[62px] items-center gap-3 px-5">
          {typedUrl ? (
            <Link2 className="h-5 w-5 shrink-0 text-accent" />
          ) : (
            <Search className="h-5 w-5 shrink-0 text-ink-3" />
          )}
          <input
            ref={inputRef}
            autoFocus
            data-spotlight="1"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setActive(0);
            }}
            onKeyDown={onInputKey}
            onPaste={(e) => {
              const pasted = asHttpUrl(e.clipboardData.getData("text/plain"));
              if (pasted) {
                e.preventDefault();
                setText(pasted);
                setUrl(pasted);
              }
            }}
            placeholder="Paste a link, or type a command…"
            spellCheck={false}
            autoComplete="off"
            className="h-full min-w-0 flex-1 bg-transparent text-[19px] font-[450] tracking-[-0.015em] text-ink outline-none placeholder:text-ink-3 focus-visible:shadow-none"
          />
          {!text ? (
            <button
              type="button"
              onClick={async () => {
                const t = await onPaste();
                const u = asHttpUrl(t);
                setText(t);
                if (u) setUrl(u);
                inputRef.current?.focus();
              }}
              className="flex h-8 items-center gap-1.5 rounded-full bg-fill/[0.13] px-3 text-[12.5px] font-semibold text-ink-2 transition hover:bg-fill/[0.2] hover:text-ink"
            >
              <ClipboardPaste className="h-3.5 w-3.5" />
              Paste
            </button>
          ) : typedUrl && !showFlow ? (
            <button
              type="button"
              onClick={() => setUrl(typedUrl)}
              className="flex h-8 items-center gap-1.5 rounded-full bg-accent px-3 text-[12.5px] font-semibold text-white transition hover:brightness-110"
            >
              Look up
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          ) : null}
          <Kbd className="hidden sm:inline-flex">esc</Kbd>
        </div>

        {showFlow ? (
          <div className="max-h-[72vh] overflow-y-auto hairline-t">
            <AddFlow key={url} url={url} onDone={onDone} />
          </div>
        ) : typedUrl ? (
          <div className="flex items-center gap-2 px-5 py-4 text-[13px] text-ink-2 hairline-t">
            <CornerDownLeft className="h-4 w-4" />
            Press Return to look up this link
          </div>
        ) : (
          <div className="p-2 hairline-t">
            {results.length === 0 ? (
              <div className="px-4 py-6 text-center text-[13px] text-ink-3">No commands match “{text}”.</div>
            ) : (
              <ul role="listbox" aria-label="Commands">
                {results.map((c, i) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={i === active}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => {
                        c.run();
                        onClose();
                      }}
                      className={cn(
                        "flex h-11 w-full items-center gap-3 rounded-[12px] px-3 text-left transition-colors",
                        i === active ? "bg-accent text-white" : "text-ink",
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] [&_svg]:h-4 [&_svg]:w-4",
                          i === active ? "bg-white/20" : "bg-fill/[0.13] text-ink-2",
                        )}
                      >
                        {c.icon}
                      </span>
                      <span className="flex-1 truncate text-[13.5px] font-medium">{c.title}</span>
                      {c.hint ? (
                        <span className={cn("text-[11.5px]", i === active ? "text-white/80" : "text-ink-3")}>{c.hint}</span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-1 flex items-center gap-3 px-3 pb-1 pt-2 text-[11px] text-ink-3">
              <span className="flex items-center gap-1">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd> move
              </span>
              <span className="flex items-center gap-1">
                <Kbd>↵</Kbd> run
              </span>
              <span className="ml-auto">Tip: paste any video or file link here</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
