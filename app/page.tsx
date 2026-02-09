import { ArticleTeaser } from "@/components/drupal/ArticleTeaser"
import { drupal } from "@/lib/drupal"
import type { Metadata } from "next"
import type { DrupalNode } from "next-drupal"

export const metadata: Metadata = {
  description: "A Next.js site powered by a Drupal backend.",
}

export const revalidate = 60

export default async function Home() {
  let nodes: DrupalNode[] | null = null
  let error: unknown = null

  try {
    nodes = await drupal.getResourceCollection<DrupalNode[]>(
      "node--article",
      {
        params: {
          "filter[status]": 1,
          sort: "-created",
        },
      }
    )
    console.log("Fetched nodes:", nodes?.length || 0, "articles")
    if (nodes?.length) {
      console.log("First article:", nodes[0].title)
    }
  } catch (e) {
    error = e
    console.error("Error fetching articles:", e)
  }

  return (
    <>
      <h1 className="mb-10 text-6xl font-black">Latest Articles.</h1>
      {error && (
        <div className="py-4 text-red-600">
          <p>Error loading articles: {String(error)}</p>
        </div>
      )}
      {nodes?.length ? (
        nodes.map((node) => (
          <div key={node.id}>
            <ArticleTeaser node={node} />
            <hr className="my-20" />
          </div>
        ))
      ) : (
        <p className="py-4">No nodes found (checked {nodes?.length ?? 'null'} results)</p>
      )}
    </>
  )
}
