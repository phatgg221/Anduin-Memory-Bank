import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Enforces the data flow: page → store (React Query) → services → lib/axiosClient → /api.
const restrictImports = (group, message) => ({
  "no-restricted-imports": ["error", { patterns: [{ group, message }] }],
});

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "store/**/*.ts", "services/**/*.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "fetch", message: "Call the API through services/ and lib/axiosClient." },
      ],
    },
  },
  {
    files: ["app/**/*.{ts,tsx}"],
    rules: restrictImports(
      ["@/services/*", "@/lib/axiosClient", "axios"],
      "Pages read data through store/ hooks, not services or axios directly.",
    ),
  },
  {
    files: ["components/**/*.{ts,tsx}"],
    rules: restrictImports(
      ["@/store/*", "@/services/*", "@/lib/axiosClient", "axios"],
      "components/ is presentational: take props, emit callbacks. Pages wire store hooks to components.",
    ),
  },
  {
    files: ["store/**/*.ts"],
    rules: restrictImports(
      ["@/components/*", "@/lib/axiosClient", "axios"],
      "store/ hooks call services/, never axios directly.",
    ),
  },
  {
    files: ["services/**/*.ts"],
    rules: restrictImports(
      ["react", "@tanstack/*", "@/store/*", "@/components/*"],
      "services/ are plain typed functions with no React.",
    ),
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
