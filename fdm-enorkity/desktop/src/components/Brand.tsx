import { cn } from "@/lib/utils";

/* The CatalystFDM dragon (brand/ — built from the Duara Mail dragon by brand/make_brand.py).
 * The files carry their own masks, so they are used as images rather than inlined. */

export function AppIcon({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <img
      src="/brand/app-icon.svg"
      width={size}
      height={size}
      alt=""
      draggable={false}
      className={cn("shrink-0 select-none drop-shadow-[0_2px_6px_rgba(0,49,107,0.35)]", className)}
    />
  );
}

/** Dragon mark that follows the theme: navy/blue on light, white/sky on dark. */
export function Mark({ size = 64, className }: { size?: number; className?: string }) {
  return (
    <span className={cn("relative inline-block shrink-0", className)} style={{ width: size, height: size }}>
      <img src="/brand/mark.svg" alt="" draggable={false} className="absolute inset-0 h-full w-full select-none dark:hidden" />
      <img src="/brand/mark-reverse.svg" alt="" draggable={false} className="absolute inset-0 hidden h-full w-full select-none dark:block" />
    </span>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-[650] tracking-[-0.02em]", className)} style={{ fontFamily: "var(--font-display)" }}>
      <span className="text-navy dark:text-white">Catalyst</span>
      <span className="text-brand dark:text-sky">FDM</span>
    </span>
  );
}
