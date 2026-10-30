import type { NextConfig } from "next";

// Tauri sets TAURI_ENV_* variables when it runs beforeDevCommand / beforeBuildCommand.
// The desktop terminal loads static files, so it needs a static export;
// the web application is deployed as a regular Next.js server build.
// cacheComponents / partialPrefetching enable PPR, which is not supported in export mode.
const isTauri = Boolean(process.env.TAURI_ENV_PLATFORM);

const nextConfig: NextConfig = {
  ...(isTauri
    ? { output: "export", images: { unoptimized: true } }
    : { cacheComponents: true, partialPrefetching: true }),
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
