import type { AnchorHTMLAttributes, ComponentType, ReactNode } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import rehypeSlug from "rehype-slug"
import remarkGfm from "remark-gfm"

import { isAbsoluteHref, type LegalSite } from "./site"

export type LegalLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string
  children?: ReactNode
}

/**
 * A legal document from kaperkunde/legal, drawn as the site styles it.
 *
 * Every link is resolved in the legal repository's own coordinates first
 * (`site.resolveHref`): a document the site publishes becomes its route, one
 * it does not becomes the file on GitHub at the commit served. rehype-slug
 * gives every heading the id GitHub would, which is what makes the documents'
 * cross-references land. Tables scroll in their own box so a phone's page is
 * never wider than the screen.
 *
 * Pass `next/link` as `Link` for client-side navigation; without it internal
 * links are plain anchors. A server component: it holds no state.
 */
export function LegalMarkdown({
  markdown,
  sourcePath,
  commit,
  site,
  className,
  tableClassName,
  Link,
  bare = false,
}: {
  /** The document, with its own `# heading` already taken off (splitTitle). */
  markdown: string
  /** Where it sits inside the legal repository; its links resolve against this. */
  sourcePath: string
  /** The legal commit the app serves: `manifest.commit`, or the submodule's pinned commit. */
  commit: string
  site: LegalSite
  /** The prose styles of the site, on the wrapping element. */
  className?: string
  /** On the box each table scrolls in. */
  tableClassName?: string
  Link?: ComponentType<LegalLinkProps>
  /**
   * Leave out the wrapping element, so the document's elements go straight
   * into the caller's container (where a rhythm such as `.prose > * + *`
   * must reach them). `className` is then unused.
   */
  bare?: boolean
}) {
  const components: Components = {
    a: ({ href, children, node: _node, ...rest }) => {
      if (!href) return <span {...rest}>{children}</span>

      const resolved = site.resolveHref(href, sourcePath, commit)

      if (isAbsoluteHref(resolved)) {
        return (
          <a
            href={resolved}
            target="_blank"
            rel="noopener noreferrer"
            {...rest}
          >
            {children}
          </a>
        )
      }

      if (Link) {
        return (
          <Link href={resolved} {...rest}>
            {children}
          </Link>
        )
      }

      return (
        <a href={resolved} {...rest}>
          {children}
        </a>
      )
    },
    table: ({ children, node: _node, ...rest }) => (
      <div className={tableClassName} style={{ overflowX: "auto" }}>
        <table {...rest}>{children}</table>
      </div>
    ),
  }

  const body = (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeSlug]}
      components={components}
    >
      {markdown}
    </ReactMarkdown>
  )
  return bare ? body : <div className={className}>{body}</div>
}
