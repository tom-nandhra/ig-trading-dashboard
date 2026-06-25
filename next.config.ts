import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // Other machines on the LAN load the app at http://<windows-LAN-IP>:3000,
  // so that host is the "origin" of their dev requests. Next blocks unknown
  // dev origins by default; whitelist yours here.
  // TODO: replace 192.168.1.50 with YOUR Windows IPv4 from `ipconfig`.
  allowedDevOrigins: ["192.168.1.50"],
};

export default nextConfig;
