import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Legacy cache handler for ISR and fetch cache
  cacheHandler: resolve(__dirname, 'cacheHandler.ts'),
  // Next.js 16 'use cache' directive handler (with edge cache clearing)
  cacheHandlers: {
    default: resolve(__dirname, 'useCacheHandler.ts'),
  },
  // cacheComponents: true, // DISABLED: Causes 60s timeouts with 'use cache' during static generation
  cacheMaxMemorySize: 0, // Disable default in-memory caching
  images: {
    remotePatterns: process.env.NEXT_IMAGE_DOMAIN ? [
      {
        protocol: 'https',
        hostname: process.env.NEXT_IMAGE_DOMAIN,
        pathname: '/sites/default/files/**',
      },
    ] : [],
  },
}

export default nextConfig;
