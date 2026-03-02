# Migrating from `unstable_cache` to `'use cache'` in Next.js 16

## Overview

This documents migrating the Next.js + Drupal starter from `unstable_cache` (deprecated) to the `'use cache'` directive introduced in Next.js 16. The migration removes time-based ISR fallbacks and relies entirely on webhook-driven tag invalidation via the Pantheon Cache Handler.

## Prerequisites

- Next.js 16+
- `@pantheon-systems/nextjs-cache-handler` v0.4.0+ (provides `createCacheHandler` and `createUseCacheHandler`)

## Configuration

Add `cacheComponents: true` to `next.config.mjs` with both cache handlers:

```js
const nextConfig = {
  cacheComponents: true,

  // Traditional cache handler (ISR, routes, fetch cache)
  cacheHandler: path.resolve(__dirname, "./cache-handler.mjs"),

  // Next.js 16 'use cache' directive handler
  cacheHandlers: {
    default: path.resolve(__dirname, "./use-cache-handler.mjs"),
  },

  cacheMaxMemorySize: 0,

  transpilePackages: ['@pantheon-systems/nextjs-cache-handler'],
};
```

`cacheComponents: true` enables the `'use cache'` directive and switches Next.js to runtime-first rendering. Pages are dynamic by default unless explicitly cached.

### use-cache-handler.mjs Setup

The `use-cache-handler.mjs` file must export a **pre-instantiated handler object** with bound methods, NOT the class itself. Exporting the class causes 60-second prerender timeouts on pages using `generateStaticParams`.

```js
// use-cache-handler.mjs -- CORRECT
import { createUseCacheHandler } from '@pantheon-systems/nextjs-cache-handler';

globalThis.__pantheonSurrogateKeyTags = globalThis.__pantheonSurrogateKeyTags || [];

const UseCacheHandlerClass = createUseCacheHandler({ type: 'auto' });
const handler = new UseCacheHandlerClass();

export default {
  get: handler.get.bind(handler),
  set: handler.set.bind(handler),
  refreshTags: handler.refreshTags.bind(handler),
  getExpiration: handler.getExpiration.bind(handler),
  updateTags: handler.updateTags.bind(handler),
};
```

**Do not** export the class directly:

```js
// WRONG -- causes build timeouts
const UseCacheHandler = createUseCacheHandler({ type: 'auto' });
export default UseCacheHandler;
```

Also note: import from the main package entry (`@pantheon-systems/nextjs-cache-handler`), not the `/use-cache` subpath, and include the package in `transpilePackages`.

## Data Fetching Pattern

### Before (`unstable_cache`)

```ts
import { unstable_cache } from "next/cache"

export const revalidate = 60

const getArticles = unstable_cache(
  async () => {
    return await drupal.getResourceCollection<DrupalNode[]>("node--article", { ... })
  },
  ["homepage-articles"],
  { tags: ["node_list:article", "node--article"], revalidate: 60 }
)
```

### After (`'use cache'`)

```ts
import { cacheTag, cacheLife } from "next/cache"

async function getArticles() {
  "use cache"
  cacheTag("node_list:article", "node--article")
  cacheLife("max")

  return await drupal.getResourceCollection<DrupalNode[]>("node--article", { ... })
}
```

Key differences:
- `'use cache'` is a directive at the top of the function body
- `cacheTag()` and `cacheLife()` are called inside the cached function
- No manual cache key array needed -- Next.js generates keys from build ID and function signature
- Arguments to the function become part of the cache key automatically
- No time-based `revalidate` -- invalidation is tag-driven via webhooks

## Dynamic Cache Tagging

For pages where cache tags depend on runtime data (e.g., which entity was resolved from a slug), call `cacheTag()` after resolving the data:

```ts
async function getNode(slug: string[]) {
  "use cache"
  cacheLife("max")

  const translatedPath = await drupal.translatePath(`/${slug.join("/")}`)
  const type = translatedPath.jsonapi?.resourceName!
  const uuid = translatedPath.entity.uuid

  // Tags applied dynamically based on resolved entity
  cacheTag(
    `${translatedPath.entity.type}:${translatedPath.entity.id}`,
    type,
    `node:${uuid}`
  )

  return await drupal.getResource<DrupalNode>(type, uuid, { params })
}
```

The entire function (including `translatePath`) is inside the cache boundary. The `slug` argument is automatically part of the cache key, so different slugs get separate cache entries.

## Revalidation

The `/api/revalidate` endpoint no longer needs a special case for the homepage. With `unstable_cache`, the homepage route cache was separate from the data cache, so updating articles required both `revalidateTag("node--article")` AND `revalidatePath("/")`. With `'use cache'`, the homepage's `getArticles()` is tagged with `"node_list:article"` and `"node--article"`, so `revalidateTag("node--article")` invalidates the data directly.

```ts
// Before: needed explicit homepage invalidation
if (tags?.includes("node_list:article") || tags?.includes("node--article")) {
  revalidatePath("/")
}

// After: removed -- tag revalidation handles it
```

## What Was Removed

- `export const revalidate = 60` from all pages (no more time-based ISR)
- `unstable_cache` wrapper functions
- `revalidatePath("/")` homepage special case in the revalidation endpoint
- Manual cache key arrays

## Cache Profiles

`cacheLife("max")` uses the built-in Next.js profile for long-lived cache entries. Custom profiles can be defined in `next.config.mjs`:

```js
cacheLife: {
  custom: { stale: 300, revalidate: 900, expire: 86400 },
}
```
