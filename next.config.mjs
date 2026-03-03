import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  cacheHandler: path.resolve(__dirname, "./cache-handler.mjs"),
  cacheMaxMemorySize: 0,
  images: {
    remotePatterns: process.env.NEXT_IMAGE_DOMAIN ? [
      {
        protocol: 'https',
        hostname: process.env.NEXT_IMAGE_DOMAIN,
        pathname: '/sites/default/files/**',
      },
    ] : [],
  },
};

export default nextConfig;
