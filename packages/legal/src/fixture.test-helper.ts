import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

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
