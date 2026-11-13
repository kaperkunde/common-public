import type { IncomingMessage, ServerResponse } from "node:http"

import { bearerChallenge } from "@kaperkunde/auth"

import type { BearerIdentity } from "./bearer"
import {
  DEFAULT_BUCKETS,
  requestKind,
  rpcIdOf,
  tooManyBody,
  type Buckets,
  type Classifier,
} from "./rate"

/** What the app makes of a verified identity: its own caller, or a refusal. */
export type Resolved<Caller> =
  | {
      ok: true
      caller: Caller
      /** What the rate limit counts against: a user id. */ rateKey: string
    }
  | { ok: false; status: 401 | 403; message: string }

export type DoorOptions<Caller> = {
  /** Verifies the `Authorization` header (see `createBearerVerifier`). */
  verifyBearer: (
    header: string | undefined,
  ) => Promise<BearerIdentity | undefined>
  /**
   * Walks the identity to the app's own caller and holds it to the app's own
   * gate (a waitlist, a ban). `undefined` is treated as an unknown token.
   */
  resolve: (identity: BearerIdentity) => Promise<Resolved<Caller> | undefined>
  /** Where the resource describes itself (RFC 9728), for the challenge. */
  resourceMetadataUrl: string
  /** The scopes a fresh client should ask for. */
  scopes: readonly string[]
  /** Counts one request: `checkRateLimit` from `@kaperkunde/security` fits as `(key, { max, windowMs })`. */
  rateLimit: (
    key: string,
    limit: { max: number; windowMs: number },
  ) => { allowed: boolean; retryAfterMs: number }
  buckets?: Buckets
  classifier?: Classifier
  /** Key prefix for the rate windows. Default `mcp`. */
  rateNamespace?: string
  /** The words of the two 401s. */
  messages?: { invalidToken?: string; signIn?: string }
}

export type DoorRefusal = {
  status: number
  headers: Record<string, string>
  body: unknown
}

export type Admission<Caller> =
  | { ok: true; caller: Caller; identity: BearerIdentity }
  | { ok: false; refusal: DoorRefusal }

const rpcError = (message: string) => ({
  jsonrpc: "2.0",
  error: { code: -32000, message },
  id: null,
})

/**
 * The door an MCP route goes through, framework-neutral: who is asking
 * (verified bearer, walked to the app's caller, held to its gate), then
 * limited per person in two buckets, reads and writes. Refusals carry the
 * challenge that tells a client where to sign in. The Node and web adapters
 * below apply a refusal to a response.
 */
export const createDoor = <Caller>(options: DoorOptions<Caller>) => {
  const buckets = options.buckets ?? DEFAULT_BUCKETS
  const ns = options.rateNamespace ?? "mcp"
  const challenge = (error?: "invalid_token") =>
    bearerChallenge({
      urls: { resourceMetadataUrl: options.resourceMetadataUrl },
      scopes: options.scopes,
      error,
    })

  /** `body` is the parsed JSON-RPC body, which is all the sorting needs. */
  const admit = async (
    authorization: string | undefined,
    body: unknown,
  ): Promise<Admission<Caller>> => {
    const identity = await options.verifyBearer(authorization)
    const resolved = identity ? await options.resolve(identity) : undefined
    if (!identity || !resolved) {
      return {
        ok: false,
        refusal: {
          status: 401,
          headers: {
            "WWW-Authenticate": challenge(
              authorization ? "invalid_token" : undefined,
            ),
          },
          body: rpcError(
            authorization
              ? (options.messages?.invalidToken ??
                  "That token is not one of ours, or no longer is: sign in again.")
              : (options.messages?.signIn ??
                  "Sign in first: this server is connected through OAuth."),
          ),
        },
      }
    }
    if (!resolved.ok) {
      return {
        ok: false,
        refusal: {
          status: resolved.status,
          headers: {},
          body: rpcError(resolved.message),
        },
      }
    }
    const kind = requestKind(body, options.classifier)
    const { limit, windowMs } = buckets[kind]
    const { allowed, retryAfterMs } = options.rateLimit(
      `${ns}:${kind}:${resolved.rateKey}`,
      { max: limit, windowMs },
    )
    if (!allowed) {
      const seconds = Math.max(Math.ceil(retryAfterMs / 1000), 1)
      return {
        ok: false,
        refusal: {
          status: 429,
          headers: { "Retry-After": String(seconds) },
          body: tooManyBody(kind, seconds, rpcIdOf(body), buckets),
        },
      }
    }
    return { ok: true, caller: resolved.caller, identity }
  }

  return {
    admit,
    challenge,

    /**
     * Pages router: sets `Cache-Control: no-store`, answers the request itself
     * when refused and returns nothing, so the route reads as who is asking,
     * then what for.
     */
    async admitNode(
      req: IncomingMessage & { body?: unknown },
      res: ServerResponse,
    ): Promise<Caller | undefined> {
      res.setHeader("Cache-Control", "no-store")
      const header = req.headers.authorization
      const result = await admit(header, req.body)
      if (result.ok) return result.caller
      for (const [key, value] of Object.entries(result.refusal.headers)) {
        res.setHeader(key, value)
      }
      res.statusCode = result.refusal.status
      res.setHeader("Content-Type", "application/json")
      res.end(JSON.stringify(result.refusal.body))
      return undefined
    },

    /** App router: the caller, or the `Response` to return. The request is not consumed. */
    async admitWeb(
      request: Request,
    ): Promise<{ caller: Caller } | { response: Response }> {
      let body: unknown
      if (request.method === "POST") {
        body = await request
          .clone()
          .json()
          .catch(() => undefined)
      }
      const result = await admit(
        request.headers.get("authorization") ?? undefined,
        body,
      )
      if (result.ok) return { caller: result.caller }
      return {
        response: new Response(JSON.stringify(result.refusal.body), {
          status: result.refusal.status,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
            ...result.refusal.headers,
          },
        }),
      }
    },
  }
}

export type Door<Caller> = ReturnType<typeof createDoor<Caller>>

export type ProtectedResourceInput = {
  /** The MCP route's address: the token audience. */
  resource: string
  authorizationServers: readonly string[]
  scopes: readonly string[]
  name?: string
  documentation?: string
}

/** The RFC 9728 document a client reads to find the authorization server. */
export const protectedResourceMetadata = (input: ProtectedResourceInput) => ({
  resource: input.resource,
  authorization_servers: [...input.authorizationServers],
  bearer_methods_supported: ["header"],
  scopes_supported: [...input.scopes],
  ...(input.name ? { resource_name: input.name } : {}),
  ...(input.documentation
    ? { resource_documentation: input.documentation }
    : {}),
})
