# Next.js + Drupal on Pantheon

A headless Drupal site using Next.js 16 on Pantheon with tag-based cache invalidation via the Pantheon cache handler.

Based on the [next-drupal basic starter](https://github.com/chapter-three/next-drupal-basic-starter) (`next-drupal ^2.0.0-beta.2`).

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Drupal Setup](#drupal-setup)
- [Next.js Setup](#nextjs-setup)
- [Project Structure](#project-structure)
- [Environment Variables](#environment-variables)
- [Pantheon Cache Handler](#pantheon-cache-handler)
- [Cache Invalidation Flow](#cache-invalidation-flow)
- [Tag Convention](#tag-convention)
- [Upgrading from Next.js 15 to 16](#upgrading-from-nextjs-15-to-16)
- [Verifying Cache Behavior](#verifying-cache-behavior)
- [Gotchas](#gotchas)

## Architecture Overview

```
Drupal (CMS)  ──JSON:API──>  Next.js 16 (App Router)  ──>  Pantheon CDN
                                    │
                              GCS Cache Handler
                              (shared cache + edge purge)
```

- **Drupal** serves content via JSON:API and sends webhook notifications on content changes
- **Next.js** renders pages using ISR (Incremental Static Regeneration) with 60-second revalidation
- **Pantheon cache handler** stores cache in GCS (shared across server instances) and purges CDN edge cache on invalidation
- **Tag-based invalidation** allows Drupal content saves to immediately purge specific cached pages via surrogate keys

## Drupal Setup

### Required Modules

Install and configure the [Next.js module for Drupal](https://www.drupal.org/project/next):

1. Enable JSON:API (core) and the `next` contrib module
2. Configure a Next.js site at `/admin/config/services/next`
3. Set the revalidation URL to `https://YOUR-NEXTJS-SITE/api/revalidate`
4. Set a revalidation secret (must match `DRUPAL_REVALIDATE_SECRET` env var on the Next.js side)

It is highly suggested that the [Pantheon Advanced Page Cache](https://www.drupal.org/project/pantheon_advanced_page_cache) be installed as well.

### What Drupal Sends

When content is saved, the `next` module sends a webhook:

```
GET /api/revalidate?secret=XXX&tags=node:16,node_list:article
```

- `node:NID` -- entity-specific tag (e.g., `node:16` for node ID 16)
- `node_list:BUNDLE` -- listing tag (e.g., `node_list:article` for article listings)

### Optional: Authentication

For accessing unpublished content or restricted fields, configure a consumer at `/admin/config/services/consumer` and set `DRUPAL_CLIENT_ID` and `DRUPAL_CLIENT_SECRET` on the Next.js side. Then uncomment the auth block in `lib/drupal.ts`.

## Next.js Setup

This assumes you have set up a NextJS site on Pantheon, using either Terminus or via the site dashboard. Instructions can be found at the [Pantheon Documentation](https://docs.pantheon.io/nextjs/hello-world-tutorial#site-creation) section for NextJS.

### From Scratch

Install the Next+Drupal starter package. Note - by default it will install with Next 15. This starter package/repo has been upgraded to Next 16 already.

```bash
npx create-next-app -e https://github.com/chapter-three/next-drupal-basic-starter
```

Then follow the [Upgrading from Next.js 15 to 16](#upgrading-from-nextjs-15-to-16) section and the [Pantheon Cache Handler](#pantheon-cache-handler) section.

### Key Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `next` | `^16.1.6` | Framework |
| `next-drupal` | `^2.0.0-beta.2` | Drupal JSON:API client |
| `react` / `react-dom` | `^19.2.4` | React 19 |
| `@pantheon-systems/nextjs-cache-handler` | `^0.4.0` | GCS cache + CDN edge purge |

## Project Structure

```
├── app/
│   ├── layout.tsx                 # Root layout with nav and draft alert
│   ├── page.tsx                   # Homepage (article listing)
│   ├── [...slug]/
│   │   └── page.tsx               # Dynamic routes (articles, pages)
│   └── api/
│       ├── revalidate/route.ts    # Webhook endpoint for Drupal
│       ├── draft/route.ts         # Draft mode enable
│       └── disable-draft/route.ts # Draft mode disable
├── components/
│   ├── drupal/
│   │   ├── Article.tsx            # Full article view
│   │   ├── ArticleTeaser.tsx      # Article card for listings
│   │   └── BasicPage.tsx          # Basic page view
│   ├── misc/
│   │   └── DraftAlert/            # Draft mode banner
│   └── navigation/
│       ├── HeaderNav.tsx          # Site header
│       └── Link.tsx               # Navigation link
├── lib/
│   ├── drupal.ts                  # NextDrupal client instance
│   └── utils.ts                   # Date formatting, absolute URLs
├── cache-handler.mjs              # Pantheon cache handler entry point
├── next.config.mjs                # Next.js config with cache handler
└── .env.local                     # Environment variables
```

### Key Files

**`lib/drupal.ts`** -- NextDrupal client instance:

```typescript
import { NextDrupal } from "next-drupal"

export const drupal = new NextDrupal(process.env.NEXT_PUBLIC_DRUPAL_BASE_URL as string, {
  // auth: { clientId, clientSecret },
  // withAuth: true,
})
```

**`app/page.tsx`** -- Homepage with tagged fetch:

```typescript
export const revalidate = 60

export default async function Home() {
  const nodes = await drupal.getResourceCollection<DrupalNode[]>(
    "node--article",
    {
      params: {
        "filter[status]": 1,
        "fields[node--article]": "title,path,field_image,uid,created,body",
        include: "field_image,uid",
        sort: "-created",
      },
      next: { revalidate: 60, tags: ["node_list:article"] },
    }
  )
  // render nodes...
}
```

**`app/[...slug]/page.tsx`** -- Dynamic routes with entity-specific tags:

```typescript
export const revalidate = 60

async function getNode(slug: string[]) {
  const path = `/${slug.join("/")}`
  const translatedPath = await drupal.translatePath(path)

  const type = translatedPath.jsonapi?.resourceName!
  const uuid = translatedPath.entity.uuid
  const entityId = translatedPath.entity.id

  const resource = await drupal.getResource<DrupalNode>(type, uuid, {
    params,
    next: { revalidate: 60, tags: [`node:${entityId}`, type] },
  })

  return resource
}
```

**`app/api/revalidate/route.ts`** -- Webhook handler:

```typescript
import { revalidatePath, revalidateTag } from "next/cache"

async function handler(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const path = searchParams.get("path")
  const tags = searchParams.get("tags")
  const secret = searchParams.get("secret")

  if (secret !== process.env.DRUPAL_REVALIDATE_SECRET) {
    return new Response("Invalid secret.", { status: 401 })
  }

  if (!path && !tags) {
    return new Response("Missing path or tags.", { status: 400 })
  }

  try {
    path && revalidatePath(path)
    tags?.split(",").forEach((tag) => revalidateTag(tag, "default"))
    return new Response("Revalidated.")
  } catch (error) {
    return new Response((error as Error).message, { status: 500 })
  }
}

export { handler as GET, handler as POST }
```

## Environment Variables 

The following environment variables need to be set on the NextJS site, both in `.env.local` as well as via Pantheon's Terminus Secrets. This can be done via the Dashboard, or through the use of the [Terminus Secrets Manager Plugin](https://github.com/pantheon-systems/terminus-secrets-manager-plugin).

```bash
# Required
NEXT_PUBLIC_DRUPAL_BASE_URL=https://live-your-site.pantheonsite.io
NEXT_IMAGE_DOMAIN=live-your-site.pantheonsite.io

# Authentication (optional -- for accessing unpublished content)
DRUPAL_CLIENT_ID=from /admin/config/services/consumer
DRUPAL_CLIENT_SECRET=from /admin/config/services/consumer

# Required for on-demand revalidation
DRUPAL_REVALIDATE_SECRET=from /admin/config/services/next

```

`CACHE_BUCKET` and `OUTBOUND_PROXY_ENDPOINT` are set automatically on Pantheon infrastructure. `CACHE_DEBUG=true` enables verbose cache handler logging.

## Pantheon Cache Handler

### What it does

Without the cache handler, each Next.js server instance has its own local file cache, and the Pantheon CDN edge cache is not actively cleared on content updates. Pages only refresh when the ISR timer (60s) expires.

With the cache handler:
- Cache is stored in GCS (shared across all server instances)
- CDN edge cache is purged immediately on invalidation via surrogate keys
- Tag-based invalidation from Drupal webhooks deletes specific cache entries and triggers fresh renders

### Implementation

**1. Install the package:**

```bash
npm install @pantheon-systems/nextjs-cache-handler
```

**2. Create `cache-handler.mjs` in the project root:**

```javascript
import { createCacheHandler } from "@pantheon-systems/nextjs-cache-handler";

const CacheHandler = createCacheHandler({ type: "auto" });

export default CacheHandler;
```

`auto` selects GCS when `CACHE_BUCKET` exists (Pantheon production/multidev), file-based otherwise (local dev).

**3. Update `next.config.mjs`:**

```javascript
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
        protocol: "https",
        hostname: process.env.NEXT_IMAGE_DOMAIN,
        pathname: "/sites/default/files/**",
      },
    ] : [],
  },
};

export default nextConfig;
```

- `cacheHandler` points to the handler file
- `cacheMaxMemorySize: 0` disables the in-memory LRU cache so all cache operations go through the handler

**4. Add `next: { revalidate, tags }` to all fetch calls.**

This is the critical step. See [Gotchas](#gotchas) for why both `revalidate` and `tags` are required.

### Architecture decision: traditional cacheHandler only

Use `cacheHandler` (singular). Do **not** enable `cacheHandlers` (plural), `cacheComponents`, or the `use cache` directive. The `export const revalidate` route segment config is incompatible with `cacheComponents: true`.

## Cache Invalidation Flow

1. Content is saved in Drupal
2. Drupal's `next` module sends a webhook: `/api/revalidate?secret=XXX&tags=node:16,node_list:article`
3. The revalidate handler calls `revalidateTag("node:16", "default")` and `revalidateTag("node_list:article", "default")`
4. The GCS cache handler looks up each tag in its tag mapping, finds the associated fetch cache entries, and deletes them
5. The edge cache handler purges the surrogate keys from the CDN
6. The next request hits origin -- the route cache entry is served (stale-while-revalidate) while a background regeneration fetches fresh data from Drupal
7. The new page is stored in GCS route cache, new fetch cache entries are created with tag mappings restored, and the CDN edge cache for those paths is cleared
8. Subsequent requests get the fresh page

## Tag Convention

Tags in Next.js fetch calls must match what Drupal sends in its webhook.

| Page | Next.js tags | Drupal webhook sends |
|------|-------------|---------------------|
| Homepage (article listing) | `node_list:article` | `tags=node_list:article` |
| Individual article (node 16) | `node:16`, `node--article` | `tags=node:16` |
| Individual basic page (node 5) | `node:5`, `node--page` | `tags=node:5` |

- `node:NID` enables per-entity invalidation (only the changed node's page is purged)
- `node--article` / `node--page` enables bundle-wide invalidation (all articles or all pages)
- `node_list:article` invalidates collection pages (homepage listing)

The `next-drupal` library passes the `next` option through to the native `fetch()` call via `JsonApiWithNextFetchOptions`, so tags set on `getResource()` and `getResourceCollection()` are forwarded correctly.

## Upgrading from Next.js 15 to 16

If starting from the basic starter (which ships with Next.js 15), these changes are required:

### 1. package.json

Add ESM module type:

```json
"type": "module"
```

Bump dependencies:

| Package | Next 15 | Next 16 |
|---------|---------|---------|
| `next` | `^15.1.2` | `^16.1.6` |
| `react` | `^19.0.0` | `^19.2.4` |
| `react-dom` | `^19.0.0` | `^19.2.4` |
| `@types/react` | `^19.0.0` | `^19.2.14` |
| `@types/react-dom` | `^19.0.0` | `^19.2.3` |
| `eslint` | `^8.57.0` | `^9.39.2` |
| `eslint-config-next` | `^15.0.4` | `^16.1.6` |

Add an override so `next-drupal` uses the installed Next.js version instead of its own peer dependency:

```json
"overrides": {
  "next-drupal": {
    "next": "$next"
  }
}
```

### 2. next.config.js -> next.config.mjs

Rename from `.js` to `.mjs` and switch from CommonJS to ESM:

```diff
- module.exports = nextConfig
+ export default nextConfig
```

### 3. postcss.config.js -> postcss.config.cjs

Rename to `.cjs` because `"type": "module"` in package.json makes `.js` files ESM by default. PostCSS config uses `module.exports`, so it needs the explicit `.cjs` extension.

### 4. app/api/revalidate/route.ts

`revalidateTag` requires a second argument in Next.js 16 -- the cache life profile name:

```diff
- revalidateTag(tag)
+ revalidateTag(tag, "default")
```

### What stays the same

- `export const revalidate = 60` on route segments works identically
- `revalidatePath()` signature is unchanged
- `generateStaticParams()` works identically
- `next-drupal` client methods (`translatePath`, `getResource`, `getResourceCollection`, `getResourceCollectionPathSegments`) all work without changes
- Tailwind, PostCSS, and TypeScript configs are functionally unchanged

## Verifying Cache Behavior

Example log entries are below.

### Build output

`npm run build` should show tag mapping operations:

```
[FileCacheHandler] Updated tags mapping for 46cd28a... with tags: [ 'node_list:article' ]
[FileCacheHandler] Updated tags mapping for f37e424... with tags: [ 'node:16', 'node--article' ]
```

### Runtime logs on Pantheon

After saving content in Drupal, runtime logs should show:

```
[GcsCacheHandler] REVALIDATE TAG: node_list:article
[GcsCacheHandler] Found 1 cache entries for tag: node_list:article
[GcsCacheHandler] Deleted fetch cache entry: 46cd28a4...
[GcsCacheHandler] Revalidated 1 entries for tags: node_list:article
[EdgeCacheClear] Background key clear for tag revalidation: node_list:article: 1 keys cleared
```

If you see `No cache entries found for tag`, the fetch-level caching is not configured correctly. See [Gotchas](#gotchas).

### Response headers

```bash
curl -I -H "Pantheon-Debug:1" https://YOUR-SITE.pantheonsite.io/
```

Confirm:
- `surrogate-key-raw` includes your tags (e.g., `node_list:article`)
- `x-next-cache-tags` includes your tags
- `age: 0` after invalidation (fresh from origin)
- `x-cache: MISS` after invalidation (not served from CDN cache)

### Manual invalidation test

```bash
curl "https://YOUR-SITE.pantheonsite.io/api/revalidate?secret=YOUR_SECRET&tags=node_list:article"
```

Should return `Revalidated.`

## Gotchas

### Fetch caching in Next.js 16

The most common pitfall. In Next.js 16, `fetch()` defaults to `no-store`. You must set **both** `revalidate` and `tags` in the `next` option on every fetch call:

```typescript
next: { revalidate: 60, tags: ["node_list:article"] }
```

Without `revalidate`, the fetch response is never stored in the cache handler, no tag-to-entry mappings are created in GCS, and `revalidateTag` finds 0 entries to invalidate. The runtime logs will show:

```
[GcsCacheHandler] No cache entries found for tag: node_list:article
[GcsCacheHandler] Revalidated 0 entries for tags: node_list:article
```

The `export const revalidate = 60` route segment config controls the ISR timer for the rendered page. It does **not** enable fetch-level caching.

### Tag alignment between Drupal and Next.js

Tags in Next.js fetch calls must exactly match what Drupal sends in its webhook. The Drupal `next` module sends `node:NID` (e.g., `node:16`), not `node--article`. Use `translatedPath.entity.id` to get the numeric entity ID for tagging.

### Stale-while-revalidate behavior

After tag invalidation, the first request serves the stale page while regenerating in the background. The fresh page is available on the second request. This is standard ISR behavior. The `cache-control` header includes `stale-while-revalidate=31535940` (1 year), allowing the CDN to serve stale content during regeneration.

### Cache entry lifecycle

Tag mappings in GCS only exist after a fetch cache entry has been SET at runtime. After a fresh deploy, pages need to be visited at least once to create the fetch cache entries and their tag mappings. Until then, `revalidateTag` will find 0 entries for those tags.

## Documentation

- [next-drupal.org](https://next-drupal.org) -- next-drupal library docs
- [@pantheon-systems/nextjs-cache-handler](https://www.npmjs.com/package/@pantheon-systems/nextjs-cache-handler) -- Pantheon cache handler package
- [Next.js Caching](https://nextjs.org/docs/app/building-your-application/caching) -- Next.js caching documentation
