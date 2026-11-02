import { readFile } from "node:fs/promises"
import path from "node:path"

import { gitBlobSha } from "./blob"
import type { LegalDoc } from "./site"

const pending = new Map<string, Promise<string>>()

/**
 * A document's markdown, read once per process. The files are part of the
 * build (the `legal` submodule, copied into the image), so they never change
 * while the server runs. `root` defaults to the working directory.
 */
export function readLegalDoc(
  doc: Pick<LegalDoc, "filePath">,
  root: string = process.cwd(),
): Promise<string> {
  const file = path.join(root, doc.filePath)
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
 * Confirms the documents a build serves are on disk and, where the generated
 * version file recorded a blob SHA, that each is exactly the one recorded.
 *
 * The documents come from the `legal` submodule, which a plain clone leaves
 * empty, and the Dockerfile's fallback clone is nothing anything else checks.
 * Without this an image could answer /terms with a 500, or serve terms other
 * than the ones acceptance is recorded against. Returns what is wrong, or
 * null.
 */
export async function getLegalDocsProblem({
  docs,
  blobShas = {},
  submoduleDir = "legal",
  root = process.cwd(),
}: {
  docs: readonly Pick<LegalDoc, "filePath" | "sourcePath">[]
  /** By path inside the legal repository, as the version file records them. */
  blobShas?: Readonly<Record<string, string>>
  /** Where the submodule sits, from `root`. */
  submoduleDir?: string
  root?: string
}): Promise<string | null> {
  const missing: string[] = []
  const changed: string[] = []
  const toCheck = new Map<string, string>()

  for (const doc of docs) toCheck.set(doc.sourcePath, doc.filePath)
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
        "(the `legal` submodule is not checked out; run `git submodule update --init legal`)",
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
