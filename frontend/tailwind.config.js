/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Manrope", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "monospace"],
      },
      colors: {
        ink: { 950: "#07070d", 900: "#0c0c16", 850: "#11111d", 800: "#161625", 700: "#20203a", 600: "#2c2c4a" },
        nova: { 300: "#c4b5fd", 400: "#a78bfa", 500: "#8b5cf6", 600: "#7c3aed" },
        aqua: { 300: "#67e8f9", 400: "#22d3ee" },
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(167,139,250,.25), 0 10px 40px -10px rgba(139,92,246,.45)",
        card: "0 1px 0 rgba(255,255,255,.04) inset, 0 20px 50px -25px rgba(0,0,0,.8)",
      },
      keyframes: {
        float: { "0%,100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-12px)" } },
        shimmer: { "0%": { backgroundPosition: "-200% 0" }, "100%": { backgroundPosition: "200% 0" } },
        drift: {
          "0%,100%": { transform: "translate(0,0) scale(1)" },
          "33%": { transform: "translate(6%,-4%) scale(1.08)" },
          "66%": { transform: "translate(-5%,5%) scale(.95)" },
        },
      },
      animation: {
        float: "float 6s ease-in-out infinite",
        shimmer: "shimmer 2.4s linear infinite",
        drift: "drift 18s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
