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
