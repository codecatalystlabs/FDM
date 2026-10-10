/** @type {import('tailwindcss').Config} */

// Every colour is a token on :root (src/index.css) written as an RGB triplet, so Tailwind's
// opacity modifiers work (bg-accent/15). Dark mode only redefines the tokens.
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: token("bg"),
        surface: token("surface"),
        "surface-2": token("surface-2"),
        "surface-3": token("surface-3"),
        ink: token("ink"),
        "ink-2": token("ink-2"),
        "ink-3": token("ink-3"),
        line: token("line"),
        "line-strong": token("line-strong"),
        accent: token("accent"),
        "accent-ink": token("accent-ink"),
        navy: token("navy"),
        brand: token("brand"),
        sky: token("sky"),
        ok: token("ok"),
        warn: token("warn"),
        bad: token("bad"),
        fill: token("fill"),
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      borderRadius: {
        sm: "8px",
        md: "10px",
        lg: "14px",
        xl: "18px",
        "2xl": "22px",
        "3xl": "28px",
      },
      boxShadow: {
        hairline: "0 0 0 0.5px rgb(var(--line-strong) / 0.9)",
        card: "0 1px 1px rgb(var(--shadow) / 0.04), 0 2px 6px rgb(var(--shadow) / 0.05), 0 0 0 0.5px rgb(var(--line-strong) / 0.7)",
        float: "0 10px 30px -8px rgb(var(--shadow) / 0.22), 0 2px 8px rgb(var(--shadow) / 0.08), 0 0 0 0.5px rgb(var(--line-strong) / 0.8)",
        sheet: "0 30px 80px -20px rgb(var(--shadow) / 0.45), 0 8px 24px rgb(var(--shadow) / 0.14), 0 0 0 0.5px rgb(var(--line-strong) / 0.9)",
        glow: "0 0 0 4px rgb(var(--accent) / 0.18)",
      },
      transitionTimingFunction: {
        spring: "cubic-bezier(.2,.8,.2,1)",
      },
      keyframes: {
        "fade-up": { from: { opacity: "0", transform: "translateY(6px)" }, to: { opacity: "1", transform: "none" } },
        "scale-in": { from: { opacity: "0", transform: "scale(.96) translateY(6px)" }, to: { opacity: "1", transform: "none" } },
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "slide-in": { from: { opacity: "0", transform: "translateX(16px)" }, to: { opacity: "1", transform: "none" } },
        shimmer: { from: { backgroundPosition: "-400px 0" }, to: { backgroundPosition: "400px 0" } },
        breathe: { "0%,100%": { opacity: ".55", transform: "scale(.96)" }, "50%": { opacity: "1", transform: "scale(1)" } },
        "progress-stripes": { from: { backgroundPosition: "0 0" }, to: { backgroundPosition: "28px 0" } },
        float: { "0%,100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-6px)" } },
        aurora: {
          "0%,100%": { transform: "translate3d(0,0,0) scale(1)" },
          "50%": { transform: "translate3d(4%,-3%,0) scale(1.08)" },
        },
      },
      animation: {
        "fade-up": "fade-up .35s cubic-bezier(.2,.8,.2,1) both",
        "scale-in": "scale-in .28s cubic-bezier(.2,.8,.2,1) both",
        "fade-in": "fade-in .2s ease-out both",
        "slide-in": "slide-in .32s cubic-bezier(.2,.8,.2,1) both",
        shimmer: "shimmer 1.4s linear infinite",
        breathe: "breathe 2.4s ease-in-out infinite",
        "progress-stripes": "progress-stripes .9s linear infinite",
        float: "float 4s ease-in-out infinite",
        aurora: "aurora 18s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
