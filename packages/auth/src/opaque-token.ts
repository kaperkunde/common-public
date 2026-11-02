import { createHash } from "node:crypto"

import { parseScopeList } from "./scopes"

/**
 * Access tokens for clients that did not name the resource they wanted (RFC
 * 8707). The authorization server issues an opaque token then, rather than a
 * JWT bound to the resource, and keeps a SHA-256 of it. The app looks the
 * row up by `hashOpaqueToken` with its own database client and hands it to
 * `opaqueTokenClaims`, which answers JWT-shaped claims or null.
 */
export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url")
}

/** Whether a bearer token is the opaque kind (a JWT has dots). */
export function isOpaqueToken(token: string): boolean {
  return Boolean(token) && !token.includes(".")
}

export type OpaqueTokenRow = {
  clientId: string
  userId: string | null
  scopes: unknown
  resources?: unknown
  expiresAt: Date
  revoked?: Date | boolean | null
  /** DPoP-bound tokens need a proof a plain Bearer request cannot carry. */
  confirmation?: unknown
  client?: { disabled?: boolean | null } | null
  session?: { expiresAt: Date } | null
}

export function opaqueTokenClaims(
  row: OpaqueTokenRow | null | undefined,
  resource: string,
  now: Date = new Date(),
): Record<string, unknown> | null {
  if (
    !row ||
    !row.userId ||
    row.revoked ||
    row.expiresAt <= now ||
    row.confirmation ||
    row.client?.disabled ||
    (row.session && row.session.expiresAt <= now)
  ) {
    return null
  }
  const resources = parseScopeList(row.resources)
  if (resources.length > 0 && !resources.includes(resource)) return null
  return {
    sub: row.userId,
    azp: row.clientId,
    scope: parseScopeList(row.scopes).join(" "),
    exp: Math.floor(row.expiresAt.getTime() / 1000),
  }
}
