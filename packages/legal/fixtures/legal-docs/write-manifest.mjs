// Writes this fixture's manifest.json in the shape scripts/manifest.mjs in
// kaperkunde/legal writes it, with made-up commits.
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const blob = (file) => {
  const bytes = readFileSync(join(here, file))
  return createHash("sha1")
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest("hex")
}

const manifest = {
  format: 1,
  repository: "kaperkunde/legal",
  commit: "0123456789abcdef0123456789abcdef01234567",
  date: "2026-10-06T12:35:47+00:00",
  documents: {
    "hosting/tos.md": {
      blob: blob("hosting/tos.md"),
      commit: "e1c0df20b05788b164fb5b01a192d02935a82f7d",
      date: "2026-09-09T12:20:56+00:00",
      tag: {
        name: "hosting-tos-2026.3",
        commit: "1367c524beb58c60312d34b33f75211769357220",
        current: false,
      },
    },
    "privacy.md": {
      blob: blob("privacy.md"),
      commit: "6e72504c02341479cd6fbdb9078436d663d9101b",
      date: "2026-10-06T11:47:27+00:00",
      tag: {
        name: "privacy-2026.11",
        commit: "6e72504c02341479cd6fbdb9078436d663d9101b",
        current: true,
      },
    },
  },
}

writeFileSync(
  join(here, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
)
