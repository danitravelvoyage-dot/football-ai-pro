import type { Config } from "tailwindcss";

/**
 * Theme roles. Background, text and border colors of the navy scale (and bg-white) read CSS variables, so the admin
 * area can switch to a dark theme by redefining them (app/globals.css, [data-theme="dark"]). The variables default to
 * the exact palette below, so nothing changes where the dark theme is not applied.
 */
const NAVY_SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
const navyRole = (role: "bg" | "text" | "line") =>
  Object.fromEntries(NAVY_SHADES.map((shade) => [shade, `rgb(var(--navy-${role}-${shade}) / <alpha-value>)`]));

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: {
          50: "#eef2f8",
          100: "#d5deec",
          200: "#aabbd9",
          300: "#7f98c6",
          400: "#4f6fa8",
          500: "#2f4f86",
          600: "#1f3b6b",
          700: "#152d55",
          800: "#0e2140",
          900: "#081528",
          950: "#050d1b",
        },
        gold: {
          50: "#fdfaf3",
          100: "#faf3e2",
          200: "#f2e4bf",
          300: "#e8d39e",
          400: "#dcc08a",
          500: "#c7a665",
          600: "#a2843f",
        },
        champagne: {
          50: "#fdfaf3",
          100: "#faf3e2",
          200: "#f2e4bf",
          300: "#e8d39e",
          400: "#dcc08a",
          500: "#c7a665",
          600: "#a2843f",
        },
        mist: {
          50: "#fafafb",
          100: "#f3f4f7",
          200: "#e5e8ee",
          300: "#cfd4de",
        },
      },
      backgroundColor: { navy: navyRole("bg"), white: "rgb(var(--surface) / <alpha-value>)" },
      textColor: { navy: navyRole("text") },
      borderColor: { navy: navyRole("line") },
      ringColor: { navy: navyRole("line") },
      fontFamily: {
        sans: ["var(--font-body)", "Cairo", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Georgia", "serif"],
      },
      keyframes: {
        fadeUp: { "0%": { opacity: "0", transform: "translateY(24px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
        shimmer: { "0%": { backgroundPosition: "-200% 0" }, "100%": { backgroundPosition: "200% 0" } },
        drift: { "0%,100%": { transform: "translate3d(0,0,0) scale(1)" }, "50%": { transform: "translate3d(-2%,2%,0) scale(1.06)" } },
      },
      animation: {
        fadeUp: "fadeUp 0.9s cubic-bezier(.2,.7,.2,1) both",
        shimmer: "shimmer 6s linear infinite",
        drift: "drift 28s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
export default config;
