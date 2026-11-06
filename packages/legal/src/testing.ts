import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

import GithubSlugger from "github-slugger"

import { isAbsoluteHref, type LegalDoc, type LegalSite } from "./site"
import { legalDocsSource, type LegalDocsOptions } from "./source"

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
 * rehype-slug writes the ids with), or on a file missing from the documents.
 *
 *   expect(findBrokenLegalLinks({ site, commit: manifest.commit })).toEqual([])
 *
 * The documents are read where the server reads them: `@kaperkunde/legal-docs`
 * when it is installed, `docsRoot` when one is given, and otherwise each
 * `filePath` from `root` with unpublished files looked for in `submoduleDir`.
 */
export function findBrokenLegalLinks({
  site,
  commit,
  root,
  submoduleDir,
  docsRoot,
  resolveFrom,
}: {
  site: LegalSite
  commit: string
  /** Submodule path only: the app root `filePath` is read from. */
  root?: string
  /** Submodule path only: where the submodule sits, from `root`. */
  submoduleDir?: string
} & LegalDocsOptions): string[] {
  const legacy =
    docsRoot === undefined &&
    resolveFrom === undefined &&
    (root !== undefined || submoduleDir !== undefined)
  const source = legacy
    ? legalDocsSource(root ?? process.cwd())
    : legalDocsSource({ docsRoot, resolveFrom })

  const fileOf = (doc: Pick<LegalDoc, "sourcePath" | "filePath">): string => {
    if (source.kind === "docs") return path.join(source.dir, doc.sourcePath)
    return path.join(
      source.root,
      doc.filePath ?? path.join(submoduleDir ?? "legal", doc.sourcePath),
    )
  }
  const repoFile = (file: string): { at: string; shown: string } =>
    source.kind === "docs"
      ? { at: path.join(source.dir, file), shown: file }
      : {
          at: path.join(source.root, submoduleDir ?? "legal", file),
          shown: `${submoduleDir ?? "legal"}/${file}`,
        }

  const broken: string[] = []
  const githubPrefix = `https://github.com/${site.repo}/blob/${commit}/`

  for (const doc of site.docs) {
    const text = readFileSync(fileOf(doc), "utf8")

    for (const match of text.matchAll(LINK)) {
      const href = match[1]
      if (!href || isAbsoluteHref(href)) continue

      const resolved = site.resolveHref(href, doc.sourcePath, commit)
      const [target = "", fragment] = resolved.split("#")

      if (target.startsWith("/")) {
        const to = site.docByPath(target)
        if (!to) {
          broken.push(`${doc.sourcePath}: ${href} -> no document at ${target}`)
        } else if (fragment && !headingsIn(fileOf(to)).has(fragment)) {
          broken.push(
            `${doc.sourcePath}: ${href} -> ${target} has no #${fragment}`,
          )
        }
      } else {
        const file = repoFile(target.replace(githubPrefix, ""))
        if (!existsSync(file.at)) {
          broken.push(
            `${doc.sourcePath}: ${href} -> ${file.shown} is not there`,
          )
        }
      }
    }
  }

  return broken
}
