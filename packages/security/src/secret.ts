import { createHash, timingSafeEqual } from "node:crypto"

/**
 * Whether two secrets are equal, in time that depends on neither: both are
 * hashed first, so the comparison is always of two 32-byte digests and a
 * wrong guess says nothing about how long the real one is.
 */
export function safeEqual(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest()
  const b = createHash("sha256").update(expected).digest()
  return timingSafeEqual(a, b)
}

/**
 * A bearer token or shared secret check that refuses outright when the
 * expected value is unset, so an app with a missing secret is closed rather
 * than open to the empty string.
 */
export function matchesSecret(
  given: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!given || !expected) return false
  return safeEqual(given, expected)
}

/** The token from an `Authorization: Bearer …` header, or null. */
export function bearerToken(
  authorization: string | null | undefined,
): string | null {
  if (!authorization?.startsWith("Bearer ")) return null
  return authorization.slice("Bearer ".length).trim() || null
}
