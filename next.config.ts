import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  allowedDevOrigins: ["server-app1", "localhost"],
  serverExternalPackages: ["@azure/msal-node-extensions"],
};

export default nextConfig;
