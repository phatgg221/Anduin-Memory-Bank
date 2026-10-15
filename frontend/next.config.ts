import type { NextConfig } from "next";

// The browser only ever calls /api/* on this origin; Next proxies it to FastAPI.
// Rewrites are resolved at build time for production builds, so pass this as a Docker build arg too.
const backend = process.env.BACKEND_INTERNAL_URL ?? "http://localhost:8000";

// This app is its own root. Without pinning it, the repo-root bun.lock (for the bun scripts) makes Next treat
// the whole monorepo as the workspace, and standalone output nests under .next/standalone/frontend/.
const projectRoot = __dirname;

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: projectRoot,
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    root: projectRoot,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async redirects() {
    return [{ source: "/", destination: "/war-room", permanent: false }];
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
  },
};

export default nextConfig;
