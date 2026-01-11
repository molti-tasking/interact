import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Note: Static export disabled to support Server Actions for AI features
  // output: "export",
  basePath: process.env.PAGES_BASE_PATH,
};

export default nextConfig;
