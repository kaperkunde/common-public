import { centerUnavailable, errorFromResponse, isTokenError } from "./errors"
import type {
  AppInfo,
  AutoRefill,
  AutoRefillInput,
  Balance,
  BackendOrder,
  CallsPage,
  CallsQuery,
  CardSetupSession,
  CheckoutSession,
  Currency,
  Cents,
  HistoryPage,
  ModelInfo,
  OwnEndpoint,
  OwnEndpointInput,
  OwnEndpointResponse,
  OwnEndpointTest,
  Purchase,
  SalePrices,
} from "./types"

/** What the browser sends to `POST <base>/checkout`. The app adds the user and the return URLs. */
export type CheckoutInput = {
  currency: Currency
  amountCents: Cents
  /** Save the card for auto-refill. */
  saveCard?: boolean
  locale?: string
  /** A path on the app's own origin to come back to (default `/`). */
  returnPath?: string
}

/** What the browser sends to `POST <base>/card`. */
export type CardInput = { currency?: Currency; returnPath?: string }

/**
 * The browser's client for the routes an app mounts with `tokenRoutes` from
 * `@kaperkunde/tokens/server` (default base `/api/tokens`). It carries the
 * session cookie only: the app key never reaches a browser. Every method
 * throws a `TokenCenterError` (a network failure is `center_unavailable`).
 */
export type TokenApi = {
  app(): Promise<AppInfo>
  models(): Promise<ModelInfo[]>
  balance(): Promise<Balance>
  calls(query?: CallsQuery): Promise<CallsPage>
  history(query?: { limit?: number; cursor?: string }): Promise<HistoryPage>
  salePrices(): Promise<SalePrices>
  purchase(id: string): Promise<Purchase>
  /** Opens Stripe Checkout; send the browser to `url`. */
  checkout(
    input: CheckoutInput,
    idempotencyKey?: string,
  ): Promise<CheckoutSession>
  autoRefill(): Promise<AutoRefill>
  setAutoRefill(input: AutoRefillInput): Promise<AutoRefill>
  /** Opens Stripe in setup mode to save a card; send the browser to `url`. */
  setupCard(
    input?: CardInput,
    idempotencyKey?: string,
  ): Promise<CardSetupSession>
  removeCard(): Promise<void>
  /** `null` when the user has saved none. */
  ownEndpoint(): Promise<OwnEndpointResponse>
  saveOwnEndpoint(input: OwnEndpointInput): Promise<OwnEndpoint>
  removeOwnEndpoint(): Promise<void>
  testOwnEndpoint(): Promise<OwnEndpointTest>
  setBackendOrder(order: BackendOrder): Promise<{ order: BackendOrder }>
}

export type TokenApiOptions = {
  basePath?: string
  fetch?: typeof fetch
  /** Extra headers on every request (a CSRF token, say). */
  headers?: Record<string, string>
}

export function createTokenApi(options: TokenApiOptions = {}): TokenApi {
  const base = (options.basePath ?? "/api/tokens").replace(/\/+$/, "")

  async function send<T>(
    method: string,
    path: string,
    init: {
      query?: Record<string, unknown>
      body?: unknown
      idempotencyKey?: string
    } = {},
  ): Promise<T> {
    const search = new URLSearchParams()
    for (const [k, v] of Object.entries(init.query ?? {}))
      if (v !== undefined && v !== null && v !== "") search.set(k, String(v))
    const url = `${base}/${path}${search.size ? `?${search}` : ""}`
    const headers: Record<string, string> = {
      accept: "application/json",
      ...options.headers,
    }
    if (init.body !== undefined) headers["content-type"] = "application/json"
    if (init.idempotencyKey) headers["idempotency-key"] = init.idempotencyKey
    let response: Response
    try {
      response = await (options.fetch ?? fetch)(url, {
        method,
        headers,
        credentials: "same-origin",
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      })
    } catch (cause) {
      throw centerUnavailable(cause, "Could not reach the server.")
    }
    if (response.status === 204) return undefined as T
    let body: unknown = null
    let readable = true
    try {
      body = await response.json()
    } catch {
      readable = false
    }
    if (!response.ok)
      throw errorFromResponse(response.status, body, {
        code: response.headers.get("x-token-error"),
        retryAfter: response.headers.get("retry-after"),
        callId: response.headers.get("x-token-call-id"),
      })
    if (!readable)
      throw centerUnavailable(
        undefined,
        "The server answered nothing readable.",
      )
    return body as T
  }

  return {
    app: () => send("GET", "app"),
    models: async () =>
      (await send<{ models: ModelInfo[] }>("GET", "models")).models,
    balance: () => send("GET", "balance"),
    calls: (query) => send("GET", "calls", { query }),
    history: (query) => send("GET", "history", { query }),
    salePrices: () => send("GET", "sale-prices"),
    purchase: (id) => send("GET", `purchase/${encodeURIComponent(id)}`),
    checkout: (input, idempotencyKey) =>
      send("POST", "checkout", { body: input, idempotencyKey }),
    autoRefill: () => send("GET", "autorefill"),
    setAutoRefill: (input) => send("PUT", "autorefill", { body: input }),
    setupCard: (input, idempotencyKey) =>
      send("POST", "card", { body: input ?? {}, idempotencyKey }),
    removeCard: () => send("DELETE", "card"),
    ownEndpoint: async () => {
      try {
        // 200 with null when none is saved (an older center answered 404).
        return await send<OwnEndpointResponse>("GET", "own-endpoint")
      } catch (error) {
        if (isTokenError(error, "not_found")) return null
        throw error
      }
    },
    saveOwnEndpoint: (input) => send("PUT", "own-endpoint", { body: input }),
    removeOwnEndpoint: () => send("DELETE", "own-endpoint"),
    testOwnEndpoint: () => send("POST", "own-endpoint/test"),
    setBackendOrder: (order) =>
      send("PUT", "backend-order", { body: { order } }),
  }
}
