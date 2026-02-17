import { middleware as pantheonMiddleware } from '@pantheon-systems/nextjs-cache-handler/middleware';
import type { NextRequest } from 'next/server';

// Next.js 16 uses 'proxy' naming convention - must be a function export
export function proxy(request: NextRequest) {
  return pantheonMiddleware(request);
}

// Static config required by Next.js 16
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.png|.*\\.jpg|.*\\.jpeg|.*\\.gif|.*\\.svg).*)',
  ],
};
