import { cacheTag, cacheLife } from "next/cache"
import { drupal } from "@/lib/drupal"
import { Link } from "@/components/navigation/Link"
import type { DrupalNode } from "next-drupal"
import type { Metadata } from "next"

export const metadata: Metadata = {
  description: "A Next.js site powered by a Drupal backend.",
}

async function getHomepageNode(): Promise<DrupalNode | null> {
  "use cache"
  cacheTag("homepage")
  cacheLife({ stale: Infinity, revalidate: Infinity, expire: Infinity })

  try {
    const translatedPath = await drupal.translatePath("/")

    if (!translatedPath?.jsonapi?.resourceName || !translatedPath?.entity?.uuid) {
      return null
    }

    const type = translatedPath.jsonapi.resourceName
    const uuid = translatedPath.entity.uuid
    const entityId = translatedPath.entity.id

    cacheTag(`node:${entityId}`)

    const node = await drupal.getResource<DrupalNode>(type, uuid, {})
    return node || null
  } catch (error) {
    console.error("Failed to fetch homepage node:", error)
    return null
  }
}

export default async function Home() {
  const node = await getHomepageNode()

  return (
    <div className="py-10">
      {node ? (
        <>
          <h1 className="mb-6 text-6xl font-black">{node.title}</h1>
          {node.body?.processed && (
            <div
              dangerouslySetInnerHTML={{ __html: node.body.processed }}
              className="mb-10 text-xl text-gray-600"
            />
          )}
        </>
      ) : (
        <>
          <h1 className="mb-6 text-6xl font-black">Next.js for Drupal</h1>
          <p className="mb-10 text-xl text-gray-600">
            A headless Drupal site built with Next.js, hosted on Pantheon.
          </p>
        </>
      )}
      <Link
        href="/blog"
        className="inline-block px-8 py-4 text-lg font-semibold text-white no-underline bg-blue-600 rounded-md hover:bg-blue-700"
      >
        Read the Blog
      </Link>
    </div>
  )
}
