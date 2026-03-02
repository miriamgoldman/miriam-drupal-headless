// next.config.mjs
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  cacheComponents: true,

  // Traditional cache handler (ISR, routes, fetch cache)
  cacheHandler: path.resolve(__dirname, "./cache-handler.mjs"),

  // Next.js 16 'use cache' directive handler
  cacheHandlers: {
    default: path.resolve(__dirname, "./use-cache-handler.mjs"),
  },

  cacheMaxMemorySize: 0,

  transpilePackages: ['@pantheon-systems/nextjs-cache-handler'],

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
