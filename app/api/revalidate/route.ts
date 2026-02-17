import { revalidatePath, revalidateTag } from "next/cache"
import type { NextRequest } from "next/server"

async function handler(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const path = searchParams.get("path")
  const tags = searchParams.get("tags")
  const secret = searchParams.get("secret")

  // Validate secret.
  if (secret !== process.env.DRUPAL_REVALIDATE_SECRET) {
    return new Response("Invalid secret.", { status: 401 })
  }

  // Either tags or path must be provided.
  if (!path && !tags) {
    return new Response("Missing path or tags.", { status: 400 })
  }

  try {
    if (path) {
      revalidatePath(path)
    }

    if (tags) {
      tags.split(",").forEach((tag) => {
        // Next.js 16: revalidateTag takes optional second parameter for cacheLife profile
        // 'default' provides stale-while-revalidate behavior
        revalidateTag(tag, 'default')
      })
    }

    return new Response("Revalidated.")
  } catch (error) {
    return new Response((error as Error).message, { status: 500 })
  }
}

export { handler as GET, handler as POST }
