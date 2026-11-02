import { randomInt } from "node:crypto"

/** Letters and digits no one misreads: no 0/O, 1/I/L. */
export const UNAMBIGUOUS_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

/**
 * A random code from `alphabet`, in groups: "K7QF-M2XR-9PDA". From the
 * system's cryptographic random source, so it can be an invite or a claim
 * code.
 */
export function randomCode({
  groups = 3,
  groupLength = 4,
  alphabet = UNAMBIGUOUS_ALPHABET,
  separator = "-",
}: {
  groups?: number
  groupLength?: number
  alphabet?: string
  separator?: string
} = {}): string {
  const parts: string[] = []
  for (let g = 0; g < groups; g++) {
    let part = ""
    for (let i = 0; i < groupLength; i++)
      part += alphabet[randomInt(alphabet.length)]
    parts.push(part)
  }
  return parts.join(separator)
}

/** A typed code as stored: upper case, without spaces or separators. */
export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "")
}
