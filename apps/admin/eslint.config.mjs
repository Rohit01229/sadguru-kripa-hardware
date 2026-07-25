// Flat ESLint config for apps/admin. Uses the shared monorepo base + the
// import-boundary rule that forbids apps from importing @hardware/db (03 §1).
import base from "@hardware/config/eslint";
import { noDbInApps } from "@hardware/config/eslint-boundaries";

export default [
  { ignores: [".next/**", "next-env.d.ts"] },
  ...base,
  noDbInApps,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
  },
];
