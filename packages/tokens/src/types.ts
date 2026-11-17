/**
 * Token Center contract types, contract version 1.
 *
 * The single source of truth shared by the center and `@kaperkunde/tokens` (each carries a copy). openapi.yaml says the same thing
 * over HTTP; if the two ever disagree, this file wins and openapi.yaml is fixed.
 *
 * Conventions:
 * - Money is integer **micro-dollars** (`Micros`, 1 USD = 1_000_000). JSON carries it as a
 *   number (safe up to 9e15, i.e. $9bn). Never floats for balances.
 * - Fiat amounts for Stripe are integer **cents** in the named currency.
 * - Times are ISO 8601 strings in UTC (`2026-12-01T00:00:00.000Z`).
 * - `userId` is always the **app's own user id** (opaque string, 1..128 chars). The center never
 *   sees one app's users from another app (`appId` comes from the key, never from the body).
 */

export const CONTRACT_VERSION = 1 as const

/** Integer micro-dollars. */
export type Micros = number
/** Integer cents of a currency. */
export type Cents = number
export type IsoTime = string

// ---------------------------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------------------------

/**
 * Header names (lower case; HTTP is case-insensitive). Request values that carry user text --
 * `x-token-user`, `x-token-email` and every attribution header -- are
 * `encodeURIComponent`-encoded by the client (the package always encodes them) and decoded by
 * the center (a value that is not valid percent-encoding is taken as it is). A decoded
 * attribution value is at most 200 characters, longer is cut; a decoded user id is 1..128.
 */
export const TOKEN_HEADERS = {
  // --- request: who to charge (gateway: `user` required) ---
  /** The app's user id, URI-encoded. Required on every gateway request. */
  user: "x-token-user",
  /** The user's **verified** email, URI-encoded. Optional; stored/updated on the center's user row. */
  email: "x-token-email",
  // --- request: attribution, stored on the call, never interpreted ---
  /** What the call is for, a small closed set per app (e.g. storyteller, player, voice). */
  purpose: "x-token-purpose",
  /** A human line ("Telling Ash"). */
  activity: "x-token-activity",
  /** The app's grouping (e.g. a party or a world id). */
  scope: "x-token-scope",
  /** The app's job id (a job id in the app's own queue). */
  job: "x-token-job",
  /** What the call is about (e.g. a character or chapter id). */
  subject: "x-token-subject",
  /** Groups several gateway requests into one app-level call (the app's own ledger row id). */
  correlation: "x-token-correlation",
  // --- request: routing ---
  /** `tokens` (default) or `own`. `own` sends a chat-completions request to the user's own endpoint. */
  backend: "x-token-backend",
  /** `event`: append a final `event: token_center` SSE event carrying the CallCharge. Off by default. */
  trailer: "x-token-trailer",
  /** Idempotency for app API POSTs that create something (checkout, card setup). */
  idempotencyKey: "idempotency-key",

  // --- response (gateway) ---
  callId: "x-token-call-id",
  /** `tokens` | `own` */
  source: "x-token-source",
  /** The model that actually ran (may differ from the requested one on `own`). */
  model: "x-token-model",
  /** Provider cost of the call at the price in force, micros. Absent on streams (use GET /api/v1/calls/:id or the trailer). */
  costMicros: "x-token-cost-micros",
  /** Fee charged on the purchased portion, micros. */
  feeMicros: "x-token-fee-micros",
  /** What the call came to, cost + fee, micros (the wallet lost this less any absorbed shortfall). */
  chargedMicros: "x-token-charged-micros",
  /** Total spendable after the charge (all lots, all providers), micros. */
  balanceMicros: "x-token-balance-micros",
  /** Characters metered on a speech call. */
  chars: "x-token-chars",
  /** On every error response: the stable ErrorCode. */
  error: "x-token-error",
  /** Rate limited / in-flight cap: seconds to wait (standard header). */
  retryAfter: "retry-after",

  // --- webhooks (center -> app) ---
  /** `t=<unix seconds>,v1=<hex HMAC-SHA256(secret, `${t}.${rawBody}`)>` */
  signature: "token-signature",
  eventId: "token-event-id",
} as const

/** The keys the gateway accepts for the app key: Anthropic SDKs send `x-api-key`, OpenAI SDKs `authorization: Bearer`. */
export const APP_KEY_HEADERS = ["x-api-key", "authorization"] as const

/** App key format: `tk_<live|test>_<keyId 12 chars>_<secret 40 chars base62>`. Only sha256(secret) is stored. */
export const APP_KEY_PATTERN =
  /^tk_(live|test)_[A-Za-z0-9]{12}_[A-Za-z0-9]{40}$/

/** Webhook signature tolerance. */
export const WEBHOOK_TOLERANCE_SECONDS = 300

// ---------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------

export const ERROR_CODES = [
  "unauthenticated", // 401 missing/unknown/revoked app key
  "forbidden", // 403 app disabled, or resource of another app
  "invalid_request", // 400 body/header shape wrong (details.path)
  "unknown_user", // 404 app API: user never seen and the op needs one (e.g. GET a call of nobody)
  "not_found", // 404 call, purchase, endpoint
  "unknown_model", // 404 model id not on the center (or not on the user's own endpoint)
  "model_not_priced", // 409 model known but no price in force: refused, never run free
  "wrong_protocol", // 400 e.g. a Claude model on /v1/chat/completions, an OpenAI model on /v1/messages
  "insufficient_balance", // 402 nothing spendable for this provider (available <= 0)
  "capability_unavailable", // 402 own endpoint lacks a capability AND tokens cannot cover it (details.capability)
  "byo_not_configured", // 409 backend=own but the user has no own endpoint / order is tokens_only
  "byo_failed", // 502 the user's own endpoint failed (details.status); never charged
  "byo_limit_reached", // 402 own endpoint's monthly token limit reached and nothing to fall back to
  "provider_error", // 502 upstream provider failed (details.status, details.providerType)
  "provider_timeout", // 504 upstream did not answer in time
  "rate_limited", // 429 per-key/per-user rate, or the per-user in-flight cap (Retry-After)
  "payments_unavailable", // 503 Stripe not configured on the center
  "purchase_too_small", // 400 below the currency minimum (details.minimumCents)
  "no_card", // 409 auto-refill without a saved card
  "conflict", // 409 idempotency key reused with another body, etc.
  "center_unavailable", // 503 from the center, or synthesized by the SDK when it cannot reach it
  "internal_error", // 500
] as const
export type ErrorCode = (typeof ERROR_CODES)[number]

export const ERROR_STATUS: Record<ErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  invalid_request: 400,
  unknown_user: 404,
  not_found: 404,
  unknown_model: 404,
  model_not_priced: 409,
  wrong_protocol: 400,
  insufficient_balance: 402,
  capability_unavailable: 402,
  byo_not_configured: 409,
  byo_failed: 502,
  byo_limit_reached: 402,
  provider_error: 502,
  provider_timeout: 504,
  rate_limited: 429,
  payments_unavailable: 503,
  purchase_too_small: 400,
  no_card: 409,
  conflict: 409,
  center_unavailable: 503,
  internal_error: 500,
}

export type Capability = "tools" | "streaming" | "vision" | "json" | "voice"

export type TokenErrorDetail = {
  code: ErrorCode
  /** English sentence safe to show a user; never contains keys, provider bodies or other users. */
  message: string
  /** insufficient_balance / capability_unavailable: what the app should offer. */
  action?: "buy_tokens" | "configure_own" | "wait"
  capability?: Capability
  provider?: ProviderId
  minimumCents?: Cents
  retryAfterSeconds?: number
  /** Upstream HTTP status for provider_error / byo_failed. */
  status?: number
  /** invalid_request: JSON path of the offending field. */
  path?: string
  callId?: string
}

/** App API (`/api/v1/*`) error body. */
export type TokenErrorBody = { error: TokenErrorDetail }

/**
 * Gateway error bodies keep the provider's shape so provider SDKs parse them, plus
 * `token_center`. `x-token-error` header carries the code too.
 *  - /v1/messages:          { type: "error", error: { type, message }, token_center }
 *  - /v1/chat/completions:  { error: { message, type, code }, token_center }
 * A provider's own error (4xx from Anthropic/OpenAI) is passed through with its status and body,
 * and `token_center: { code: "provider_error", status }` added.
 */
export type GatewayAnthropicError = {
  type: "error"
  error: { type: string; message: string }
  token_center: TokenErrorDetail
}
export type GatewayOpenAIError = {
  error: { message: string; type: string; code: string | null }
  token_center: TokenErrorDetail
}

// ---------------------------------------------------------------------------------------------
// Shared vocabulary
// ---------------------------------------------------------------------------------------------

/** Providers the center talks to with its own keys. Airdrops/grants lock to one of these. */
export type ProviderId = "anthropic" | "openai" | "elevenlabs"
export type Protocol = "anthropic" | "openai"
export type Source = "tokens" | "own"
/** Per user, as apps with a bring-your-own model have it. Default for a user with an own endpoint: own_then_tokens. */
export type BackendOrder =
  "tokens_then_own" | "own_then_tokens" | "tokens_only" | "own_only"
export type Currency = "eur" | "usd"

export type Attribution = {
  purpose?: string
  activity?: string
  scope?: string
  job?: string
  subject?: string
  correlation?: string
}

// ---------------------------------------------------------------------------------------------
// Balance
// ---------------------------------------------------------------------------------------------

/** A restricted bucket: an airdrop share or an admin grant. Fee-free, always locked to one provider. */
export type GrantLot = {
  id: string
  kind: "airdrop" | "grant"
  /** The one provider this lot pays for (airdrops and grants alike; there is no "any provider" lot). */
  provider: ProviderId
  grantedMicros: Micros
  spentMicros: Micros
  remainingMicros: Micros
  expiresAt: IsoTime | null
  /** Admin's reason/note, shown to the user only if the app chooses to. */
  reason: string | null
  createdAt: IsoTime
}

export type BalanceSummary = {
  /** Everything spendable now on some provider: unexpired lots + purchased. May be <= 0. */
  availableMicros: Micros
  /** General purchased credit. Never negative: a shortfall is absorbed by the center (README "Shortfall"). */
  purchasedMicros: Micros
  /** Sum of unexpired lot remainders. */
  grantsMicros: Micros
}

export type Balance = BalanceSummary & {
  userId: string
  /** Whether the center has seen this user yet (false → all zeros). */
  known: boolean
  /** Spendable per provider: lots locked to it + purchased. */
  byProvider: Record<ProviderId, Micros>
  lots: GrantLot[]
  /** Earliest expiry among lots with something left. */
  nextExpiry: { at: IsoTime; micros: Micros } | null
  /** The app's display unit (e.g. "credits" at 1_000_000 per dollar). */
  unit: AppUnit
  /** Fee now in force, basis points (2000 = 20%), for "a token buys less than a dollar of model" copy. */
  feeBps: number
  autoRefill: { enabled: boolean; pending: boolean } | null
}

export type AppUnit = { one: string; many: string; perDollar: number }

// ---------------------------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------------------------

export type UpsertUserRequest = {
  /** Verified email only. */
  email?: string | null
  displayName?: string | null
}
export type AppUser = {
  userId: string
  email: string | null
  displayName: string | null
  createdAt: IsoTime
  lastSeenAt: IsoTime | null
}

// ---------------------------------------------------------------------------------------------
// Calls (the ledger)
// ---------------------------------------------------------------------------------------------

export type CallUsage = {
  /** The whole prompt, cache included (Anthropic: input + cache_read + cache_creation). */
  inputTokens: number
  outputTokens: number
  /** Part of inputTokens served from cache. */
  cacheReadTokens: number
  /** Part of inputTokens written to cache (5m + 1h). */
  cacheWriteTokens: number
  /** Part of cacheWriteTokens kept an hour. */
  cacheWrite1hTokens: number
  /** Part of cacheWriteTokens kept five minutes (cacheWriteTokens - cacheWrite1hTokens). The center always fills it. */
  cacheWrite5mTokens?: number
  reasoningTokens?: number
  totalTokens: number
  /** Non-token units: speech is metered in characters. */
  units?: { tts_chars?: number }
  inferenceGeo?: string
  speed?: string
  serviceTier?: string
}

export type CallStatus = "admitted" | "charged" | "failed" | "lost"
export type CallEndpoint = "messages" | "chat_completions" | "speech"

/** What a finished call took. Also the trailer event's data. */
export type CallCharge = {
  callId: string
  status: CallStatus
  source: Source
  model: string
  usage: CallUsage
  costMicros: Micros
  feeMicros: Micros
  /** cost + fee: what the call came to. */
  chargedMicros: Micros
  /** Taken from lots (fee-free). */
  fromGrantsMicros: Micros
  /** Asked of purchased, fee included. */
  fromPurchasedMicros: Micros
  /**
   * Part of fromPurchasedMicros the user did not have, written off by the center as house loss
   * (purchased stops at zero). What the wallet actually lost is chargedMicros - shortfallMicros.
   */
  shortfallMicros: Micros
  balanceAfterMicros: Micros
  /**
   * Present and true when the usage was estimated because the provider's final usage never
   * arrived (a stream cut short, an answer that broke off): the prompt from what the provider
   * reported or the request's size, the answer from the text relayed, or max_tokens at worst.
   */
  estimated?: boolean
}

/**
 * The charge as a non-streamed gateway response's headers carry it (`x-token-call-id`,
 * `-source`, `-model`, `-cost-micros`, `-fee-micros`, `-charged-micros`, `-balance-micros`):
 * what `chargeFromHeaders` in `@kaperkunde/tokens/server` returns. For the full `CallCharge`
 * (usage, the split between lots and purchased, the shortfall) read `GET /api/v1/calls/:id`.
 */
export type HeaderCharge = Pick<
  CallCharge,
  | "callId"
  | "source"
  | "model"
  | "costMicros"
  | "feeMicros"
  | "chargedMicros"
  | "balanceAfterMicros"
>

/** A call as the app API answers it: always keyed `callId` (there is no `id` field). */
export type CallRecord = CallCharge & {
  userId: string
  endpoint: CallEndpoint
  provider: ProviderId | "own"
  requestedModel: string
  stream: boolean
  attribution: Attribution
  /** For own calls: the user's endpoint host (never the key). */
  ownHost?: string
  error: TokenErrorDetail | null
  createdAt: IsoTime
  finishedAt: IsoTime | null
  latencyMs: number | null
}

export type CallsQuery = {
  limit?: number // 1..200, default 50
  cursor?: string
  since?: IsoTime
  scope?: string
  job?: string
  correlation?: string
  purpose?: string
  source?: Source
}
export type CallsPage = {
  calls: CallRecord[]
  nextCursor: string | null
  /** Sums over the whole filter, not just the page. */
  totals: {
    count: number
    costMicros: Micros
    feeMicros: Micros
    chargedMicros: Micros
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
    /** Of cacheWriteTokens, kept five minutes / an hour. The center always fills both. */
    cacheWrite5mTokens?: number
    cacheWrite1hTokens?: number
    totalTokens: number
  }
}

// ---------------------------------------------------------------------------------------------
// Routing (which backend a call should use)
// ---------------------------------------------------------------------------------------------

export type RouteRequest = {
  userId: string
  /** The center model id the app would use on tokens (its role's model). */
  model: string
  /** What the call needs; an own endpoint lacking one falls back to tokens. */
  needs?: Capability[]
}

export type RouteDecision = {
  source: Source
  /** `anthropic` → use /v1/messages; `openai` → /v1/chat/completions. Own is always `openai`. */
  protocol: Protocol
  /** The model to send: the requested one, or on `own` the requested one if listed there, else the endpoint's default. */
  model: string
  /** Value for x-token-backend. */
  backend: Source
  /** Set when the user's order was not followed as written. */
  fallback: null | {
    reason: "capability" | "own_limit" | "own_unusable" | "no_balance"
    capability?: Capability
  }
  availableMicros: Micros
}

// ---------------------------------------------------------------------------------------------
// Models, prices, voices
// ---------------------------------------------------------------------------------------------

export type ModelPrice = {
  /** USD per million tokens. Decimal strings to keep sub-cent precision exact ("3", "0.30"). */
  inputUsdPerM: string
  outputUsdPerM: string
  cacheReadUsdPerM: string
  cacheWriteUsdPerM: string
  cacheWrite1hUsdPerM: string
  longPromptTokens: number | null
  longPromptFactor: string | null
  fastFactor: string | null
  effectiveFrom: IsoTime
}

export type ModelInfo = {
  id: string
  displayName: string
  provider: ProviderId
  protocol: Protocol
  capabilities: Capability[]
  contextTokens: number | null
  /** Always present: unpriced models are not listed (and are refused). */
  price: ModelPrice
}

export type VoiceInfo = {
  id: string
  name: string
  provider: ProviderId
  /** USD per million characters. */
  usdPerMChars: string
  /** The app's default voice, used when a speech request names none. */
  isDefault: boolean
}

/**
 * What an app lets its users buy (set per app on the center): suggested packs, whether only
 * the packs may be bought, and the bounds checkout enforces. Amounts are cents of whichever
 * currency the user pays in (e.g. packs [500, 1000, 2500, 5000] with packsOnly true).
 */
export type PurchaseOptions = {
  packsCents: Cents[]
  packsOnly: boolean
  /** The larger of the app's own minimum and the sale price's (500 by default). */
  minimumCents: Cents
  maximumCents: Cents
}

export type AppInfo = {
  id: string
  name: string
  unit: AppUnit
  purchaseOptions: PurchaseOptions
  feeBps: number
  lowBalanceMicros: Micros
  maxInFlightPerUser: number
  livemode: boolean
  /** Origins checkout/card success and cancel URLs must start with. */
  returnOrigins: string[]
}

// ---------------------------------------------------------------------------------------------
// Purchases, auto-refill, card
// ---------------------------------------------------------------------------------------------

export type SalePrice = {
  currency: Currency
  /** Cents that buy one dollar of credit (1_000_000 micros). EUR includes VAT; USD is before sales tax. */
  centsPerDollar: number
  taxBehavior: "inclusive" | "exclusive"
  minimumCents: Cents
  effectiveFrom: IsoTime
}
export type SalePrices = {
  prices: SalePrice[]
  feeBps: number
  paymentsAvailable: boolean
  /** This app's packs and bounds; checkout refuses an amount outside them. */
  options: PurchaseOptions
}

export type CheckoutRequest = {
  currency: Currency
  /**
   * Within the app's PurchaseOptions: below `minimumCents` is `purchase_too_small`; above
   * `maximumCents`, or not one of `packsCents` when `packsOnly`, is `invalid_request` (path
   * `amountCents`).
   */
  amountCents: Cents
  /** Must start with one of the app's returnOrigins. `{PURCHASE_ID}` is substituted. */
  successUrl: string
  cancelUrl: string
  /** Save the card for auto-refill (setup_future_usage off_session). */
  saveCard?: boolean
  locale?: string
}
export type CheckoutSession = {
  purchaseId: string
  /**
   * Where to send the browser: the center's own start page (`/checkout/<purchaseId>`), which
   * redirects to Stripe Checkout, and to which Stripe returns before the center sends the
   * browser on to `successUrl` / `cancelUrl`.
   */
  url: string
  expiresAt: IsoTime
  /** Micros the purchase will credit, worked out at the price in force now. */
  creditMicros: Micros
}

export type PurchaseStatus = "open" | "paid" | "failed" | "expired"
export type Purchase = {
  id: string
  kind: "checkout" | "refill"
  status: PurchaseStatus
  currency: Currency
  amountCents: Cents
  taxCents: Cents | null
  totalCents: Cents | null
  creditMicros: Micros
  failure: string | null
  createdAt: IsoTime
  paidAt: IsoTime | null
}

export type AutoRefill = {
  enabled: boolean
  /** Refill when a charge that took from purchased leaves purchased below this. */
  thresholdMicros: Micros
  amountCents: Cents
  currency: Currency
  /** Cap per calendar month (UTC), counted at amountCents before US sales tax. */
  monthlyMaxCents: Cents
  card: { label: string } | null
  pending: boolean
  failedAt: IsoTime | null
}
/** The only fields `PUT autorefill` accepts; anything else (a card, a payment method) is `invalid_request`. */
export type AutoRefillInput = Pick<
  AutoRefill,
  "enabled" | "thresholdMicros" | "amountCents" | "currency" | "monthlyMaxCents"
>

export type CardSetupRequest = {
  successUrl: string
  cancelUrl: string
  currency?: Currency
}
export type CardSetupSession = { url: string; expiresAt: IsoTime }

// ---------------------------------------------------------------------------------------------
// Bring your own endpoint (one per user)
// ---------------------------------------------------------------------------------------------

/**
 * How the center treats `tool_choice` when proxying to the user's endpoint (an app's
 * own-key setting): `auto` passes the request through as sent; `required` turns a request
 * that carries `tools` with `tool_choice` absent or "auto" into `tool_choice: "required"`, for
 * endpoints whose models only call a tool when told to.
 */
export type ToolChoice = "auto" | "required"

export type OwnEndpoint = {
  /** https, OpenAI-compatible, ending before /chat/completions (e.g. https://openrouter.ai/api/v1). */
  baseUrl: string
  hasKey: boolean
  /** Last 4 characters of the key, for "sk-…a1b2". */
  keyHint: string | null
  models: string[]
  defaultModel: string
  capabilities: Capability[]
  toolChoice: ToolChoice
  /** Tokens per calendar month (UTC); null = no limit. */
  monthlyTokenLimit: number | null
  usedThisMonth: number
  periodEndsAt: IsoTime
  order: BackendOrder
  lastTest: OwnEndpointTest | null
}
export type OwnEndpointInput = {
  baseUrl: string
  /** Omit to keep the stored key; null to remove it. Write-only: never returned. */
  apiKey?: string | null
  models: string[]
  defaultModel?: string
  capabilities: Capability[]
  /** Omitted: "auto". */
  toolChoice?: ToolChoice
  monthlyTokenLimit: number | null
  order: BackendOrder
}

/** GET own-endpoint answers 200 with the JSON `null` for a user with none (never 404). */
export type OwnEndpointResponse = OwnEndpoint | null
export type OwnEndpointTest = {
  ok: boolean
  at: IsoTime
  latencyMs: number | null
  /** Models the endpoint's GET /models listed, where it has one. */
  models: string[] | null
  error: { code: "byo_failed"; message: string; status?: number } | null
}
/** Set just the order (also for users with no own endpoint: only tokens_only is then accepted). */
export type BackendOrderInput = { order: BackendOrder }

// ---------------------------------------------------------------------------------------------
// History (money in and out of the wallet other than calls)
// ---------------------------------------------------------------------------------------------

export type HistoryEntry =
  | { type: "purchase"; at: IsoTime; purchase: Purchase }
  | { type: "grant"; at: IsoTime; lot: GrantLot }
  | { type: "expiry"; at: IsoTime; lotId: string; expiredMicros: Micros }
  | { type: "adjustment"; at: IsoTime; micros: Micros; reason: string }
export type HistoryPage = { entries: HistoryEntry[]; nextCursor: string | null }

// ---------------------------------------------------------------------------------------------
// Gateway request bodies (subset the center reads; everything else passes through untouched)
// ---------------------------------------------------------------------------------------------

/** POST /v1/messages: Anthropic Messages API, passed through byte-for-byte except `model` is checked. */
export type AnthropicMessagesRequest = {
  model: string
  max_tokens: number
  stream?: boolean
  [key: string]: unknown
}
/** POST /v1/chat/completions: OpenAI Chat Completions. On streams the center forces stream_options.include_usage. */
export type ChatCompletionsRequest = {
  model: string
  stream?: boolean
  stream_options?: { include_usage?: boolean }
  tools?: unknown[]
  [key: string]: unknown
}
/** POST /v1/audio/speech: OpenAI speech shape. Returns audio bytes. */
export type SpeechRequest = {
  /** Text, 1..4096 characters; metered per character (Unicode code points). */
  input: string
  /** A center voice id (GET /api/v1/voices); omitted = the app's default voice. */
  voice?: string
  /** Ignored unless the voice allows a choice; the voice carries its provider model. */
  model?: string
  response_format?: "mp3" | "opus" | "wav"
  speed?: number
}

/** GET /v1/models: one list both SDK families can read. */
export type GatewayModelList = {
  object: "list"
  data: Array<{
    id: string
    object: "model"
    type: "model"
    display_name: string
    created: number
    created_at: IsoTime
    owned_by: ProviderId | "own"
  }>
  has_more: false
  first_id: string | null
  last_id: string | null
}

// ---------------------------------------------------------------------------------------------
// Webhooks (center -> app)
// ---------------------------------------------------------------------------------------------

export type WebhookEnvelope<TYPE extends string, DATA> = {
  /** `evt_…`, unique; deliveries of one event share it. Dedupe on it. */
  id: string
  type: TYPE
  createdAt: IsoTime
  appId: string
  livemode: boolean
  data: DATA
}

export type GrantReceivedEvent = WebhookEnvelope<
  "grant.received",
  {
    userId: string
    source: "airdrop" | "grant"
    lot: GrantLot
    /** Airdrop id when source = airdrop. */
    airdropId: string | null
    balance: BalanceSummary
  }
>
export type PurchaseCompletedEvent = WebhookEnvelope<
  "purchase.completed",
  { userId: string; purchase: Purchase; balance: BalanceSummary }
>
/** A charge or expiry took availableMicros from >= app.lowBalanceMicros to below it (once per crossing). */
export type BalanceLowEvent = WebhookEnvelope<
  "balance.low",
  { userId: string; thresholdMicros: Micros; balance: BalanceSummary }
>
/** availableMicros went to <= 0 (once per crossing). Apps pause work. */
export type BalanceEmptyEvent = WebhookEnvelope<
  "balance.empty",
  { userId: string; balance: BalanceSummary }
>
/** An off-session refill failed; auto-refill has been turned off. */
export type AutoRefillFailedEvent = WebhookEnvelope<
  "autorefill.failed",
  { userId: string; purchaseId: string | null; reason: string }
>
/** A lot passed its expiry with something left. */
export type GrantExpiredEvent = WebhookEnvelope<
  "grant.expired",
  {
    userId: string
    lot: GrantLot
    expiredMicros: Micros
    balance: BalanceSummary
  }
>

export type WebhookEvent =
  | GrantReceivedEvent
  | PurchaseCompletedEvent
  | BalanceLowEvent
  | BalanceEmptyEvent
  | AutoRefillFailedEvent
  | GrantExpiredEvent
export type WebhookEventType = WebhookEvent["type"]

export const WEBHOOK_EVENT_TYPES: readonly WebhookEventType[] = [
  "grant.received",
  "purchase.completed",
  "balance.low",
  "balance.empty",
  "autorefill.failed",
  "grant.expired",
]

/** Retry schedule after a non-2xx or a timeout (10 s): then the delivery is dead (admin may replay). */
export const WEBHOOK_RETRY_SECONDS = [
  60, 300, 1800, 7200, 21600, 43200, 86400,
] as const
