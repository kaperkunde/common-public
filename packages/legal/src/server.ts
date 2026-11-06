import { readFile } from "node:fs/promises"
import path from "node:path"

import { gitBlobSha } from "./blob"
import { LEGAL_DOCS_PACKAGE, type LegalManifest } from "./manifest"
import type { LegalDoc } from "./site"
import {
  legalDocsSource,
  manifestIn,
  packageVersion,
  type LegalDocsOptions,
  type LegalDocsSource,
} from "./source"

export type { LegalDocsOptions, LegalDocsSource } from "./source"
export { legalDocsSource, resolveLegalDocsPackage } from "./source"

const pending = new Map<string, Promise<string>>()

/** Where one document sits on disk, from wherever the app's documents come. */
function fileFor(
  doc: Pick<LegalDoc, "sourcePath" | "filePath">,
  source: LegalDocsSource,
): string {
  if (source.kind === "docs") return path.join(source.dir, doc.sourcePath)

  if (!doc.filePath) {
    throw new Error(
      `${doc.sourcePath} has no filePath and ${LEGAL_DOCS_PACKAGE} is not installed: ` +
        `add ${LEGAL_DOCS_PACKAGE} to the app's dependencies`,
    )
  }

  return path.join(source.root, doc.filePath)
}

/**
 * A document's markdown, read once per process: the files are part of the
 * build, so they never change while the server runs.
 *
 * From `@kaperkunde/legal-docs` where the app has it installed, at the
 * document's `sourcePath`; from `docsRoot` where one is given; and otherwise
 * from `filePath` under the working directory, which is the `legal`
 * submodule of an app that has not moved over yet. A string second argument
 * is the old `root` and reads `filePath` from it, as before.
 */
export function readLegalDoc(
  doc: Pick<LegalDoc, "sourcePath" | "filePath">,
  options?: string | LegalDocsOptions,
): Promise<string> {
  const file = fileFor(doc, legalDocsSource(options))
  let read = pending.get(file)

  if (!read) {
    read = readFile(file, "utf8")
    // A failed read is not cached: the next request tries again.
    read.catch(() => pending.delete(file))
    pending.set(file, read)
  }

  return read
}

/**
 * The manifest of the documents this app serves, read once per process:
 * `manifest.commit` for links to GitHub, and `legalDocVersion(manifest, …)`
 * for the commit an acceptance is recorded against. Throws where the app has
 * no `@kaperkunde/legal-docs` (or `docsRoot` holds no manifest.json): the
 * submodule path has its generated version file instead.
 */
export function readLegalManifest(options?: LegalDocsOptions): LegalManifest {
  const source = legalDocsSource(options)

  if (source.kind === "files") {
    throw new Error(
      `${LEGAL_DOCS_PACKAGE} is not installed, so there is no manifest to read`,
    )
  }

  return manifestIn(source.dir, source.label)
}

/**
 * Confirms the documents a build serves are on disk and each is exactly the
 * one recorded. Returns what is wrong, or null.
 *
 * From `@kaperkunde/legal-docs` (or a `docsRoot`), every document must be in
 * the package and match the blob its manifest records, and every `blobShas`
 * entry is held to as well. A file that did not reach the image is how a
 * missing `outputFileTracingIncludes` shows itself, and this is where it is
 * caught, at boot rather than on the first request for /terms.
 *
 * Without the package, the documents come from the `legal` submodule, which
 * a plain clone leaves empty, and `blobShas` is what the generated version
 * file recorded.
 */
export async function getLegalDocsProblem(
  options: {
    docs: readonly Pick<LegalDoc, "filePath" | "sourcePath">[]
    /** By path inside the legal repository; held to on top of the manifest. */
    blobShas?: Readonly<Record<string, string>>
    /** Submodule path only: where the submodule sits, from `root`. */
    submoduleDir?: string
    /** Submodule path only: the app root `filePath` is read from. */
    root?: string
  } & LegalDocsOptions,
): Promise<string | null> {
  const { docs, blobShas = {}, docsRoot, resolveFrom } = options
  // `root` or `submoduleDir` on their own name the submodule, as they always did.
  const source =
    docsRoot === undefined &&
    resolveFrom === undefined &&
    (options.root !== undefined || options.submoduleDir !== undefined)
      ? legalDocsSource(options.root ?? process.cwd())
      : legalDocsSource({ docsRoot, resolveFrom })

  if (source.kind === "files") {
    // An app that has moved over names no filePath: the package is the only
    // place its documents can be, and it is not in this build.
    const unplaced = docs.filter((doc) => !doc.filePath)
    if (unplaced.length > 0) {
      return (
        `${LEGAL_DOCS_PACKAGE} is not installed, or did not reach this build, so ` +
        `${unplaced.map((doc) => doc.sourcePath).join(", ")} cannot be served ` +
        "(add it to the app's dependencies; for Next.js standalone output see " +
        "outputFileTracingIncludes in the @kaperkunde/legal README)"
      )
    }

    return submoduleProblem({
      docs,
      blobShas,
      submoduleDir: options.submoduleDir ?? "legal",
      root: source.root,
    })
  }

  return docsProblem({ docs, blobShas, source })
}

async function docsProblem({
  docs,
  blobShas,
  source,
}: {
  docs: readonly Pick<LegalDoc, "sourcePath">[]
  blobShas: Readonly<Record<string, string>>
  source: Extract<LegalDocsSource, { kind: "docs" }>
}): Promise<string | null> {
  const name = source.fromPackage
    ? `${LEGAL_DOCS_PACKAGE}@${packageVersion(source.dir) ?? "?"}`
    : source.label

  let manifest: LegalManifest | null = null
  try {
    manifest = manifestIn(source.dir, name)
  } catch (error) {
    // The package always has one; a submodule used as docsRoot does not.
    if (source.fromPackage) return (error as Error).message
  }

  const sources = new Set([
    ...docs.map((doc) => doc.sourcePath),
    ...Object.keys(blobShas),
  ])
  const unpublished: string[] = []
  const missing: string[] = []
  const changed: string[] = []

  for (const sourcePath of sources) {
    const recorded = manifest?.documents[sourcePath]
    if (manifest && !recorded) {
      unpublished.push(sourcePath)
      continue
    }

    let bytes: Buffer
    try {
      bytes = await readFile(path.join(source.dir, sourcePath))
    } catch {
      missing.push(sourcePath)
      continue
    }

    const blob = gitBlobSha(bytes)
    const expected = [recorded?.blob, blobShas[sourcePath]].filter(Boolean)
    if (expected.some((sha) => sha !== blob)) changed.push(sourcePath)
  }

  const problems: string[] = []

  if (unpublished.length > 0) {
    problems.push(
      `legal documents not published in ${name}: ${unpublished.join(", ")}`,
    )
  }

  if (missing.length > 0) {
    problems.push(
      `legal documents missing from ${name} (${source.dir}): ${missing.join(", ")}` +
        (source.fromPackage
          ? " (the package's files did not reach this build; see outputFileTracingIncludes in the @kaperkunde/legal README)"
          : ""),
    )
  }

  if (changed.length > 0) {
    problems.push(
      `legal documents differ from the ones recorded in ${name}: ${changed.join(", ")}`,
    )
  }

  return problems.length > 0 ? problems.join("; ") : null
}

async function submoduleProblem({
  docs,
  blobShas,
  submoduleDir,
  root,
}: {
  docs: readonly Pick<LegalDoc, "filePath" | "sourcePath">[]
  blobShas: Readonly<Record<string, string>>
  submoduleDir: string
  root: string
}): Promise<string | null> {
  const missing: string[] = []
  const changed: string[] = []
  const toCheck = new Map<string, string>()

  for (const doc of docs) {
    toCheck.set(
      doc.sourcePath,
      doc.filePath ?? path.join(submoduleDir, doc.sourcePath),
    )
  }
  for (const source of Object.keys(blobShas)) {
    if (!toCheck.has(source))
      toCheck.set(source, path.join(submoduleDir, source))
  }

  for (const [source, filePath] of toCheck) {
    let bytes: Buffer
    try {
      bytes = await readFile(path.join(root, filePath))
    } catch {
      missing.push(filePath)
      continue
    }

    const expected = blobShas[source]
    if (expected && gitBlobSha(bytes) !== expected) changed.push(filePath)
  }

  const problems: string[] = []

  if (missing.length > 0) {
    problems.push(
      `legal documents missing: ${missing.join(", ")} ` +
        "(the `legal` submodule is not checked out; run `git submodule update --init legal`, " +
        `or install ${LEGAL_DOCS_PACKAGE})`,
    )
  }

  if (changed.length > 0) {
    problems.push(
      `legal documents differ from the ones recorded: ${changed.join(", ")} ` +
        "(run the legal sync and commit the version file with the submodule pointer)",
    )
  }

  return problems.length > 0 ? problems.join("; ") : null
}
