import { readFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

import {
  isLegalManifest,
  LEGAL_DOCS_PACKAGE,
  type LegalManifest,
} from "./manifest"

/**
 * Where an app's legal documents come from. Shared by the reader, the boot
 * check and the link check, so all three always agree.
 */
export type LegalDocsOptions = {
  /**
   * A directory laid out as the legal repository: a `legal` submodule, or a
   * fixture in a test. Wins over the package. Relative to the working
   * directory.
   */
  docsRoot?: string
  /**
   * Where to resolve `@kaperkunde/legal-docs` from: a file or directory URL
   * or path in the app. Defaults to the working directory, then this module.
   */
  resolveFrom?: string | URL | readonly (string | URL)[]
}

/**
 * - `docs`: a directory holding the documents at their `sourcePath`, the
 *   package or a `docsRoot`.
 * - `files`: neither is there, so each document is read at its `filePath`
 *   from `root`, as an app with a submodule always did.
 */
export type LegalDocsSource =
  | { kind: "docs"; dir: string; fromPackage: boolean; label: string }
  | { kind: "files"; root: string }

const resolved = new Map<string, string | null>()

function baseFile(base: string | URL): string | URL {
  if (base instanceof URL || base.startsWith("file:")) return base
  // createRequire wants a file; one in the directory is enough, it need not exist.
  return /\.[cm]?[jt]sx?$|\.json$/.test(base)
    ? path.resolve(base)
    : pathToFileURL(path.join(path.resolve(base), "package.json"))
}

/**
 * The installed package's directory, or null where the app has none.
 *
 * `createRequire` is taken from `process.getBuiltinModule` rather than
 * imported, so a bundler that has pulled this module into a server chunk
 * does not treat the `require.resolve` below as one of its own (and answer it
 * with a module id instead of a path). Resolving from the working directory
 * first is what finds the app's own `node_modules` from a bundled chunk.
 */
export function resolveLegalDocsPackage(
  from: LegalDocsOptions["resolveFrom"],
): string | null {
  const bases =
    from === undefined
      ? [process.cwd(), import.meta.url]
      : Array.isArray(from)
        ? (from as readonly (string | URL)[])
        : [from as string | URL]
  const key = bases.map(String).join("\0")

  if (resolved.has(key)) return resolved.get(key) ?? null

  const { createRequire } = process.getBuiltinModule("node:module")
  let dir: string | null = null

  for (const base of bases) {
    try {
      const require = createRequire(baseFile(base))
      dir = path.dirname(require.resolve(`${LEGAL_DOCS_PACKAGE}/manifest.json`))
      break
    } catch {
      // Not installed from here; try the next base.
    }
  }

  resolved.set(key, dir)
  return dir
}

/**
 * Where the documents are read from. A string is the old `root` argument and
 * keeps the old behaviour exactly.
 */
export function legalDocsSource(
  options: string | LegalDocsOptions = {},
): LegalDocsSource {
  if (typeof options === "string") return { kind: "files", root: options }

  if (options.docsRoot !== undefined) {
    return {
      kind: "docs",
      dir: path.resolve(options.docsRoot),
      fromPackage: false,
      label: options.docsRoot,
    }
  }

  const dir = resolveLegalDocsPackage(options.resolveFrom)
  if (dir) {
    return { kind: "docs", dir, fromPackage: true, label: LEGAL_DOCS_PACKAGE }
  }

  return { kind: "files", root: process.cwd() }
}

const manifests = new Map<string, LegalManifest>()

/**
 * The manifest in a docs directory, read once per process. Throws where there
 * is none or it is not one this package reads: that is the build being wrong,
 * not a request.
 */
export function manifestIn(dir: string, label: string): LegalManifest {
  const cached = manifests.get(dir)
  if (cached) return cached

  const file = path.join(dir, "manifest.json")
  let parsed: unknown

  try {
    parsed = JSON.parse(readFileSync(file, "utf8"))
  } catch (error) {
    throw new Error(`${label} has no readable manifest.json (${file})`, {
      cause: error,
    })
  }

  if (!isLegalManifest(parsed)) {
    throw new Error(
      `${label}'s manifest.json is not a format this version of @kaperkunde/legal reads`,
    )
  }

  manifests.set(dir, parsed)
  return parsed
}

/** The version in a package directory's package.json, for messages. */
export function packageVersion(dir: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"))
    return typeof pkg.version === "string" ? pkg.version : null
  } catch {
    return null
  }
}
