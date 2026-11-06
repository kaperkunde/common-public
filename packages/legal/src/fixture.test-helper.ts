import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { gitBlobSha } from "./blob"
import type { LegalDocVersion, LegalManifest } from "./manifest"
import { defineLegalSite } from "./site"

export const COMMIT = "0123456789abcdef0123456789abcdef01234567"

/** A site as pcp.gg publishes it, against a corpus shaped like the legal repository. */
export const site = defineLegalSite({
  docs: [
    {
      path: "/terms",
      filePath: "legal/pcpgg/terms.md",
      sourcePath: "pcpgg/terms.md",
      label: "Terms",
      title: "Terms of Use",
      description: "Terms",
    },
    {
      path: "/privacy",
      filePath: "legal/pcpgg/privacy.md",
      sourcePath: "pcpgg/privacy.md",
      label: "Privacy",
      title: "Privacy Notice",
      description: "Privacy",
    },
    {
      path: "/subprocessors",
      filePath: "legal/pcpgg/subprocessors.md",
      sourcePath: "pcpgg/subprocessors.md",
      label: "Subprocessors",
      title: "Subprocessors",
      description: "Subprocessors",
    },
    {
      path: "/privacy/kaperkunde",
      filePath: "legal/privacy.md",
      sourcePath: "privacy.md",
      label: "Kaperkunde policy",
      title: "Kaperkunde Privacy Policy",
      description: "Policy",
    },
  ],
})

/** A temporary app root holding `files` under it. */
export function appRoot(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "kaperkunde-legal-"))
  for (const [file, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    writeFileSync(path.join(root, file), body)
  }
  return root
}

/** The same site, as an app with @kaperkunde/legal-docs writes it: no filePath. */
export const packageSite = defineLegalSite({
  docs: site.docs.map(({ filePath: _filePath, ...doc }) => doc),
})

/**
 * A temporary app with `@kaperkunde/legal-docs` installed in its
 * node_modules, holding `files` at their paths inside the legal repository
 * and a manifest.json made from them as scripts/manifest.mjs makes it.
 * `edit` changes the manifest before it is written. Returns the app's root,
 * which is what `resolveFrom` is given.
 */
export function docsPackage(
  files: Record<string, string>,
  edit: (manifest: LegalManifest) => unknown = (m) => m,
): { app: string; dir: string } {
  const documents: Record<string, LegalDocVersion> = {}
  for (const [file, body] of Object.entries(files)) {
    documents[file] = {
      blob: gitBlobSha(body),
      commit: DOC_COMMIT,
      date: "2026-09-09T12:20:56+00:00",
      tag: null,
    }
  }
  const manifest: LegalManifest = {
    format: 1,
    repository: "kaperkunde/legal",
    commit: COMMIT,
    date: "2026-10-06T12:35:47+00:00",
    documents,
  }

  const dir = "node_modules/@kaperkunde/legal-docs"
  const app = appRoot({
    "package.json": JSON.stringify({ name: "app", private: true }),
    [`${dir}/package.json`]: JSON.stringify({
      name: "@kaperkunde/legal-docs",
      version: "1.0.22",
      exports: {
        "./manifest.json": "./manifest.json",
        "./package.json": "./package.json",
        "./*": "./*",
      },
    }),
    [`${dir}/manifest.json`]: JSON.stringify(edit(manifest)),
    ...Object.fromEntries(
      Object.entries(files).map(([file, body]) => [`${dir}/${file}`, body]),
    ),
  })

  return { app, dir: path.join(app, dir) }
}

/** The last commit to change each fixture document. */
export const DOC_COMMIT = "fedcba9876543210fedcba9876543210fedcba98"
