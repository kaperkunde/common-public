import { TokenCenterError, isTokenError } from "../errors"
import type {
  AutoRefillInput,
  BackendOrder,
  CallsQuery,
  Currency,
  OwnEndpointInput,
  TokenErrorDetail,
} from "../types"
import type { TokenCenter } from "./client"

/** The signed-in person a request belongs to, as the app knows them. */
export type TokenUser = {
  /** The app's own user id: the payer. */
  id: string
  /** The **verified** email, stored on the center's user row. Leave out if unverified. */
  email?: string | null
  displayName?: string | null
}

export type ReturnKind = "checkout" | "card"

export type TokenRoutesOptions = {
  /**
   * Who is asking: read the app's own session off the request (cookie or
   * bearer). `null` answers 401. The browser never says who it is, so no
   * body or query can name another user.
   */
  userOf: (request: Request) => TokenUser | null | Promise<TokenUser | null>
  /** Where the handler is mounted, to find the operation in the URL. Default `/api/tokens`. */
  basePath?: string
  /**
   * The app's public origin for the return URLs Stripe sends the browser back
   * to (must be one of the app's registered `returnOrigins` on the center).
   * Set it behind a proxy: the request's own URL may be an internal one.
   */
  origin?: string | ((request: Request) => string)
  /** Replace the default return URLs (`<origin><returnPath>?tokens=…`). */
  returnUrls?: (context: {
    request: Request
    kind: ReturnKind
    returnPath: string
    origin: string
  }) => { successUrl: string; cancelUrl: string }
  /** Keep the center's user row (email, name) up to date on first sight. Default true. */
  syncUser?: boolean
}

type Handler = (c: Ctx) => Promise<Response | unknown | undefined>
type Ctx = {
  request: Request
  user: TokenUser
  center: TokenCenter
  query: URLSearchParams
  body: () => Promise<Record<string, unknown>>
  returnUrls: (
    kind: ReturnKind,
    returnPath: unknown,
  ) => { successUrl: string; cancelUrl: string }
  idempotencyKey: string | undefined
  segments: string[]
}

const CURRENCIES: readonly string[] = ["eur", "usd"]
const ORDERS: readonly string[] = [
  "tokens_then_own",
  "own_then_tokens",
  "tokens_only",
  "own_only",
]

const bad = (message: string, path?: string) =>
  new TokenCenterError({
    code: "invalid_request",
    message,
    ...(path ? { path } : {}),
  })

/** Only a path on this app's own origin comes back as a return path. */
export function safeReturnPath(value: unknown): string {
  return typeof value === "string" && /^\/(?![/\\])/.test(value) ? value : "/"
}

const withQuery = (path: string, query: string) =>
  `${path}${path.includes("?") ? "&" : "?"}${query}`

const pick = <T extends object>(
  source: Record<string, unknown>,
  keys: readonly string[],
): T =>
  Object.fromEntries(
    keys.filter((k) => source[k] !== undefined).map((k) => [k, source[k]]),
  ) as T

/**
 * The browser-facing half of the center, for an app to mount: a Web
 * `Request → Response` handler that authenticates the **app's own** session
 * (`userOf`), puts that user in, and calls the center with the app key, so the
 * browser never holds the key and can never name another user.
 *
 * Operations (under `basePath`, default `/api/tokens`):
 * `GET app | models | balance | calls | history | sale-prices | autorefill |
 * own-endpoint | purchase/:id`, `POST checkout | card | own-endpoint/test`,
 * `PUT autorefill | own-endpoint | backend-order`, `DELETE card | own-endpoint`.
 *
 * App router: `export const GET = handler` (and POST, PUT, DELETE) in
 * `app/api/tokens/[...op]/route.ts`. Pages router: wrap with `nodeHandler`
 * (`@kaperkunde/tokens/server`).
 */
export function tokenRoutes(
  center: TokenCenter,
  options: TokenRoutesOptions,
): (request: Request) => Promise<Response> {
  const basePath = (options.basePath ?? "/api/tokens").replace(/\/+$/, "")
  const synced = new Map<string, string>()

  const routes: Record<string, Partial<Record<string, Handler>>> = {
    app: { GET: ({ center }) => center.app() },
    models: { GET: async ({ center }) => ({ models: await center.models() }) },
    balance: { GET: ({ center, user }) => center.balance(user.id) },
    calls: {
      GET: ({ center, user, query }) => {
        const q: CallsQuery = {}
        const limit = Number(query.get("limit"))
        if (query.has("limit")) {
          if (!Number.isInteger(limit) || limit < 1 || limit > 200)
            throw bad("limit must be 1..200.", "limit")
          q.limit = limit
        }
        for (const k of [
          "cursor",
          "since",
          "scope",
          "job",
          "correlation",
          "purpose",
        ] as const) {
          const v = query.get(k)
          if (v) q[k] = v
        }
        const source = query.get("source")
        if (source === "tokens" || source === "own") q.source = source
        return center.calls(user.id, q)
      },
    },
    history: {
      GET: ({ center, user, query }) => {
        const limit = Number(query.get("limit"))
        return center.history(user.id, {
          ...(query.has("limit") && Number.isInteger(limit) && limit > 0
            ? { limit: Math.min(limit, 200) }
            : {}),
          ...(query.get("cursor") ? { cursor: query.get("cursor")! } : {}),
        })
      },
    },
    "sale-prices": { GET: ({ center }) => center.salePrices() },
    purchase: {
      GET: ({ center, user, segments }) => {
        if (!segments[1]) throw bad("A purchase id is needed.", "purchaseId")
        return center.purchase(user.id, decodeURIComponent(segments[1]))
      },
    },
    checkout: {
      POST: async ({ center, user, body, returnUrls, idempotencyKey }) => {
        const b = await body()
        if (typeof b.currency !== "string" || !CURRENCIES.includes(b.currency))
          throw bad("currency must be eur or usd.", "currency")
        if (!Number.isInteger(b.amountCents) || (b.amountCents as number) <= 0)
          throw bad(
            "amountCents must be a positive whole number of cents.",
            "amountCents",
          )
        const urls = returnUrls("checkout", b.returnPath)
        const session = await center.checkout(
          user.id,
          {
            currency: b.currency as Currency,
            amountCents: b.amountCents as number,
            ...urls,
            ...(b.saveCard === true ? { saveCard: true } : {}),
            ...(typeof b.locale === "string" ? { locale: b.locale } : {}),
          },
          { idempotencyKey },
        )
        return new Response(JSON.stringify(session), {
          status: 201,
          headers: { "content-type": "application/json" },
        })
      },
    },
    autorefill: {
      GET: ({ center, user }) => center.autoRefill(user.id),
      PUT: async ({ center, user, body }) =>
        center.setAutoRefill(
          user.id,
          pick<AutoRefillInput>(await body(), [
            "enabled",
            "thresholdMicros",
            "amountCents",
            "currency",
            "monthlyMaxCents",
          ]),
        ),
    },
    card: {
      POST: async ({ center, user, body, returnUrls, idempotencyKey }) => {
        const b = await body()
        if (
          b.currency !== undefined &&
          !CURRENCIES.includes(String(b.currency))
        )
          throw bad("currency must be eur or usd.", "currency")
        const session = await center.setupCard(
          user.id,
          {
            ...returnUrls("card", b.returnPath),
            ...(b.currency ? { currency: b.currency as Currency } : {}),
          },
          { idempotencyKey },
        )
        return new Response(JSON.stringify(session), {
          status: 201,
          headers: { "content-type": "application/json" },
        })
      },
      DELETE: async ({ center, user }) => {
        await center.removeCard(user.id)
        return new Response(null, { status: 204 })
      },
    },
    "own-endpoint": {
      GET: async ({ center, user, segments }) => {
        if (segments[1]) return undefined
        // 200 with null when the user has none.
        return await center.ownEndpoint(user.id)
      },
      PUT: async ({ center, user, body }) =>
        center.saveOwnEndpoint(
          user.id,
          pick<OwnEndpointInput>(await body(), [
            "baseUrl",
            "apiKey",
            "models",
            "defaultModel",
            "capabilities",
            "toolChoice",
            "monthlyTokenLimit",
            "order",
          ]),
        ),
      DELETE: async ({ center, user }) => {
        await center.removeOwnEndpoint(user.id)
        return new Response(null, { status: 204 })
      },
      POST: async ({ center, user, segments }) => {
        if (segments[1] !== "test") return undefined
        return center.testOwnEndpoint(user.id)
      },
    },
    "backend-order": {
      PUT: async ({ center, user, body }) => {
        const { order } = await body()
        if (typeof order !== "string" || !ORDERS.includes(order))
          throw bad("order is not one of the four orders.", "order")
        return center.setBackendOrder(user.id, { order: order as BackendOrder })
      },
    },
  }

  const originOf = (request: Request) =>
    typeof options.origin === "function"
      ? options.origin(request)
      : (options.origin ?? new URL(request.url).origin)

  const json = (
    status: number,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
        ...headers,
      },
    })
  const fail = (
    detail: TokenErrorDetail,
    status: number,
    headers?: Record<string, string>,
  ) =>
    json(
      status,
      { error: detail },
      { "x-token-error": detail.code, ...headers },
    )

  return async (request) => {
    try {
      const url = new URL(request.url)
      let path = url.pathname
      if (path.startsWith(basePath)) path = path.slice(basePath.length)
      else {
        // Mounted somewhere else (a rewrite): find the first operation name.
        const parts = path.split("/").filter(Boolean)
        const at = parts.findIndex((p) => p in routes)
        path = at < 0 ? "" : "/" + parts.slice(at).join("/")
      }
      const segments = path.split("/").filter(Boolean)
      const route =
        segments[0] && Object.hasOwn(routes, segments[0])
          ? routes[segments[0]]
          : undefined
      if (!route)
        return fail({ code: "not_found", message: "No such endpoint." }, 404)
      const handler = route[request.method]
      if (!handler)
        return fail(
          { code: "invalid_request", message: "Method not allowed." },
          405,
          {
            allow: Object.keys(route).join(", "),
          },
        )

      const user = await options.userOf(request)
      if (!user?.id)
        return fail(
          { code: "unauthenticated", message: "Sign in to continue." },
          401,
        )

      if (options.syncUser !== false && (user.email || user.displayName)) {
        const stamp = `${user.email ?? ""}\n${user.displayName ?? ""}`
        if (synced.get(user.id) !== stamp) {
          try {
            await center.upsertUser(user.id, {
              ...(user.email ? { email: user.email } : {}),
              ...(user.displayName ? { displayName: user.displayName } : {}),
            })
            synced.set(user.id, stamp)
          } catch {
            // best effort: the next request tries again
          }
        }
      }

      const origin = originOf(request)
      const ctx: Ctx = {
        request,
        user,
        center,
        query: url.searchParams,
        segments,
        idempotencyKey: request.headers.get("idempotency-key") ?? undefined,
        body: async () => {
          let parsed: unknown
          try {
            parsed = await request.json()
          } catch {
            throw bad("Body is not JSON.")
          }
          if (
            typeof parsed !== "object" ||
            parsed === null ||
            Array.isArray(parsed)
          )
            throw bad("Body must be a JSON object.")
          return parsed as Record<string, unknown>
        },
        returnUrls: (kind, returnPath) => {
          const safe = safeReturnPath(returnPath)
          if (options.returnUrls)
            return options.returnUrls({
              request,
              kind,
              returnPath: safe,
              origin,
            })
          return kind === "checkout"
            ? {
                successUrl: `${origin}${withQuery(safe, "tokens=purchased&purchase={PURCHASE_ID}")}`,
                cancelUrl: `${origin}${withQuery(safe, "tokens=cancelled")}`,
              }
            : {
                successUrl: `${origin}${withQuery(safe, "tokens=card")}`,
                cancelUrl: `${origin}${withQuery(safe, "tokens=cancelled")}`,
              }
        },
      }
      const out = await handler(ctx)
      if (out === undefined)
        return fail({ code: "not_found", message: "No such endpoint." }, 404)
      if (out instanceof Response) return out
      return json(200, out)
    } catch (error) {
      if (isTokenError(error)) {
        const headers: Record<string, string> = {}
        if (error.detail.retryAfterSeconds)
          headers["retry-after"] = String(error.detail.retryAfterSeconds)
        return fail(error.detail, error.status, headers)
      }
      console.error("[tokens] route failed", error)
      return fail(
        { code: "internal_error", message: "Something went wrong." },
        500,
      )
    }
  }
}
