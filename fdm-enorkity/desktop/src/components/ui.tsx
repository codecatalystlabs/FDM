import * as React from "react";
import { Check, ChevronDown, Minus, Plus, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

/* Apple-style primitives. Buttons are pills; surfaces use hairlines instead of borders;
 * motion uses one spring curve (ease-spring) so the whole app moves the same way. */

type ButtonVariant = "primary" | "secondary" | "plain" | "glass" | "destructive" | "tinted";
type ButtonSize = "sm" | "md" | "lg";

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    "accent-gradient text-white shadow-[0_1px_2px_rgb(var(--shadow)/0.2),inset_0_0.5px_0_rgb(255_255_255/0.25)] hover:brightness-[1.06] active:brightness-95",
  secondary: "bg-fill/[0.13] text-ink hover:bg-fill/[0.2] active:bg-fill/[0.26]",
  tinted: "bg-accent/[0.12] text-accent-ink hover:bg-accent/[0.18] active:bg-accent/[0.24] dark:text-accent",
  plain: "text-accent-ink hover:bg-fill/[0.1] dark:text-accent",
  glass: "glass text-ink shadow-hairline hover:bg-surface/90",
  destructive: "bg-bad/[0.1] text-bad hover:bg-bad/[0.16] active:bg-bad/[0.22]",
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-7 gap-1.5 px-3 text-[12.5px]",
  md: "h-9 gap-2 px-4 text-[13.5px]",
  lg: "h-11 gap-2 px-6 text-[15px]",
};

export const Button = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }
>(function Button({ className, variant = "secondary", size = "md", type = "button", ...props }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex select-none items-center justify-center whitespace-nowrap rounded-full font-medium tracking-[-0.01em] transition duration-200 ease-spring",
        "active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40",
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      {...props}
    />
  );
});

/** Circular icon button (SF Symbols-style controls). */
export const IconButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md" | "lg"; label: string }
>(function IconButton({ className, variant = "secondary", size = "md", label, type = "button", ...props }, ref) {
  const dims = { sm: "h-7 w-7", md: "h-9 w-9", lg: "h-11 w-11" }[size];
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={props.title ?? label}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full transition duration-200 ease-spring",
        "active:scale-90 disabled:pointer-events-none disabled:opacity-40 [&_svg]:h-[17px] [&_svg]:w-[17px]",
        size === "sm" && "[&_svg]:h-[15px] [&_svg]:w-[15px]",
        buttonVariants[variant],
        dims,
        className,
      )}
      {...props}
    />
  );
});

export function Panel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-xl bg-surface shadow-card", className)} {...props} />;
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "h-9 w-full rounded-[10px] bg-fill/[0.1] px-3 text-[13.5px] text-ink outline-none transition duration-200 placeholder:text-ink-3",
          "shadow-[inset_0_0_0_0.5px_rgb(var(--line-strong)/0.6)] focus:bg-surface focus:shadow-[0_0_0_3.5px_rgb(var(--accent)/0.3),inset_0_0_0_1px_rgb(var(--accent)/0.7)]",
          "disabled:opacity-50",
          className,
        )}
        {...props}
      />
    );
  },
);

export const SearchField = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> & { value: string; onChange: (v: string) => void }
>(function SearchField({ className, value, onChange, placeholder = "Search", ...props }, ref) {
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3" />
      <Input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 rounded-lg pl-8 pr-7 text-[13px]"
        spellCheck={false}
        {...props}
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange("")}
          className="absolute right-1.5 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-full bg-ink-3/60 text-surface transition hover:bg-ink-3"
        >
          <X className="h-2.5 w-2.5" strokeWidth={3} />
        </button>
      ) : null}
    </div>
  );
});

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={cn("relative inline-flex", className)}>
      <select
        className={cn(
          "h-8 w-full cursor-pointer appearance-none rounded-lg bg-fill/[0.12] py-0 pl-3 pr-8 text-[13px] font-medium text-ink outline-none transition",
          "shadow-[inset_0_0_0_0.5px_rgb(var(--line-strong)/0.6)] hover:bg-fill/[0.18] focus-visible:shadow-glow",
          "[&>option]:bg-surface [&>option]:text-ink",
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3" />
    </div>
  );
}

/** iOS switch. */
export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-[26px] w-[44px] shrink-0 items-center rounded-full transition-colors duration-300 ease-spring disabled:opacity-40",
        checked ? "bg-ok dark:bg-ok/90" : "bg-fill/[0.28]",
      )}
    >
      <span
        className={cn(
          "absolute left-[2px] h-[22px] w-[22px] rounded-full bg-white shadow-[0_2px_4px_rgb(0_0_0/0.18),0_0_0_0.5px_rgb(0_0_0/0.06)] transition-transform duration-300 ease-spring",
          checked && "translate-x-[18px]",
        )}
      />
    </button>
  );
}

/** Segmented control with a sliding thumb. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = "md",
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode; title?: string }[];
  className?: string;
  size?: "sm" | "md";
}) {
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div
      role="radiogroup"
      className={cn(
        "relative inline-grid rounded-[9px] bg-fill/[0.14] p-[2px]",
        size === "sm" ? "h-7 text-[12px]" : "h-8 text-[13px]",
        className,
      )}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      <span
        aria-hidden
        className="absolute bottom-[2px] left-[2px] top-[2px] rounded-[7px] bg-surface shadow-[0_1px_3px_rgb(var(--shadow)/0.12),0_0_0_0.5px_rgb(var(--shadow)/0.05)] transition-transform duration-300 ease-spring dark:bg-surface-3"
        style={{ width: `calc((100% - 4px) / ${options.length})`, transform: `translateX(${index * 100}%)` }}
      />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            "relative z-[1] flex items-center justify-center gap-1.5 whitespace-nowrap px-3 font-medium transition-colors [&_svg]:h-3.5 [&_svg]:w-3.5",
            o.value === value ? "text-ink" : "text-ink-2 hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stepper({
  value,
  onChange,
  min,
  max,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  label: string;
}) {
  return (
    <div className="inline-flex items-center gap-2" aria-label={label}>
      <span className="num w-6 text-center text-[13.5px] font-semibold">{value}</span>
      <div className="inline-flex h-7 overflow-hidden rounded-lg bg-fill/[0.13]">
        <button
          type="button"
          aria-label={`Decrease ${label}`}
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - 1))}
          className="flex w-8 items-center justify-center text-ink transition hover:bg-fill/[0.12] disabled:opacity-30"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <span className="my-1.5 w-px bg-line-strong" />
        <button
          type="button"
          aria-label={`Increase ${label}`}
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + 1))}
          className="flex w-8 items-center justify-center text-ink transition hover:bg-fill/[0.12] disabled:opacity-30"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

const badgeTones = {
  neutral: "bg-fill/[0.13] text-ink-2",
  accent: "bg-accent/[0.13] text-accent-ink dark:text-accent",
  navy: "bg-navy text-white",
  success: "bg-ok/[0.13] text-ok",
  danger: "bg-bad/[0.12] text-bad",
  warning: "bg-warn/[0.14] text-warn",
} as const;

export function Badge({
  className,
  tone = "neutral",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof badgeTones }) {
  return (
    <span
      className={cn(
        "inline-flex h-[19px] items-center gap-1 whitespace-nowrap rounded-full px-2 text-[11px] font-semibold leading-none [&_svg]:h-3 [&_svg]:w-3",
        badgeTones[tone],
        className,
      )}
      {...props}
    />
  );
}

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("skeleton rounded-lg", className)} {...props} />;
}

/** Thin capsule progress bar. `indeterminate` shows moving stripes (merging, converting…). */
export function Progress({
  value,
  className,
  tone = "accent",
  indeterminate,
}: {
  value: number;
  className?: string;
  tone?: "accent" | "warn" | "ok";
  indeterminate?: boolean;
}) {
  const v = Math.max(0, Math.min(100, value));
  const fill = { accent: "bg-accent", warn: "bg-warn", ok: "bg-ok" }[tone];
  return (
    <div className={cn("h-[5px] w-full overflow-hidden rounded-full bg-fill/[0.16]", className)}>
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-700 ease-spring",
          fill,
          indeterminate && "stripes animate-progress-stripes",
        )}
        style={{ width: `${indeterminate ? 100 : v}%` }}
      />
    </div>
  );
}

/** Activity-ring style circular progress. */
export function ProgressRing({
  value,
  size = 44,
  stroke = 4,
  className,
  children,
  tone = "accent",
}: {
  value: number;
  size?: number;
  stroke?: number;
  className?: string;
  children?: React.ReactNode;
  tone?: "accent" | "warn" | "ok" | "white";
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  const color = { accent: "rgb(var(--accent))", warn: "rgb(var(--warn))", ok: "rgb(var(--ok))", white: "#fff" }[tone];
  return (
    <div className={cn("relative inline-flex items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} stroke="currentColor" className="opacity-20" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          stroke={color}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v / 100)}
          style={{ transition: "stroke-dashoffset .7s cubic-bezier(.2,.8,.2,1)" }}
        />
      </svg>
      {children ? <div className="absolute inset-0 flex items-center justify-center">{children}</div> : null}
    </div>
  );
}

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] bg-fill/[0.14] px-1 font-sans text-[10.5px] font-semibold text-ink-2 shadow-[inset_0_-0.5px_0_rgb(var(--line-strong))]",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon: React.ReactNode;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-16 text-center animate-fade-up", className)}>
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-[20px] bg-gradient-to-b from-surface to-surface-2 text-ink-3 shadow-card [&_svg]:h-7 [&_svg]:w-7">
        {icon}
      </div>
      <div className="text-headline">{title}</div>
      {children ? <div className="mt-1.5 max-w-sm text-[13px] text-ink-2">{children}</div> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/** Centered modal sheet with a dimmed, blurred backdrop. Esc and backdrop click close it. */
export function Sheet({
  open,
  onClose,
  children,
  className,
  label,
  align = "center",
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  label: string;
  align?: "center" | "top";
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex justify-center overflow-y-auto bg-[rgb(10_17_33/0.32)] p-4 animate-fade-in dark:bg-black/50",
        align === "center" ? "items-center" : "items-start pt-[10vh]",
      )}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      <div className={cn("w-full max-w-lg animate-scale-in rounded-2xl bg-surface shadow-sheet", className)}>{children}</div>
    </div>
  );
}

/* ---------- Grouped list (System Settings style) ---------- */

export function Group({ title, footer, children, className }: { title?: string; footer?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("animate-fade-up", className)}>
      {title ? <div className="mb-1.5 px-4 text-[12px] font-semibold text-ink-3">{title}</div> : null}
      <div className="divide-y divide-line overflow-hidden rounded-xl bg-surface shadow-card">{children}</div>
      {footer ? <div className="mt-1.5 px-4 text-[12px] leading-snug text-ink-3">{footer}</div> : null}
    </section>
  );
}

export function Row({
  icon,
  iconClass,
  title,
  subtitle,
  children,
  onClick,
}: {
  icon?: React.ReactNode;
  iconClass?: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children?: React.ReactNode;
  onClick?: () => void;
}) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      onClick={onClick}
      className={cn(
        "flex min-h-[48px] w-full items-center gap-3 px-4 py-2.5 text-left",
        onClick && "transition hover:bg-fill/[0.06] active:bg-fill/[0.1]",
      )}
    >
      {icon ? (
        <span
          className={cn(
            "flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px] text-white [&_svg]:h-[15px] [&_svg]:w-[15px]",
            iconClass ?? "bg-accent",
          )}
        >
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-medium text-ink">{title}</span>
        {subtitle ? <span className="mt-0.5 block text-[12px] leading-snug text-ink-3">{subtitle}</span> : null}
      </span>
      {children ? <span className="flex shrink-0 items-center gap-2">{children}</span> : null}
    </Comp>
  );
}

export function CheckMark({ className }: { className?: string }) {
  return <Check className={cn("h-4 w-4 text-accent", className)} strokeWidth={2.6} />;
}
