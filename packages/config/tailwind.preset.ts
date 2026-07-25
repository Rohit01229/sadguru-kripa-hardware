import type { Config } from "tailwindcss";

// Shared Tailwind preset — shadcn/ui design tokens mapped to CSS variables.
// Apps define the :root/.dark variables in their globals.css; this preset wires
// the Tailwind color + radius theme to them so `bg-background`, `text-muted-
// foreground`, `bg-card`, `border-border`, `bg-primary`, `rounded-lg`, etc. all
// resolve. Apps set their own `content` globs and extend this.
const preset: Omit<Config, "content"> = {
  darkMode: ["class"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // Semantic status surfaces (warm palette). Wired to the --success/--warning/
        // --info CSS vars in both apps' globals.css so `bg-success`, `text-warning`,
        // `border-info`, the `/10` tint forms, and the `*-foreground` pairs all
        // resolve. These give Alert (and any status banner) a real semantic surface
        // instead of raw emerald/amber/blue palette classes in screens.
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        info: {
          DEFAULT: "hsl(var(--info))",
          foreground: "hsl(var(--info-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      // Overlay + loader motion used by Dialog / Sheet / DropdownMenu / Toast /
      // Spinner in @hardware/ui. Defined here (instead of pulling in
      // tailwindcss-animate) so the shared component library stays dependency-free.
      // All transitions respect prefers-reduced-motion via the `motion-safe:`
      // variant the components apply, so this is purely additive.
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "fade-out": {
          from: { opacity: "1" },
          to: { opacity: "0" },
        },
        "zoom-in": {
          from: { opacity: "0", transform: "scale(0.96)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        "slide-in-right": {
          from: { transform: "translateX(100%)" },
          to: { transform: "translateX(0)" },
        },
        "slide-in-left": {
          from: { transform: "translateX(-100%)" },
          to: { transform: "translateX(0)" },
        },
        "slide-in-bottom": {
          from: { transform: "translateY(100%)" },
          to: { transform: "translateY(0)" },
        },
        "slide-in-top": {
          from: { transform: "translateY(-8px)", opacity: "0" },
          to: { transform: "translateY(0)", opacity: "1" },
        },
        spin: {
          to: { transform: "rotate(360deg)" },
        },
      },
      animation: {
        "fade-in": "fade-in 150ms ease-out",
        "fade-out": "fade-out 150ms ease-in",
        "zoom-in": "fade-in 150ms ease-out, zoom-in 150ms ease-out",
        "slide-in-right": "slide-in-right 250ms cubic-bezier(0.32, 0.72, 0, 1)",
        "slide-in-left": "slide-in-left 250ms cubic-bezier(0.32, 0.72, 0, 1)",
        "slide-in-bottom": "slide-in-bottom 250ms cubic-bezier(0.32, 0.72, 0, 1)",
        "slide-in-top": "slide-in-top 150ms ease-out",
        spin: "spin 0.7s linear infinite",
      },
    },
  },
  plugins: [],
};

export default preset;
