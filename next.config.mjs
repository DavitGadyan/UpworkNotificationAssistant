/** @type {import('next').NextConfig} */
const nextConfig = {
  // `standalone` traces exactly the files this app needs and emits a
  // self-contained server at .next/standalone/server.js - deployable to any
  // Node host, container or VM without node_modules travelling with it.
  output: "standalone",
  images: { formats: ["image/avif", "image/webp"] },
  poweredByHeader: false,
  // Server-only DB drivers: keep them out of the webpack bundle.
  serverExternalPackages: ["postgres", "@electric-sql/pglite", "better-sqlite3"],
};

export default nextConfig;
