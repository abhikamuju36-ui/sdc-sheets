import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Overridable so a second dev server (e.g. a preview) can run alongside
  // the main one — Next refuses two dev servers sharing one dist dir.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  allowedDevOrigins: ["server-app1", "localhost"],
  serverExternalPackages: ["@azure/msal-node-extensions"],
};

export default nextConfig;
