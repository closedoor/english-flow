import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  ...(process.env.ENGLISH_FLOW_RENDER_EXPORT === "1" ? { output: "export" } : {}),
};

export default nextConfig;
