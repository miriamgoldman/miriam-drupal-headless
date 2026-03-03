# Next.js 16 Full Compliance Upgrade Plan

## Context

The application is in a **partially upgraded state** with version mismatches causing dependency warnings:

**Current Situation:**
- Next.js 16.1.6 is **actually installed** (via cache handler dependency)
- package.json still declares Next.js 15.1.2 → Creating "invalid" dependency warnings
- React 19.2.4 installed but package.json shows 19.0.0
- ESLint 9.39.2 installed but package.json shows 8.57.0
- Pantheon cache handler 0.2.0 installed, but 0.4.0 is available (2 versions behind)

**Why This Happened:**
The `@pantheon-systems/nextjs-cache-handler@0.2.0` package has `next@16.1.6` as a dependency, which pulled in Next.js 16 automatically. However, the root package.json was never updated to reflect this change.

**Why This Matters:**
1. npm shows "invalid" dependency warnings on every install
2. Missing out on 2 versions of cache handler improvements (0.3.0, 0.4.0)
3. Using deprecated Next.js 15 patterns (revalidateTag signature)
4. The existing upgrade documentation suggests changes that were never applied

**Critical Discovery:**
Pantheon cache handler 0.4.0 **removed all middleware exports** (breaking change). The current middleware.ts imports from a path that won't exist after upgrading the cache handler, so it must be deleted. Edge cache clearing is now built into the handlers automatically.

---

## Breaking Changes to Address

### 1. Package Version Mismatches
**Issue:** package.json doesn't match installed versions
**Fix:** Update package.json to declare Next.js 16.1.6, React 19.2.4, ESLint 9.39.2
**Impact:** Removes dependency warnings, enables proper version management

### 2. revalidateTag Signature (Next.js 16)
**Issue:** Missing required second parameter
**File:** `app/api/revalidate/route.ts:22`
**Current:** `revalidateTag(tag)`
**Required:** `revalidateTag(tag, 'max')`
**Impact:** Drupal revalidation webhook will fail without this fix

### 3. Middleware Removal (Cache Handler 0.4.0)
**Issue:** Middleware exports removed from package
**File:** `middleware.ts` imports from non-existent path
**Fix:** Delete middleware.ts entirely
**Rationale:** Edge cache clearing now built into handlers (no middleware needed)
**Impact:** Application will fail to build if middleware.ts remains after upgrading cache handler

---

## Implementation Steps

### Step 1: Update package.json
Update dependencies to match installed versions:

```json
{
  "dependencies": {
    "@pantheon-systems/nextjs-cache-handler": "^0.4.0",
    "next": "^16.1.6",
    "react": "^19.2.4",
    "react-dom": "^19.2.4"
  },
  "devDependencies": {
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "eslint": "^9.39.2",
    "eslint-config-next": "^16.1.6"
  }
}
```

**Why ranges (^) instead of exact versions:**
- Allows automatic patch updates (16.1.6 → 16.1.7)
- Gets security fixes automatically
- package-lock.json ensures reproducibility
- Standard practice for Next.js projects

### Step 2: Fix revalidateTag Signature
Update `app/api/revalidate/route.ts` line 22:

**From:**
```typescript
tags?.split(",").forEach((tag) => revalidateTag(tag))
```

**To:**
```typescript
tags?.split(",").forEach((tag) => revalidateTag(tag, 'max'))
```

**What 'max' means:**
- Uses stale-while-revalidate (SWR) behavior
- Serves cached content immediately while fetching fresh data in background
- Provides optimal user experience (no waiting for revalidation)
- Aligns with existing 60-second ISR pattern

### Step 3: Delete middleware.ts
Remove the file entirely:

```bash
rm middleware.ts
```

**Why this is safe:**
1. Cache handler 0.4.0 no longer exports middleware utilities
2. Edge cache clearing now built into handlers automatically
3. The existing middleware had timing issues (documented in architecture analysis)
4. Surrogate-Key headers showed fallback values, not actual cache tags
5. Application currently works without functional middleware

### Step 4: Reinstall Dependencies
Clean install to resolve dependency tree:

```bash
rm -rf node_modules package-lock.json
npm install
```

### Step 5: Verify Build
Test that everything compiles:

```bash
npm run build
```

Expected output:
- ✓ Compiled successfully
- ✓ Generating static pages
- Build time: ~4.8 seconds
- No errors or warnings

---

## Critical Files Modified

1. **package.json** - Version synchronization
2. **app/api/revalidate/route.ts** - Fix revalidateTag signature (line 22)
3. **middleware.ts** - DELETE (no longer compatible)

## Files Verified Compatible (No Changes)

- ✅ cacheHandler.ts - Compatible with 0.4.0 as-is
- ✅ next.config.mjs - No changes needed
- ✅ app/page.tsx - Already uses async APIs correctly
- ✅ app/[...slug]/page.tsx - Already uses async APIs correctly

---

## Testing Strategy

### Build Test
```bash
npm run build
```

Success criteria:
- Build completes without errors
- All pages generate successfully
- TypeScript compilation passes
- No dependency warnings

### Dev Server Test
```bash
npm run dev
```

Success criteria:
- Server starts in <500ms
- Homepage loads at http://localhost:3000
- Article pages load correctly
- No console errors

### Cache Functionality Test
```bash
# Start production build
npm run build && npm run start

# Test revalidation endpoint
curl "http://localhost:3000/api/revalidate?secret=YOUR_SECRET&tags=test"
# Expected: "Revalidated."

# Test with multiple tags
curl "http://localhost:3000/api/revalidate?secret=YOUR_SECRET&tags=node_list:article,node--article"
# Expected: "Revalidated."

# Test path revalidation
curl "http://localhost:3000/api/revalidate?secret=YOUR_SECRET&path=/"
# Expected: "Revalidated."
```

### Drupal Integration Test
1. Edit an article in Drupal
2. Save/publish the article
3. Check Next.js logs for revalidation webhook
4. Verify content updates on site (may take up to 60 seconds)

Expected log output:
```
GET /api/revalidate?secret=***&tags=node_list:article,node--article:123
Revalidated.
```

---

## Known Limitations

### Cache Behavior After Upgrade

**What Works:**
- ✅ Next.js origin cache revalidation (revalidateTag clears cache)
- ✅ ISR with 60-second revalidation window
- ✅ Drupal webhook integration
- ✅ Tag-based invalidation

**Unknown (Needs Testing After Upgrade):**
- ❓ Instant CDN edge cache clearing (may now work in 0.4.0)
- ❓ Surrogate-Key headers (middleware approach removed)

**Testing on Pantheon:**
After deploying to Pantheon, test if edge cache clearing now works instantly:
1. Trigger revalidateTag via Drupal edit
2. Check if content updates in 0-2 seconds (instant CDN purge)
3. Or if it takes ~60 seconds (ISR fallback)

The Feb 17 architecture analysis documented that 0.2.0 lacked edge cache clearing for Server Components. Version 0.4.0 may have fixed this (requires testing on Pantheon platform).

---

## Risks and Mitigation

### Risk 1: Middleware Removal Breaks Functionality
**Likelihood:** Low
**Impact:** High
**Mitigation:** The middleware was never functioning correctly (timing issues documented in architecture analysis). Edge cache clearing is now handled internally by cache handlers.
**Rollback:** Reinstall 0.2.0, restore middleware.ts from git

### Risk 2: revalidateTag Signature Breaks Drupal Integration
**Likelihood:** Low
**Impact:** High
**Mitigation:** The 'max' profile enables SWR behavior (recommended by Next.js). Test thoroughly with Drupal webhooks.
**Rollback:** Remove second parameter if issues arise

### Risk 3: Cache Handler 0.4.0 Has Regressions
**Likelihood:** Low
**Impact:** Medium
**Mitigation:** Test locally before deploying to production. Deploy to Pantheon multidev first.
**Rollback:** Downgrade to 0.2.0 in package.json, restore middleware.ts

### Risk 4: Build Fails After Upgrade
**Likelihood:** Low
**Impact:** High
**Mitigation:** Follow steps exactly, test build after each change.
**Rollback:** `git reset --hard HEAD` to restore previous state

---

## Success Criteria

### Must Pass (Blocking)
- [ ] npm install completes without "invalid" dependency warnings
- [ ] Build completes successfully (npm run build)
- [ ] All TypeScript compilation passes
- [ ] Dev server starts without errors
- [ ] Homepage renders correctly
- [ ] Dynamic article pages render correctly
- [ ] Revalidation API endpoint responds correctly
- [ ] Drupal webhook triggers revalidation

### Should Pass (Important)
- [ ] Build time remains ~4.8 seconds (Next.js 16 performance)
- [ ] No new console errors or warnings
- [ ] Cache hit/miss behavior works as expected
- [ ] Environment variables still work (no new requirements)

### Nice to Have (Test After Deployment)
- [ ] Instant CDN edge cache clearing works (vs 60-second ISR)
- [ ] Improved cache handler performance
- [ ] Better debug logging from 0.4.0

---

## Rollback Plan

If issues arise after upgrade:

### Quick Rollback (Revert Commit)
```bash
git revert HEAD
npm install
npm run build
```

### Manual Rollback (Restore Specific Files)
```bash
# Restore package files
git checkout HEAD~1 package.json package-lock.json

# Restore middleware
git checkout HEAD~1 middleware.ts

# Restore revalidate route
git checkout HEAD~1 app/api/revalidate/route.ts

# Reinstall
rm -rf node_modules
npm install

# Test
npm run build
```

### Pantheon Rollback
```bash
# Revert the merge commit
git revert <commit-hash>
git push pantheon main

# Or roll back to previous commit
git reset --hard HEAD~1
git push pantheon main --force  # Use with caution
```

---

## Post-Upgrade Actions

### Immediate (After Local Testing)
1. Create git commit with clear message documenting changes
2. Deploy to Pantheon multidev environment for testing
3. Test on Pantheon infrastructure (edge cache clearing, build times)
4. Monitor logs for any unexpected behavior

### Short-Term (1 week)
1. Update project documentation to reflect Next.js 16 compliance
2. Document actual cache behavior on Pantheon (instant vs 60s)
3. Notify team of revalidateTag signature change
4. Update any runbooks or deployment guides

### Medium-Term (1 month)
1. Test 'use cache' directive in separate experiment branch
2. Evaluate if 0.4.0 fixed build timeout issues with external APIs
3. Consider migrating from unstable_cache to 'use cache' if stable
4. Monitor Next.js 16.2.0 release for new features

---

## Additional Notes

### Why Not Rename middleware.ts to proxy.ts?
Next.js 16 deprecated middleware.ts in favor of proxy.ts, but middleware.ts still works. However, since the cache handler no longer provides middleware exports, the entire file must be deleted anyway. If custom middleware is needed later (for auth, redirects, etc.), create proxy.ts with custom logic only.

### Why Upgrade Cache Handler to 0.4.0?
- Removes 2 versions of technical debt (skipping 0.3.0 and 0.4.0)
- May fix edge cache clearing for Server Components
- Gets latest bug fixes and improvements
- Required for future 'use cache' directive experimentation
- Simplifies architecture (middleware removal)

### Why Use 'max' Profile for revalidateTag?
Next.js 16 offers several cache profiles:
- 'max' - Stale-while-revalidate (recommended for UX)
- 'hours' - Cache for hours
- 'days' - Cache for days
- Custom object - Fine-grained control

The 'max' profile serves cached content immediately while revalidating in the background, providing the best user experience. This aligns with the existing 60-second ISR pattern.

---

## Environment Variables

No changes required to environment variables:

**Required (Pantheon Auto-Provides):**
- CACHE_BUCKET
- OUTBOUND_PROXY_ENDPOINT

**Required (User Provides):**
- NEXT_PUBLIC_DRUPAL_BASE_URL
- NEXT_IMAGE_DOMAIN
- DRUPAL_REVALIDATE_SECRET

**Optional:**
- CACHE_DEBUG (set to 'true' or '1' for debug logging)

All existing environment variables remain compatible with the upgrade.
