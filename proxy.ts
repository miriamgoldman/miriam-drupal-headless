import { middleware as pantheonMiddleware } from '@pantheon-systems/nextjs-cache-handler/middleware';

// Next.js 16 uses 'proxy' naming convention
export const proxy = pantheonMiddleware;

// Static config required by Next.js 16
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.png|.*\\.jpg|.*\\.jpeg|.*\\.gif|.*\\.svg).*)',
  ],
};
