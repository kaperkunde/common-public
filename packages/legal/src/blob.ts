import { createHash } from "node:crypto"

/** git's own blob hash, so a value is reproducible with `git hash-object`. */
export function gitBlobSha(bytes: Uint8Array | string): string {
  const data = typeof bytes === "string" ? Buffer.from(bytes, "utf8") : bytes
  return createHash("sha1")
    .update(`blob ${data.byteLength}\0`)
    .update(data)
    .digest("hex")
}
