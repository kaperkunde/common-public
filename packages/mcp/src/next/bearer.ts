import { bearerTokenFrom, effectiveScopes } from "@kaperkunde/auth"

/** What a verified access token stands for. */
export type BearerIdentity = {
  /** The Better Auth user (`sub`). */
  userId: string
  /** The OAuth client it was issued to. */
  clientId: string
  /** The token's scopes narrowed to what the person still allows. */
  scopes: Set<string>
}

export type BearerVerifierOptions = {
  /**
   * Verifies the token's signature, issuer, audience and expiry and returns
   * its claims, or throws. See {@link jwksVerifier} for one against Better
   * Auth's key set.
   */
  verifyToken: (token: string) => Promise<Record<string, unknown>>
  /**
   * The scopes the person still allows this client, or null once they have
   * disconnected it: the consent row, asked again on every request, since an
   * access token is a signed JWT nothing can recall. Better Auth stores them
   * as an array, a string or JSON text; all are read.
   */
  loadConsent: (userId: string, clientId: string) => Promise<unknown | null>
  /** The URL a `Request` is made against to read the header; any. */
  base?: string
}

/**
 * Who a bearer token stands for, if it is one of ours: valid, from a client
 * the person has not disconnected, with scopes narrowed to what the consent
 * still allows. Anything else -- another audience, a forged or expired token,
 * a bare string, a consent taken back -- is nobody (`undefined`).
 */
export const createBearerVerifier =
  (options: BearerVerifierOptions) =>
  async (header: string | undefined): Promise<BearerIdentity | undefined> => {
    if (!header) return undefined
    try {
      // The scheme is matched in any case, as RFC 6750 has it.
      const token = bearerTokenFrom(
        new Request(options.base ?? "http://localhost/", {
          headers: { authorization: header },
        }),
      )
      if (!token) return undefined
      const payload = await options.verifyToken(token)
      if (typeof payload.sub !== "string" || typeof payload.client_id !== "string") {
        return undefined
      }
      const scopes = effectiveScopes(
        payload.scope,
        await options.loadConsent(payload.sub, payload.client_id),
      )
      if (!scopes) return undefined
      return {
        userId: payload.sub,
        clientId: payload.client_id,
        scopes: new Set(scopes),
      }
    } catch {
      return undefined
    }
  }

export type JwksVerifierOptions = {
  /**
   * The provider's key set, read from wherever it lives (for Better Auth, its
   * own table: `auth.api.getJwks()`), rather than fetched from the app's own
   * public URL, which a server behind a proxy may not be able to reach.
   */
  jwks: () => Promise<{ keys: unknown[] }>
  issuer: string
  /** The resource the token is bound to (the MCP route's address). */
  audience: string
  /** How long a key set is kept, in ms. Default one minute. */
  ttlMs?: number
  now?: () => number
}

/** A `verifyToken` that checks signature, issuer, audience and expiry against a key set (via `jose`). */
export const jwksVerifier = (options: JwksVerifierOptions) => {
  const ttl = options.ttlMs ?? 60_000
  const now = options.now ?? Date.now
  let held: { set: unknown; at: number } | undefined
  return async (token: string): Promise<Record<string, unknown>> => {
    const { createLocalJWKSet, jwtVerify } = await import("jose")
    if (!held || now() - held.at > ttl) {
      held = {
        set: createLocalJWKSet((await options.jwks()) as Parameters<typeof createLocalJWKSet>[0]),
        at: now(),
      }
    }
    const { payload } = await jwtVerify(
      token,
      held.set as Parameters<typeof jwtVerify>[1] as never,
      { issuer: options.issuer, audience: options.audience },
    )
    return payload as Record<string, unknown>
  }
}
