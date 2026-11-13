import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { 950: "#050a15", 900: "#08101f", 850: "#0b1529", 800: "#0f1b33", 700: "#16264a", 600: "#1f3360", 500: "#2c4378" },
        line: "#1c2c4d",
        emerald: { 300: "#6ee7b7", 400: "#34d399", 500: "#10b981", 600: "#059669" },
        gold: { 300: "#fcd679", 400: "#f5b83d", 500: "#e09b12" },
        azure: { 300: "#93c5fd", 400: "#60a5fa", 500: "#3b82f6" },
        rose: { 400: "#fb7185", 500: "#f43f5e" },
        mute: "#8796b8",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: { glow: "0 0 0 1px rgba(16,185,129,.25), 0 8px 30px -12px rgba(16,185,129,.35)" },
      keyframes: {
        fadein: { from: { opacity: "0", transform: "translateY(4px)" }, to: { opacity: "1", transform: "none" } },
        pulseDot: { "0%,100%": { opacity: "1" }, "50%": { opacity: ".35" } },
      },
      animation: { fadein: "fadein .35s ease-out both", pulseDot: "pulseDot 1.4s ease-in-out infinite" },
    },
  },
  plugins: [],
} satisfies Config;
