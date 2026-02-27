# Pantheon Cache Handler Implementation Plan for Next.js 16

## Overview

Implement Pantheon's Next.js cache handler (version 0.4.0) with proper Next.js 16 support, including both traditional caching (`unstable_cache`) and the new `use cache` directive.

## Key Changes from Previous Implementation

The 0.4.0 version has **breaking changes**:
- ❌ **Removed middleware exports** - No more `middleware.ts` file needed
- ✅ **Built-in edge cache clearing** - Automatic CDN invalidation via handlers
- ✅ **Next.js 16 `use cache` support** - New `createUseCacheHandler()` factory
- ✅ **Dual handler configuration** - `cacheHandler` + `cacheHandlers` for Next.js 16

## Prerequisites

Current state (confirmed):
- ✅ Next.js 16.1.6 installed
- ✅ React 19.2.4 installed
- ✅ No cache handler currently installed
- ✅ Using CJS (`next.config.js`)
- ✅ Build working correctly

## Implementation Steps

### Step 1: Install Cache Handler

```bash
npm install @pantheon-systems/nextjs-cache-handler@^0.4.0
```

### Step 2: Create Handler Files (ESM)

Create **two** cache handler files as ESM modules:

#### `cache-handler.mjs` (Traditional ISR/fetch caching)

```javascript
// cache-handler.mjs
import { createCacheHandler } from '@pantheon-systems/nextjs-cache-handler';

const CacheHandler = createCacheHandler({
  type: 'auto', // Auto-detect: GCS if CACHE_BUCKET exists, else file-based
});

export default CacheHandler;
```

#### `use-cache-handler.mjs` (Next.js 16 `use cache` directive)

```javascript
// use-cache-handler.mjs
import { createUseCacheHandler } from '@pantheon-systems/nextjs-cache-handler/use-cache';

const UseCacheHandler = createUseCacheHandler({
  type: 'auto', // Auto-detect: GCS if CACHE_BUCKET exists, else file-based
});

export default UseCacheHandler;
```

**Why .mjs?** The cache handler package uses ESM imports internally, so handlers must be ESM modules even if the main Next.js config is CJS.

### Step 3: Convert Next.js Config to ESM

Since cache handlers are ESM, the Next.js config must be ESM as well.

Convert `next.config.js` → `next.config.mjs`:

```javascript
// next.config.mjs
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Traditional cache handler (ISR, routes, fetch cache)
  cacheHandler: path.resolve(__dirname, "./cache-handler.mjs"),

  // Next.js 16 'use cache' directive handler
  cacheHandlers: {
    default: path.resolve(__dirname, "./use-cache-handler.mjs"),
  },

  cacheMaxMemorySize: 0, // Disable in-memory caching to use custom handler
  cacheComponents: true, // Enable component-level caching (Next.js 16)

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
```

### Step 4: Add ESM to package.json

```json
{
  "name": "basic-starter",
  "version": "2.0.0",
  "type": "module",
  "private": true,
  "license": "MIT"
}
```

### Step 5: Update Data Fetching with unstable_cache

Wrap Drupal API calls with `unstable_cache` for tag-based invalidation:

#### `app/page.tsx` (Homepage)

```typescript
import { unstable_cache } from "next/cache"
import { ArticleTeaser } from "@/components/drupal/ArticleTeaser"
import { drupal } from "@/lib/drupal"
import type { Metadata } from "next"
import type { DrupalNode } from "next-drupal"

export const metadata: Metadata = {
  description: "A Next.js site powered by a Drupal backend.",
}

export const revalidate = 60

const getArticles = unstable_cache(
  async () => {
    return await drupal.getResourceCollection<DrupalNode[]>(
      "node--article",
      {
        params: {
          "filter[status]": 1,
          sort: "-created",
        },
      }
    )
  },
  ["homepage-articles"],
  {
    tags: ["node_list:article", "node--article"],
    revalidate: 60,
  }
)

export default async function Home() {
  const nodes = await getArticles()

  return (
    <>
      <h1 className="mb-10 text-6xl font-black">Latest Articles.</h1>
      {nodes?.length ? (
        nodes.map((node) => (
          <div key={node.id}>
            <ArticleTeaser node={node} />
            <hr className="my-20" />
          </div>
        ))
      ) : (
        <p className="py-4">No nodes found</p>
      )}
    </>
  )
}
```

#### `app/[...slug]/page.tsx` (Dynamic Pages)

```typescript
import { notFound } from "next/navigation"
import { unstable_cache } from "next/cache"
import { Article } from "@/components/drupal/Article"
import { BasicPage } from "@/components/drupal/BasicPage"
import { drupal } from "@/lib/drupal"
import type { Metadata, ResolvingMetadata } from "next"
import type { DrupalNode, JsonApiParams } from "next-drupal"

async function getNode(slug: string[]) {
  const path = `/${slug.join("/")}`

  const params: JsonApiParams = {}

  // Translating the path also allows us to discover the entity type.
  const translatedPath = await drupal.translatePath(path)

  if (!translatedPath) {
    throw new Error("Resource not found", { cause: "NotFound" })
  }

  const type = translatedPath.jsonapi?.resourceName!
  const uuid = translatedPath.entity.uuid
  const cacheTag = `${translatedPath.entity.type}:${translatedPath.entity.id}`

  if (type === "node--article") {
    params.include = "field_image,uid"
  }

  // Use unstable_cache to cache the resource with tags for granular revalidation
  const getCachedResource = unstable_cache(
    async () => {
      const resource = await drupal.getResource<DrupalNode>(type, uuid, {
        params,
      })

      if (!resource) {
        throw new Error(
          `Failed to fetch resource: ${translatedPath?.jsonapi?.individual}`,
          {
            cause: "DrupalError",
          }
        )
      }

      return resource
    },
    [`node-${uuid}`],
    {
      tags: [cacheTag, type, `node:${uuid}`],
      revalidate: 60,
    }
  )

  return getCachedResource()
}

type NodePageParams = {
  slug: string[]
}
type NodePageProps = {
  params: Promise<NodePageParams>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export async function generateMetadata(
  props: NodePageProps,
  parent: ResolvingMetadata
): Promise<Metadata> {
  const params = await props.params

  const { slug } = params

  let node
  try {
    node = await getNode(slug)
  } catch (e) {
    // If we fail to fetch the node, don't return any metadata.
    return {}
  }

  return {
    title: node.title,
  }
}

const RESOURCE_TYPES = ["node--page", "node--article"]

export const revalidate = 60

export async function generateStaticParams(): Promise<NodePageParams[]> {
  const resources = await drupal.getResourceCollectionPathSegments(
    RESOURCE_TYPES,
    {
      // The pathPrefix will be removed from the returned path segments array.
      // pathPrefix: "/blog",
      // The list of locales to return.
      // locales: ["en", "es"],
      // The default locale.
      // defaultLocale: "en",
    }
  )

  return resources.map((resource) => {
    // resources is an array containing objects like: {
    //   path: "/blog/some-category/a-blog-post",
    //   type: "node--article",
    //   locale: "en", // or `undefined` if no `locales` requested.
    //   segments: ["blog", "some-category", "a-blog-post"],
    // }
    return {
      slug: resource.segments,
    }
  })
}

export default async function NodePage(props: NodePageProps) {
  const params = await props.params

  const { slug } = params

  let node
  try {
    node = await getNode(slug)
  } catch (error) {
    // If getNode throws an error, tell Next.js the path is 404.
    notFound()
  }

  // If the resource is not published, return a 404.
  if (node?.status === false) {
    notFound()
  }

  return (
    <>
      {node.type === "node--page" && <BasicPage node={node} />}
      {node.type === "node--article" && <Article node={node} />}
    </>
  )
}
```

### Step 6: Update Revalidation API (Already Correct)

The revalidation API endpoint already uses the correct Next.js 16 signature with the 'max' parameter:

```typescript
// app/api/revalidate/route.ts
tags?.split(",").forEach((tag) => revalidateTag(tag, 'max'))
```

No changes needed here. ✅

### Step 7: Update Environment Variables

Add to `.env.example`:

```bash
# Pantheon Cache Handler Configuration
# CACHE_BUCKET=your-gcs-bucket-name # Required for GCS cache handler (production)
# OUTBOUND_PROXY_ENDPOINT=https://your-edge-proxy.com # Optional: enables edge cache clearing
# CACHE_DEBUG=true # Optional: enables debug logging for cache operations
```

**Note:** On Pantheon, `CACHE_BUCKET` and `OUTBOUND_PROXY_ENDPOINT` are automatically provided. For local development, the handler will use file-based caching (no configuration needed).

### Step 8: Reinstall Dependencies

```bash
rm -rf node_modules package-lock.json
npm install
```

### Step 9: Test Build

```bash
npm run build
```

Expected output:
- ✓ Compiled successfully
- ✓ Generating static pages
- Build completes without errors
- Cache handler logs visible (if `CACHE_DEBUG=true`)

### Step 10: Test Development Server

```bash
CACHE_DEBUG=true npm run dev
```

Visit http://localhost:3000 and verify:
- Homepage loads
- Article pages load
- Cache operations visible in logs

## Cache Handler Behavior

### Auto-Detection

The `type: 'auto'` configuration automatically selects:
- **GCS Handler**: If `CACHE_BUCKET` environment variable is set (Pantheon production)
- **File Handler**: Otherwise (local development)

### Cache Types

1. **Fetch Cache**: Stores data from `fetch()` calls and `unstable_cache()`
2. **Route Cache**: Stores rendered pages (Full Route Cache)

### Tag-Based Invalidation

When Drupal sends a revalidation webhook:

```
GET /api/revalidate?secret=xxx&tags=node_list:article,node--article:123
```

The cache handler:
1. Finds all cache entries with matching tags
2. Invalidates them (O(1) lookup via tag mapping)
3. Clears edge cache on Pantheon (via `OUTBOUND_PROXY_ENDPOINT`)
4. Returns "Revalidated." response

### Edge Cache Clearing

When deployed on Pantheon:
- `OUTBOUND_PROXY_ENDPOINT` is automatically set
- Cache handlers send surrogate key purge requests to the CDN
- Edge cache clears in 0-2 seconds (instant invalidation)
- Runs in background, does not block cache operations

## Testing Strategy

### Local Testing

1. **Build test**:
   ```bash
   npm run build
   ```

2. **Dev server with debug logging**:
   ```bash
   CACHE_DEBUG=true npm run dev
   ```

3. **Test revalidation**:
   ```bash
   curl "http://localhost:3000/api/revalidate?secret=YOUR_SECRET&tags=node--article"
   ```

### Pantheon Testing

1. Deploy to multidev environment
2. Enable debug logging:
   ```bash
   terminus env:set-var mysite.dev CACHE_DEBUG 1
   ```
3. Edit an article in Drupal
4. Verify cache invalidation in Next.js logs
5. Check if content updates instantly (0-2s) vs ISR (60s)

## Success Criteria

### Must Pass

- [ ] Build completes successfully
- [ ] No TypeScript errors
- [ ] Homepage renders correctly
- [ ] Article pages render correctly
- [ ] Revalidation API endpoint works
- [ ] Cache handler loads (visible in debug logs)
- [ ] Drupal webhook triggers revalidation

### Should Pass

- [ ] Cache hits/misses visible in debug logs
- [ ] Tag mapping functioning (visible in debug logs)
- [ ] File-based cache created in `.next/cache/custom/`
- [ ] No performance degradation from caching

### Nice to Have (Pantheon Only)

- [ ] Edge cache clearing works (instant updates)
- [ ] GCS cache handler loads on Pantheon
- [ ] Surrogate keys sent to CDN (visible in response headers)

## Troubleshooting

### Build Fails with ESM Import Errors

**Issue**: `Cannot use import statement outside a module`

**Solution**: Ensure:
- Cache handler files are `.mjs`
- `next.config.mjs` (not `.js`)
- `package.json` has `"type": "module"`

### Cache Not Working

**Issue**: No cache hits in debug logs

**Solution**:
1. Enable debug logging: `CACHE_DEBUG=true`
2. Check cache handler loads: Look for `[FileCacheHandler] Initializing` in logs
3. Verify `cacheHandler` path in `next.config.mjs` is correct
4. Check `.next/cache/custom/` directory exists

### Revalidation Not Working

**Issue**: Drupal webhooks don't invalidate cache

**Solution**:
1. Test revalidation endpoint directly with curl
2. Check `DRUPAL_REVALIDATE_SECRET` matches between Drupal and Next.js
3. Verify tags match between `unstable_cache()` and revalidation webhook
4. Check debug logs for "Revalidated X entries for tags: Y"

### Edge Cache Not Clearing

**Issue**: Content takes 60s to update on Pantheon (ISR fallback)

**Solution**:
1. Verify `OUTBOUND_PROXY_ENDPOINT` is set on Pantheon
2. Check for edge cache clearing logs: `[EdgeCacheClear] Cleared X paths`
3. Confirm surrogate keys in response headers
4. Test directly on Pantheon (not through external proxy)

## Rollback Plan

If issues arise after implementation:

```bash
# Revert to previous state
git checkout HEAD~1 package.json package-lock.json
git checkout HEAD~1 app/page.tsx app/[...slug]/page.tsx
git checkout HEAD~1 next.config.js
rm cache-handler.mjs use-cache-handler.mjs next.config.mjs
npm install
npm run build
```

## Files Modified

1. **New files**:
   - `cache-handler.mjs`
   - `use-cache-handler.mjs`
   - `next.config.mjs`

2. **Modified files**:
   - `package.json` (add dependency + "type": "module")
   - `app/page.tsx` (add `unstable_cache`)
   - `app/[...slug]/page.tsx` (add `unstable_cache`)
   - `.env.example` (document cache env vars)

3. **Deleted files**:
   - `next.config.js` (replaced by `.mjs`)

4. **No middleware needed**: Version 0.4.0 removed middleware exports

## Post-Implementation

### Immediate

1. Monitor build times (should remain ~1.5-2s)
2. Check cache debug logs for proper operation
3. Test Drupal integration end-to-end
4. Document any Pantheon-specific behavior

### Short-Term (1 week)

1. Analyze cache hit rates
2. Verify edge cache clearing performance
3. Document actual cache behavior vs expected
4. Update team documentation

### Medium-Term (1 month)

1. Evaluate `use cache` directive for new components
2. Consider migrating from `unstable_cache` to `use cache`
3. Monitor GCS costs (if applicable)
4. Gather performance metrics

## References

- [Pantheon Cache Handler README](/Users/miriamgoldman/Downloads/README.md)
- [Next.js 16 Caching Documentation](https://nextjs.org/docs/app/building-your-application/caching)
- [Next.js 16 `use cache` Directive](https://nextjs.org/docs/app/api-reference/directives/use-cache)
- Previous implementation analysis: observation #3879-#3883 in claude-mem
