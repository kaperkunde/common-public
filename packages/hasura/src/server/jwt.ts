import { createHmac } from "node:crypto"

/** The claims namespace Hasura reads by default. */
export const HASURA_CLAIMS_NAMESPACE = "https://hasura.io/jwt/claims"

export type MintHasuraJwtOptions = {
  /** Becomes `sub` and `x-hasura-user-id`. */
  userId: string
  /** The shared HS256 key Hasura verifies with (see {@link parseJwtSecret}). */
  secret: string
  /** The default role, `x-hasura-default-role`. */
  role: string
  /** `x-hasura-allowed-roles`. Defaults to just `role`. */
  allowedRoles?: readonly string[]
  /** Extra claims, copied as they are (the caller prefixes `x-hasura-`). */
  claims?: Record<string, string | number | boolean | string[]>
  /** How long the token lives. Defaults to one hour. */
  ttlSeconds?: number
  /** Seconds since the epoch; injectable for tests. */
  now?: number
  /** Where Hasura reads the claims. Defaults to Hasura's own namespace. */
  namespace?: string
}

const b64url = (input: Buffer | string) =>
  Buffer.from(input)
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")

/**
 * A Hasura JWT signed HS256: `sub` is the user, the role claims sit under
 * Hasura's namespace, and `exp` says when it stops working.
 */
export const mintHasuraJwt = (options: MintHasuraJwtOptions): string => {
  if (!options.secret) throw new Error("mintHasuraJwt needs a secret")
  if (!options.userId) throw new Error("mintHasuraJwt needs a userId")
  const iat = options.now ?? Math.floor(Date.now() / 1000)
  const exp = iat + (options.ttlSeconds ?? 3600)
  const allowed = options.allowedRoles ?? [options.role]
  if (!allowed.includes(options.role)) {
    throw new Error("The default role must be one of the allowed roles")
  }
  const payload = {
    sub: options.userId,
    iat,
    exp,
    [options.namespace ?? HASURA_CLAIMS_NAMESPACE]: {
      "x-hasura-allowed-roles": [...allowed],
      "x-hasura-default-role": options.role,
      "x-hasura-user-id": options.userId,
      ...options.claims,
    },
  }
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))
  const body = b64url(JSON.stringify(payload))
  const signature = b64url(
    createHmac("sha256", options.secret).update(`${head}.${body}`).digest(),
  )
  return `${head}.${body}.${signature}`
}

/**
 * The key out of what Hasura's `HASURA_GRAPHQL_JWT_SECRET` holds: either the
 * JSON `{"type":"HS256","key":"..."}` or the bare key.
 */
export const parseJwtSecret = (raw: string): string => {
  const text = raw.trim()
  if (!text.startsWith("{")) return text
  const parsed: unknown = JSON.parse(text)
  const key =
    parsed && typeof parsed === "object"
      ? (parsed as { key?: unknown }).key
      : undefined
  if (typeof key !== "string" || !key) {
    throw new Error("The JWT secret JSON has no key")
  }
  return key
}

/** When a JWT stops working, in seconds since the epoch, or null if unreadable. */
export const jwtExpiry = (token: string): number | null => {
  const part = token.split(".")[1]
  if (!part) return null
  try {
    const payload: unknown = JSON.parse(
      Buffer.from(part, "base64url").toString("utf8"),
    )
    const exp =
      payload && typeof payload === "object"
        ? (payload as { exp?: unknown }).exp
        : undefined
    return typeof exp === "number" ? exp : null
  } catch {
    return null
  }
}
