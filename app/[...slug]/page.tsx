import { cacheTag, cacheLife } from "next/cache"
import { notFound } from "next/navigation"
import { Article } from "@/components/drupal/Article"
import { BasicPage } from "@/components/drupal/BasicPage"
import { drupal } from "@/lib/drupal"
import type { Metadata, ResolvingMetadata } from "next"
import type { DrupalNode, JsonApiParams } from "next-drupal"

async function getNode(slug: string[]) {
  "use cache"

  const path = `/${slug.join("/")}`
  const params: JsonApiParams = {}

  const translatedPath = await drupal.translatePath(path)

  if (!translatedPath) {
    return null
  }

  const type = translatedPath.jsonapi?.resourceName!
  const uuid = translatedPath.entity.uuid
  const entityId = translatedPath.entity.id

  cacheTag(`node:${entityId}`, type)
  cacheLife({ stale: Infinity, revalidate: Infinity, expire: Infinity })

  if (type === "node--article") {
    params.include = "field_image,uid"
  }

  const resource = await drupal.getResource<DrupalNode>(type, uuid, {
    params,
  })

  return resource || null
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

  const node = await getNode(slug)
  if (!node) return {}

  return {
    title: node.title,
  }
}

const RESOURCE_TYPES = ["node--page", "node--article"]

export async function generateStaticParams(): Promise<NodePageParams[]> {
  try {
    const resources = await drupal.getResourceCollectionPathSegments(
      RESOURCE_TYPES,
      {}
    )

    return resources.map((resource) => {
      return {
        slug: resource.segments,
      }
    })
  } catch (error) {
    console.error("Failed to fetch static params:", error)
    return []
  }
}

export default async function NodePage(props: NodePageProps) {
  const params = await props.params
  const { slug } = params

  const node = await getNode(slug)

  if (!node || node.status === false) {
    notFound()
  }

  return (
    <>
      {node.type === "node--page" && <BasicPage node={node} />}
      {node.type === "node--article" && <Article node={node} />}
    </>
  )
}
