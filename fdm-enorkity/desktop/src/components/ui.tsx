import * as React from "react";
import { cn } from "@/lib/utils";

export function Button({
  className,
  variant = "default",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "ghost" | "outline" | "danger";
}) {
  const styles: Record<string, string> = {
    default:
      "bg-gradient-to-r from-primary to-accent text-white shadow-soft hover:opacity-95 disabled:opacity-40",
    ghost: "bg-transparent hover:bg-white/5",
    outline: "border border-white/10 hover:bg-white/5",
    danger: "bg-red-600/90 hover:bg-red-600 text-white",
  };
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-medium transition",
        styles[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-lg border border-white/10 bg-card/80 p-4 shadow-soft backdrop-blur-sm",
        "html.light:border-slate-200 html.light:bg-white/90",
        className,
      )}
      {...props}
    />
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none ring-0",
        "focus:border-accent/60 focus:ring-2 focus:ring-accent/30",
        "html.light:border-slate-200 html.light:bg-white",
        props.className,
      )}
      {...props}
    />
  );
}

export function Progress({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
      <div
        className="h-full rounded-full bg-gradient-to-r from-primary to-accent transition-[width] duration-300"
        style={{ width: `${v}%` }}
      />
    </div>
  );
}
