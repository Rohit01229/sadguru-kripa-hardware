// Import-boundary rules from 03-technical-architecture.md §1.
// Compose the relevant block into a package/app's eslint config.

// Apps must never import the Prisma client directly — they go through @hardware/core.
export const noDbInApps = {
  files: ["**/*.{ts,tsx}"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["@hardware/db", "@hardware/db/*"],
            message:
              "Apps must not import @hardware/db directly — call @hardware/core instead (03 §1).",
          },
        ],
      },
    ],
  },
};

// packages/core is plain TypeScript — no React / Next imports (so it can be extracted later).
export const noReactNextInCore = {
  files: ["**/*.{ts,tsx}"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["react", "react-dom", "next", "next/*"],
            message: "packages/core is framework-free — no React/Next imports (03 §1).",
          },
        ],
      },
    ],
  },
};
