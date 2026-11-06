/**
 * The manifest `@kaperkunde/legal-docs` ships beside its documents: the
 * commit the package was made from and, for every document, where it stands
 * in the legal repository's history.
 *
 * Pure and client-safe. On the server, `readLegalManifest` (./server) finds
 * the package; anywhere a bundler runs, the manifest can also be imported
 * outright, which needs no tracing:
 *
 *   import manifest from "@kaperkunde/legal-docs/manifest.json" with { type: "json" }
 *   const tos = legalDocVersion(manifest, "hosting/tos.md")
 */

/** The package that publishes the kaperkunde/legal documents. */
export const LEGAL_DOCS_PACKAGE = "@kaperkunde/legal-docs"

export type LegalDocTag = {
  /** The release tag, such as `hosting-tos-2026.3`. */
  name: string
  /** The commit it tags. */
  commit: string
  /** Whether the document is still word for word what was tagged. */
  current: boolean
}

export type LegalDocVersion = {
  /** git blob SHA of the document as published (`git hash-object`). */
  blob: string
  /**
   * The last commit that changed this document. What an acceptance is
   * recorded against: it moves only when this document's own words do.
   */
  commit: string
  /** That commit's date, ISO 8601. */
  date: string
  /** The newest release tag for this document, or null where it has none. */
  tag: LegalDocTag | null
}

export type LegalManifest = {
  /** 1 so far; a reader refuses one it does not know. */
  format: number
  /** `owner/name` on GitHub. */
  repository: string
  /** The commit the package was made from: the ref for links to GitHub. */
  commit: string
  /** That commit's date, ISO 8601. */
  date: string
  /** By path inside the legal repository, such as `hosting/tos.md`. */
  documents: Readonly<Record<string, LegalDocVersion>>
}

/** The manifest formats this package reads. */
export const LEGAL_MANIFEST_FORMATS: readonly number[] = [1]

/** Whether a parsed manifest.json has the shape this package reads. */
export function isLegalManifest(value: unknown): value is LegalManifest {
  if (!value || typeof value !== "object") return false
  const m = value as Record<string, unknown>
  if (
    typeof m.format !== "number" ||
    !LEGAL_MANIFEST_FORMATS.includes(m.format)
  )
    return false
  if (typeof m.commit !== "string" || typeof m.repository !== "string")
    return false
  if (!m.documents || typeof m.documents !== "object") return false

  return Object.values(m.documents as Record<string, unknown>).every(
    (doc) =>
      !!doc &&
      typeof doc === "object" &&
      typeof (doc as LegalDocVersion).blob === "string" &&
      typeof (doc as LegalDocVersion).commit === "string",
  )
}

/**
 * Where one document stands: its blob, the last commit that changed it, that
 * commit's date and its latest tag. Throws for a document the manifest does
 * not publish, which is a mistake in the caller's table rather than anything
 * a request could cause.
 */
export function legalDocVersion(
  manifest: LegalManifest,
  sourcePath: string,
): LegalDocVersion {
  const version = manifest.documents[sourcePath]

  if (!version) {
    throw new Error(
      `${sourcePath} is not in the ${LEGAL_DOCS_PACKAGE} manifest (${manifest.commit})`,
    )
  }

  return version
}
