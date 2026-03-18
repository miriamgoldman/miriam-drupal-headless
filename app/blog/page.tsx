import { cacheTag, cacheLife } from "next/cache"
import { ArticleTeaser } from "@/components/drupal/ArticleTeaser"
import { drupal } from "@/lib/drupal"
import type { Metadata } from "next"
import type { DrupalNode } from "next-drupal"

export const metadata: Metadata = {
  title: "Blog",
  description: "Latest articles from our Drupal-powered blog.",
}

async function getArticles(): Promise<DrupalNode[]> {
  "use cache"
  cacheTag("node_list:article")
  cacheLife({ stale: Infinity, revalidate: Infinity, expire: Infinity })

  try {
    return await drupal.getResourceCollection<DrupalNode[]>(
      "node--article",
      {
        params: {
          "filter[status]": 1,
          "fields[node--article]": "title,path,field_image,uid,created,body",
          include: "field_image,uid",
          sort: "-created",
        },
      }
    )
  } catch (error) {
    console.error("Failed to fetch articles:", error)
    return []
  }
}

export default async function BlogPage() {
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
        <p className="py-4">No articles found</p>
      )}
    </>
  )
}
