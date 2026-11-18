import type { Config } from "tailwindcss";

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
          100: "#f8f0dc",
          300: "#e6cd8f",
          400: "#d9b76a",
          500: "#c9a24b",
          600: "#a9822f",
        },
      },
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
