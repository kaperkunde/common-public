/**
 * The legal documents a site publishes, and where each one comes from.
 *
 * The prose lives in kaperkunde/legal, carried in each app as the `legal` git
 * submodule. Three paths matter and they are not the same thing: `path` is
 * where a reader finds the document on the site, `filePath` is where it sits
 * on disk from the app's root, and `sourcePath` is where it sits inside the
 * legal repository, which is the only one a link written in the markdown
 * knows about.
 *
 * Pure and client-safe: nothing here reads a file.
 */
export type LegalDoc = {
  /** Root-relative route the document is published at. */
  path: string
  /** From the app's root: what the page reads. */
  filePath: string
  /** Inside the legal repository: what the links in the markdown resolve against. */
  sourcePath: string
  /** Tab label on the legal pages. */
  label: string
  /** Page heading. The markdown's own `# heading` is dropped in its favour. */
  title: string
  /** For search results and link previews. */
  description: string
}

export const DEFAULT_LEGAL_REPO = "kaperkunde/legal"

export type LegalSite = {
  repo: string
  docs: readonly LegalDoc[]
  /** The document published at a route, or undefined where nothing is. */
  docByPath(path: string): LegalDoc | undefined
  /** The document published at a route; throws where nothing is. */
  doc(path: string): LegalDoc
  /** The route a file inside the legal repository is published at, if any. */
  pathForSource(sourcePath: string): string | undefined
  /**
   * Where a link written inside `sourcePath` should point on this site.
   * `commit` is the pinned legal commit, used only for documents the site
   * does not publish, which link to GitHub at that exact commit.
   */
  resolveHref(href: string, sourcePath: string, commit: string): string
}

/** Whether an href already names where it goes, and so is left as written. */
export function isAbsoluteHref(href: string): boolean {
  return /^(https?:\/\/|mailto:|tel:|\/\/)/i.test(href)
}

/** Walks a relative path from a directory, honouring `.` and `..`. */
function resolveFrom(baseDir: string, href: string): string {
  const segments = baseDir.split("/").filter(Boolean)

  for (const part of href.split("/")) {
    if (!part || part === ".") continue
    if (part === "..") segments.pop()
    else segments.push(part)
  }

  return segments.join("/")
}

/** A site's table of legal documents, with the lookups every page needs. */
export function defineLegalSite({
  docs,
  repo = DEFAULT_LEGAL_REPO,
}: {
  docs: readonly LegalDoc[]
  repo?: string
}): LegalSite {
  const byPath = new Map(docs.map((d) => [d.path, d]))
  const bySource = new Map(docs.map((d) => [d.sourcePath, d.path]))

  const site: LegalSite = {
    repo,
    docs,
    docByPath: (path) => byPath.get(path),
    doc(path) {
      const found = byPath.get(path)
      if (!found) throw new Error(`No legal document is published at ${path}`)
      return found
    },
    pathForSource: (sourcePath) => bySource.get(sourcePath),
    resolveHref(href, sourcePath, commit) {
      if (isAbsoluteHref(href)) return href

      const hashAt = href.indexOf("#")
      const path = hashAt === -1 ? href : href.slice(0, hashAt)
      const fragment = hashAt === -1 ? "" : href.slice(hashAt)

      // A bare `#section` is the document talking about itself.
      const lastSlash = sourcePath.lastIndexOf("/")
      const baseDir = lastSlash === -1 ? "" : sourcePath.slice(0, lastSlash + 1)
      const resolved = path ? resolveFrom(baseDir, path) : sourcePath
      const route = bySource.get(resolved)

      if (route) return `${route}${fragment}`

      return `https://github.com/${repo}/blob/${commit}/${resolved}${fragment}`
    },
  }

  return site
}

/**
 * Splits a document's leading `# Title` from its body. The page draws the
 * title itself, so the markdown's own heading would otherwise make two h1s.
 */
export function splitTitle(markdown: string): {
  title: string | null
  body: string
} {
  const text = markdown.replace(/^\s*\n/, "")
  const match = text.match(/^#[ \t]+(.+?)[ \t]*#*[ \t]*(?:\n|$)/)

  if (!match || match[1] === undefined) return { title: null, body: text }

  return {
    title: match[1].trim(),
    body: text.slice(match[0].length).replace(/^\s*\n/, ""),
  }
}
