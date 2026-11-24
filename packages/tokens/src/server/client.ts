import { centerUnavailable, errorFromResponse } from "../errors"
import {
  chargeFromHeaders,
  gatewayHeaders,
  trimBaseUrl,
  voiceFallbackFromHeaders,
} from "./gateway"
import type {
  AppInfo,
  AppUser,
  Attribution,
  AutoRefill,
  AutoRefillInput,
  Balance,
  BackendOrderInput,
  CallRecord,
  CallsPage,
  CallsQuery,
  CardSetupRequest,
  CardSetupSession,
  CheckoutRequest,
  CheckoutSession,
  HeaderCharge,
  HistoryPage,
  ModelInfo,
  OwnEndpoint,
  OwnEndpointInput,
  OwnEndpointResponse,
  OwnEndpointTest,
  Purchase,
  PurchasesPage,
  Refund,
  RefundRequest,
  RouteDecision,
  RouteRequest,
  SalePrices,
  SpeechRequest,
  UpsertUserRequest,
  VoiceInfo,
} from "../types"

export type TokenCenterOptions = {
  /** The center, e.g. `https://tokens.example.com` (configuration: nothing here knows it). */
  baseUrl: string
  /** The app key `tk_<live|test>_<keyId>_<secret>`. Server side only. */
  apiKey: string
  fetch?: typeof fetch
  /** Per request; default 10 s. A `wait` on a call lengthens that request's. */
  timeoutMs?: number
}

export type CallsFilter = CallsQuery & { userId?: string }

export type SpeechResult = {
  audio: Uint8Array
  contentType: string
  /** What the call took, from the response headers. */
  charge: HeaderCharge | null
  /** Characters metered. */
  chars: number | null
  /** The voice that actually spoke, when the center used another than the one asked for (`x-token-voice-fallback`). */
  voiceFallback: string | null
}

type RequestInit2 = {
  query?: object
  body?: unknown
  headers?: Record<string, string>
  timeoutMs?: number
}

/** Every `/api/v1` path as a typed method. See {@link createTokenCenter}. */
export type TokenCenter = ReturnType<typeof createTokenCenter>

/**
 * The app-API client. Fetch-based, one timeout per request, and every
 * failure a `TokenCenterError`: an answer with an error body keeps the
 * contract's code; no answer at all (refused, DNS, timeout, a 5xx with no
 * body) is `center_unavailable`, which an app treats as **fail closed**.
 */
export function createTokenCenter(options: TokenCenterOptions) {
  const base = trimBaseUrl(options.baseUrl)
  const doFetch = options.fetch ?? fetch
  const defaultTimeout = options.timeoutMs ?? 10_000
  if (!options.apiKey) throw new Error("createTokenCenter: apiKey is required.")

  const authHeaders = { authorization: `Bearer ${options.apiKey}` }

  async function raw(
    method: string,
    path: string,
    init: RequestInit2 = {},
  ): Promise<Response> {
    const search = new URLSearchParams()
    for (const [k, v] of Object.entries(init.query ?? {}))
      if (v !== undefined && v !== null && v !== "") search.set(k, String(v))
    const url = `${base}${path}${search.size ? `?${search}` : ""}`
    const headers: Record<string, string> = {
      accept: "application/json",
      ...authHeaders,
      ...init.headers,
    }
    let body: string | undefined
    if (init.body !== undefined) {
      body = JSON.stringify(init.body)
      headers["content-type"] = "application/json"
    }
    try {
      return await doFetch(url, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(init.timeoutMs ?? defaultTimeout),
      })
    } catch (cause) {
      const timedOut =
        cause instanceof Error &&
        (cause.name === "TimeoutError" || cause.name === "AbortError")
      throw centerUnavailable(
        cause,
        timedOut
          ? "The token center did not answer in time."
          : "The token center could not be reached.",
      )
    }
  }

  async function failure(response: Response): Promise<never> {
    let body: unknown = null
    try {
      body = await response.json()
    } catch {
      // no body: status decides
    }
    throw errorFromResponse(response.status, body, {
      code: response.headers.get("x-token-error"),
      retryAfter: response.headers.get("retry-after"),
      callId: response.headers.get("x-token-call-id"),
    })
  }

  async function json<T>(
    method: string,
    path: string,
    init?: RequestInit2,
  ): Promise<T> {
    const response = await raw(method, path, init)
    if (!response.ok) return failure(response)
    if (response.status === 204) return undefined as T
    try {
      return (await response.json()) as T
    } catch (cause) {
      throw centerUnavailable(
        cause,
        "The token center answered nothing readable.",
      )
    }
  }

  const user = (id: string) => {
    if (!id) throw new Error("userId is required.")
    return `/api/v1/users/${encodeURIComponent(id)}`
  }
  const idem = (key?: string) => (key ? { "idempotency-key": key } : undefined)

  return {
    baseUrl: base,

    // --- catalogue
    app: () => json<AppInfo>("GET", "/api/v1/app"),
    models: async () =>
      (await json<{ models: ModelInfo[] }>("GET", "/api/v1/models")).models,
    voices: async () =>
      (await json<{ voices: VoiceInfo[] }>("GET", "/api/v1/voices")).voices,
    salePrices: () => json<SalePrices>("GET", "/api/v1/sale-prices"),

    // --- routing
    /** Which backend (own endpoint or tokens) and model a call should use for this user. */
    route: (request: RouteRequest) =>
      json<RouteDecision>("POST", "/api/v1/route", { body: request }),

    // --- users and wallet
    upsertUser: (userId: string, request: UpsertUserRequest) =>
      json<AppUser>("PUT", user(userId), { body: request }),
    balance: (userId: string) =>
      json<Balance>("GET", `${user(userId)}/balance`),
    history: (
      userId: string,
      query: { limit?: number; cursor?: string } = {},
    ) => json<HistoryPage>("GET", `${user(userId)}/history`, { query }),

    // --- calls (the ledger)
    calls: (userId: string, query: CallsQuery = {}) =>
      json<CallsPage>("GET", `${user(userId)}/calls`, { query }),
    /** Across all of the app's users. */
    allCalls: (query: CallsFilter = {}) =>
      json<CallsPage>("GET", "/api/v1/calls", { query }),
    /**
     * One call. A streamed call's charge is known only once it ends: pass
     * `wait` (seconds, ≤ 30) to long-poll until it is no longer `admitted`.
     */
    call: (callId: string, options: { wait?: number } = {}) => {
      const wait = Math.max(0, Math.min(30, Math.floor(options.wait ?? 0)))
      return json<CallRecord>(
        "GET",
        `/api/v1/calls/${encodeURIComponent(callId)}`,
        {
          query: wait ? { wait } : undefined,
          timeoutMs: defaultTimeout + wait * 1000,
        },
      )
    },

    // --- payments
    checkout: (
      userId: string,
      request: CheckoutRequest,
      options: { idempotencyKey?: string } = {},
    ) =>
      json<CheckoutSession>("POST", `${user(userId)}/checkout`, {
        body: request,
        headers: idem(options.idempotencyKey),
      }),
    purchase: (userId: string, purchaseId: string) =>
      json<Purchase>(
        "GET",
        `${user(userId)}/purchases/${encodeURIComponent(purchaseId)}`,
      ),
    /**
     * The user's paid purchases, newest first, each with what of it is still refundable
     * (`refundableCreditMicros`, `refundableCents`) and what has been refunded.
     */
    purchases: (
      userId: string,
      query: { limit?: number; cursor?: string } = {},
    ) => json<PurchasesPage>("GET", `${user(userId)}/purchases`, { query }),
    /**
     * Refund bought credit that is still unspent, to the card it was paid with. Omit
     * `creditMicros` for all of it. `idempotencyKey` is the caller's and required: it is what
     * makes a retry after a timeout the same refund rather than a second one. Answers the
     * `Refund` (201 settled, 202 `pending`); a refusal is a `TokenCenterError` of
     * `refund_not_available`, `refund_amount_invalid` (both with `refundableCreditMicros`) or
     * `refund_refused_by_processor`.
     */
    refund: (
      userId: string,
      purchaseId: string,
      request: RefundRequest,
      options: { idempotencyKey: string },
    ) => {
      if (!purchaseId) throw new Error("purchaseId is required.")
      if (!options?.idempotencyKey)
        throw new Error("refund: an idempotencyKey is required.")
      return json<Refund>(
        "POST",
        `${user(userId)}/purchases/${encodeURIComponent(purchaseId)}/refund`,
        {
          body: request,
          headers: idem(options.idempotencyKey),
          // Stripe is asked in the middle of it.
          timeoutMs: defaultTimeout + 20_000,
        },
      )
    },
    autoRefill: (userId: string) =>
      json<AutoRefill>("GET", `${user(userId)}/autorefill`),
    setAutoRefill: (userId: string, input: AutoRefillInput) =>
      json<AutoRefill>("PUT", `${user(userId)}/autorefill`, { body: input }),
    setupCard: (
      userId: string,
      request: CardSetupRequest,
      options: { idempotencyKey?: string } = {},
    ) =>
      json<CardSetupSession>("POST", `${user(userId)}/card`, {
        body: request,
        headers: idem(options.idempotencyKey),
      }),
    removeCard: (userId: string) =>
      json<void>("DELETE", `${user(userId)}/card`),

    // --- own endpoint
    /** The saved endpoint, or `null` (the center answers 404 `not_found`). */
    ownEndpoint: async (userId: string): Promise<OwnEndpointResponse> => {
      const response = await raw("GET", `${user(userId)}/own-endpoint`)
      // The center answers 200 with null; an older one answered 404.
      if (response.status === 404) return null
      if (!response.ok) return failure(response)
      return (await response.json()) as OwnEndpointResponse
    },
    saveOwnEndpoint: (userId: string, input: OwnEndpointInput) =>
      json<OwnEndpoint>("PUT", `${user(userId)}/own-endpoint`, { body: input }),
    removeOwnEndpoint: (userId: string) =>
      json<void>("DELETE", `${user(userId)}/own-endpoint`),
    testOwnEndpoint: (userId: string) =>
      json<OwnEndpointTest>("POST", `${user(userId)}/own-endpoint/test`),
    setBackendOrder: (userId: string, input: BackendOrderInput) =>
      json<BackendOrderInput>("PUT", `${user(userId)}/backend-order`, {
        body: input,
      }),

    // --- gateway: speech (the one gateway call that is not a provider SDK's)
    /** `POST /v1/audio/speech`: audio bytes plus what it cost, from the headers. */
    speech: async (
      who: { user: string; email?: string | null; attribution?: Attribution },
      request: SpeechRequest,
    ): Promise<SpeechResult> => {
      const response = await raw("POST", "/v1/audio/speech", {
        body: request,
        headers: gatewayHeaders({
          user: who.user,
          email: who.email,
          attribution: who.attribution,
        }),
      })
      if (!response.ok) return failure(response)
      const chars = Number(response.headers.get("x-token-chars"))
      return {
        audio: new Uint8Array(await response.arrayBuffer()),
        contentType: response.headers.get("content-type") ?? "audio/mpeg",
        charge: chargeFromHeaders(response.headers),
        chars: Number.isFinite(chars) && chars > 0 ? chars : null,
        voiceFallback: voiceFallbackFromHeaders(response.headers),
      }
    },
  }
}
