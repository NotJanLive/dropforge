/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      screens: {
        xs: "420px",
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        surface: {
          DEFAULT: "hsl(var(--surface))",
          2: "hsl(var(--surface-2))",
          3: "hsl(var(--surface-3))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          strong: "hsl(var(--primary-strong))",
          foreground: "hsl(var(--primary-foreground))",
        },
        brand: {
          1: "hsl(var(--primary))",
          2: "hsl(var(--brand-2))",
          3: "hsl(var(--brand-3))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        success: "hsl(var(--success))",
        warning: "hsl(var(--warning))",
        danger: "hsl(var(--danger))",
        info: "hsl(var(--info))",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 4px)",
        sm: "calc(var(--radius) - 6px)",
        "2xl": "calc(var(--radius) + 6px)",
        "3xl": "calc(var(--radius) + 14px)",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
      letterSpacing: {
        micro: "0.08em",
      },
      boxShadow: {
        panel: "0 1px 0 0 hsl(0 0% 100% / 0.04) inset, 0 18px 40px -24px hsl(240 40% 2% / 0.9)",
        lift: "0 24px 60px -28px hsl(240 40% 2% / 0.95)",
        glow: "0 0 0 1px hsl(var(--primary) / 0.35), 0 12px 40px -12px hsl(var(--primary) / 0.45)",
        "glow-sm": "0 0 18px -4px hsl(var(--primary) / 0.55)",
      },
      backgroundImage: {
        "brand-gradient": "linear-gradient(100deg, hsl(var(--primary)), hsl(var(--brand-2)))",
        "brand-soft":
          "linear-gradient(135deg, hsl(var(--primary) / 0.18), hsl(var(--brand-2) / 0.10) 55%, transparent)",
        grid: "linear-gradient(hsl(var(--foreground) / 0.07) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--foreground) / 0.07) 1px, transparent 1px)",
      },
      backgroundSize: {
        "grid-cell": "36px 36px",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
        "pulse-ring": {
          "0%": { transform: "scale(0.9)", opacity: "0.7" },
          "70%": { transform: "scale(2.2)", opacity: "0" },
          "100%": { transform: "scale(2.2)", opacity: "0" },
        },
        "bar-stripe": {
          from: { backgroundPosition: "0 0" },
          to: { backgroundPosition: "28px 0" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.35s cubic-bezier(0.22, 1, 0.36, 1) both",
        "fade-in": "fade-in 0.3s ease both",
        shimmer: "shimmer 1.8s infinite",
        "pulse-ring": "pulse-ring 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "bar-stripe": "bar-stripe 0.8s linear infinite",
      },
      transitionTimingFunction: {
        spring: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
    },
  },
  plugins: [],
};
