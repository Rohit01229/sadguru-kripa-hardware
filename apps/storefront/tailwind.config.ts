import type { Config } from "tailwindcss";
import preset from "@hardware/config/tailwind";

export default {
  presets: [preset],
  content: ["./app/**/*.{ts,tsx}", "../../packages/ui/src/**/*.{ts,tsx}"],
} satisfies Config;
