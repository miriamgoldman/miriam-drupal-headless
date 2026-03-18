import { Link } from "@/components/navigation/Link"

export function HeaderNav() {
  return (
    <header>
      <div className="container flex items-center justify-between py-6 mx-auto">
        <Link href="/" className="text-2xl font-semibold no-underline">
          Next.js for Drupal
        </Link>
        <nav className="flex items-center gap-6">
          <Link href="/blog" className="hover:text-blue-600">
            Blog
          </Link>
          <Link
            href="https://next-drupal.org/docs"
            target="_blank"
            rel="external"
            className="hover:text-blue-600"
          >
            Docs
          </Link>
        </nav>
      </div>
    </header>
  )
}
