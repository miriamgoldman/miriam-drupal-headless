import { revalidatePath, revalidateTag } from "next/cache"
import { NextRequest, NextResponse } from "next/server"

const REVALIDATE_SECRET = process.env.DRUPAL_REVALIDATE_SECRET

function validateSecret(
  request: NextRequest,
  bodySecret?: string
): boolean {
  if (!REVALIDATE_SECRET) {
    console.warn("[Revalidate] DRUPAL_REVALIDATE_SECRET not set — rejecting")
    return false
  }

  const headerSecret = request.headers.get("X-Webhook-Secret")
  if (headerSecret === REVALIDATE_SECRET) return true

  const querySecret = request.nextUrl.searchParams.get("secret")
  if (querySecret === REVALIDATE_SECRET) return true

  if (bodySecret === REVALIDATE_SECRET) return true

  return false
}

/**
 * GET /api/revalidate
 *
 * Drupal module compatibility — accepts query params:
 *   ?secret=<SECRET>&tags=tag1,tag2&path=/some/path
 */
export async function GET(request: NextRequest) {
  if (!validateSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const searchParams = request.nextUrl.searchParams
  const path = searchParams.get("path")
  const tags = searchParams.get("tags")

  if (!path && !tags) {
    return NextResponse.json(
      { error: "Missing path or tags" },
      { status: 400 }
    )
  }

  try {
    path && revalidatePath(path)

    const results: { key: string; status: string }[] = []
    tags?.split(",").forEach((tag) => {
      const key = tag.trim()
      revalidateTag(key, { expire: 0 })
      results.push({ key, status: "success" })
    })

    return NextResponse.json(
      {
        message: `Revalidated ${results.length} cache tag(s)`,
        revalidated_at: new Date().toISOString(),
        path: path || null,
        results,
      },
      {
        headers: {
          "Cache-Control":
            "private, no-cache, no-store, max-age=0, must-revalidate",
        },
      }
    )
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    )
  }
}

/**
 * POST /api/revalidate
 *
 * Accepts JSON body with either:
 *   - { surrogate_keys: [...], secret: "..." }  (starter format)
 *   - { tags: "tag1,tag2", path: "/...", secret: "..." }  (Drupal format)
 *
 * Secret can also be passed via X-Webhook-Secret header.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { secret, surrogate_keys, tags, path } = body

    if (!validateSecret(request, secret)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    let keys: string[] = []
    if (Array.isArray(surrogate_keys)) {
      keys = surrogate_keys
    } else if (tags) {
      keys = Array.isArray(tags)
        ? tags
        : tags.split(",").map((t: string) => t.trim())
    }

    if (!path && keys.length === 0) {
      return NextResponse.json(
        { error: "Missing path, tags, or surrogate_keys" },
        { status: 400 }
      )
    }

    path && revalidatePath(path)

    const results: { key: string; status: string; message?: string }[] = []
    for (const key of keys) {
      try {
        revalidateTag(key, { expire: 0 })
        results.push({ key, status: "success" })
      } catch (error) {
        results.push({ key, status: "error", message: String(error) })
      }
    }

    return NextResponse.json(
      {
        message: `Revalidated ${results.length} cache tag(s)`,
        revalidated_at: new Date().toISOString(),
        path: path || null,
        results,
      },
      {
        headers: {
          "Cache-Control":
            "private, no-cache, no-store, max-age=0, must-revalidate",
        },
      }
    )
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to process request", message: String(error) },
      { status: 500 }
    )
  }
}
