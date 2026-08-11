// Shared base ESLint flat config for the monorepo.
// Consumers: `import base from "@hardware/config/eslint";` then spread into their config.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["dist/**", ".next/**", ".turbo/**", "node_modules/**", "coverage/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "warn",
      // `destructuring: "all"` — only complain when EVERY binding in a destructure
      // could be const. Several pages do `let [units, brands, tree] = await
      // Promise.all(…)` and then reassign only `units`; the default ("any") demands a
      // const that the other bindings cannot have, and splitting the Promise.all to
      // satisfy it would be worse code.
      "prefer-const": ["error", { destructuring: "all" }],
    },
  },
  // Service workers run in a WorkerGlobalScope, not the browser or Node: `self`,
  // `caches`, `fetch`, `Response` and `URL` are all legitimately global there. Without
  // this, `no-undef` reports every one of them as an error and the whole lint task
  // fails on a file that is perfectly correct.
  {
    files: ["**/public/sw.js", "**/public/**/*.worker.js"],
    languageOptions: {
      globals: {
        self: "readonly",
        caches: "readonly",
        fetch: "readonly",
        Response: "readonly",
        Request: "readonly",
        URL: "readonly",
        clients: "readonly",
        skipWaiting: "readonly",
      },
    },
  },
  prettier,
);
