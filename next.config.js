/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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

module.exports = nextConfig
