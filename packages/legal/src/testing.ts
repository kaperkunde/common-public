import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

import GithubSlugger from "github-slugger"

import { isAbsoluteHref, type LegalSite } from "./site"

const LINK = /\[[^\]]*\]\(([^)\s]+)\)/g
const HEADING = /^#{1,6}\s+(.+?)\s*$/gm

function headingsIn(file: string): Set<string> {
  const slugger = new GithubSlugger()
  const slugs = new Set<string>()
  for (const match of readFileSync(file, "utf8").matchAll(HEADING)) {
    if (match[1]) slugs.add(slugger.slug(match[1]))
  }
  return slugs
}

/**
 * Every relative link in a site's documents that goes nowhere.
 *
 * Links are written as paths between files in the legal repository, and the
 * ones a site does not publish fall through to GitHub, so a typo'd path never
 * 404s here and never throws: it becomes a plausible URL to a file that is not
 * there. This walks every relative link and reports one that lands on no route
 * the site publishes, on a heading that does not exist (github-slugger is what
 * rehype-slug writes the ids with), or on a file missing from the submodule.
 *
 *   expect(findBrokenLegalLinks({ site, commit: LEGAL_COMMIT })).toEqual([])
 */
export function findBrokenLegalLinks({
  site,
  commit,
  root = process.cwd(),
  submoduleDir = "legal",
}: {
  site: LegalSite
  commit: string
  root?: string
  submoduleDir?: string
}): string[] {
  const broken: string[] = []
  const githubPrefix = `https://github.com/${site.repo}/blob/${commit}/`

  for (const doc of site.docs) {
    const source = readFileSync(path.join(root, doc.filePath), "utf8")

    for (const match of source.matchAll(LINK)) {
      const href = match[1]
      if (!href || isAbsoluteHref(href)) continue

      const resolved = site.resolveHref(href, doc.sourcePath, commit)
      const [target = "", fragment] = resolved.split("#")

      if (target.startsWith("/")) {
        const to = site.docByPath(target)
        if (!to) {
          broken.push(`${doc.sourcePath}: ${href} -> no document at ${target}`)
        } else if (
          fragment &&
          !headingsIn(path.join(root, to.filePath)).has(fragment)
        ) {
          broken.push(
            `${doc.sourcePath}: ${href} -> ${target} has no #${fragment}`,
          )
        }
      } else {
        const file = target.replace(githubPrefix, "")
        if (!existsSync(path.join(root, submoduleDir, file))) {
          broken.push(
            `${doc.sourcePath}: ${href} -> ${submoduleDir}/${file} is not there`,
          )
        }
      }
    }
  }

  return broken
}
