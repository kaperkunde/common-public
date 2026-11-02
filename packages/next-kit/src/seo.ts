/**
 * The shapes Next's metadata routes want, built the same way everywhere.
 * Each route that uses them sets `export const dynamic = "force-dynamic"`,
 * so the site URL is read at request time rather than baked into the image.
 */

export type RobotsOptions = {
  siteUrl: string
  disallow?: readonly string[]
  /** Disallow everything (a dev or preview deployment). */
  closed?: boolean
}

export function robotsFor({
  siteUrl,
  disallow = [],
  closed = false,
}: RobotsOptions) {
  return {
    rules: closed
      ? { userAgent: "*", disallow: "/" }
      : { userAgent: "*", allow: "/", disallow: [...disallow] },
    ...(closed ? {} : { sitemap: `${siteUrl}/sitemap.xml` }),
  }
}

export type SitemapEntry = {
  url: string
  lastModified?: Date | string
  changeFrequency?:
    "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never"
  priority?: number
}

/** Root-relative paths (and full entries) as sitemap entries on `siteUrl`. */
export function sitemapFor(
  siteUrl: string,
  pages: readonly (string | (Omit<SitemapEntry, "url"> & { path: string }))[],
): SitemapEntry[] {
  return pages.map((page) => {
    const { path, ...rest } = typeof page === "string" ? { path: page } : page
    return { url: `${siteUrl}${path === "/" ? "" : path}`, ...rest }
  })
}

export type LlmsSection = {
  title: string
  links: readonly { title: string; url: string; note?: string }[]
}

/** An llms.txt document (https://llmstxt.org): a title, a summary, and sections of links. */
export function llmsTxt({
  title,
  summary,
  details,
  sections,
}: {
  title: string
  summary: string
  details?: string
  sections: readonly LlmsSection[]
}): string {
  const lines = [`# ${title}`, "", `> ${summary}`, ""]
  if (details) lines.push(details.trim(), "")
  for (const section of sections) {
    lines.push(`## ${section.title}`, "")
    for (const link of section.links) {
      lines.push(
        `- [${link.title}](${link.url})${link.note ? `: ${link.note}` : ""}`,
      )
    }
    lines.push("")
  }
  return `${lines.join("\n").trimEnd()}\n`
}

/** A plain-text response with the cache headers llms.txt and robots want. */
export function textResponse(body: string, maxAgeSeconds = 3600): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": `public, max-age=${maxAgeSeconds}`,
    },
  })
}
