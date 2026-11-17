import { TOKEN_HEADERS } from "../types"
import type { Attribution, HeaderCharge, Source } from "../types"

export type GatewayHeaderInput = {
  /** The payer: the app's own user id. Required. */
  user: string
  /** The app's **verified** email for that user. */
  email?: string | null
  attribution?: Attribution
  /** `own` sends a chat-completions call to the user's own endpoint. Default `tokens`. */
  backend?: Source
  /** `true`: append a final `event: token_center` SSE event carrying the charge. */
  trailer?: boolean
}

/** `https://center/` and `https://center/v1` both mean `https://center`. */
export const trimBaseUrl = (baseUrl: string): string =>
  baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "")

const enc = (value: string) => encodeURIComponent(value.slice(0, 200))

/**
 * The `x-token-*` request headers: who pays and what the call is for. Values
 * are `encodeURIComponent`-encoded (an activity line names characters) and cut
 * to 200 characters, as the center decodes them. Merge per call into the AI
 * SDK's `headers` option; the app key rides on the provider, not here.
 */
export function gatewayHeaders(
  input: GatewayHeaderInput,
): Record<string, string> {
  if (!input.user) throw new Error("gatewayHeaders: user is required.")
  const headers: Record<string, string> = {
    [TOKEN_HEADERS.user]: enc(input.user),
  }
  if (input.email) headers[TOKEN_HEADERS.email] = enc(input.email)
  const a = input.attribution ?? {}
  for (const key of [
    "purpose",
    "activity",
    "scope",
    "job",
    "subject",
    "correlation",
  ] as const)
    if (a[key]) headers[TOKEN_HEADERS[key]] = enc(a[key])
  if (input.backend && input.backend !== "tokens")
    headers[TOKEN_HEADERS.backend] = input.backend
  if (input.trailer) headers[TOKEN_HEADERS.trailer] = "event"
  return headers
}

export type GatewayConfigInput = GatewayHeaderInput & {
  baseUrl: string
  apiKey: string
}

export type GatewayConfig = {
  /** `<center>/v1`: both `@ai-sdk/anthropic` (`/messages`) and OpenAI-compatible providers (`/chat/completions`, `/audio/speech`) add their paths to it. */
  baseURL: string
  apiKey: string
  headers: Record<string, string>
}

/**
 * Provider settings pointing an AI SDK provider at the center:
 *
 * ```ts
 * createAnthropic(gatewayConfig({ baseUrl, apiKey, user: host.id }))
 * createOpenAICompatible({ name: "tokens", ...gatewayConfig({ … }) })
 * ```
 *
 * Providers are cheap to make, so make one per payer. For attribution that
 * changes per call (purpose, activity, job) pass `gatewayHeaders({ … })` as
 * the call's `headers` instead, or build the provider per call.
 */
export function gatewayConfig(input: GatewayConfigInput): GatewayConfig {
  const { baseUrl, apiKey, ...rest } = input
  return {
    baseURL: `${trimBaseUrl(baseUrl)}/v1`,
    apiKey,
    headers: gatewayHeaders(rest),
  }
}

type HeadersLike =
  | Headers
  | { get(name: string): string | null | undefined }
  | Record<string, string | string[] | undefined>

function headerOf(headers: HeadersLike, name: string): string | null {
  if (typeof (headers as Headers).get === "function")
    return (headers as Headers).get(name) ?? null
  const record = headers as Record<string, string | string[] | undefined>
  for (const key of Object.keys(record))
    if (key.toLowerCase() === name) {
      const value = record[key]
      return (Array.isArray(value) ? value[0] : value) ?? null
    }
  return null
}

const micros = (value: string | null): number | null => {
  if (value === null || value === "") return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** The voice a speech answer used in place of the one asked for (`x-token-voice-fallback`), or `null` when it was the asked one. */
export function voiceFallbackFromHeaders(headers: HeadersLike): string | null {
  return headerOf(headers, TOKEN_HEADERS.voiceFallback)
}

/** The call id a gateway response carries up front (streams have it before any cost is known), or `null`. */
export function callIdFromHeaders(headers: HeadersLike): string | null {
  return headerOf(headers, TOKEN_HEADERS.callId)
}

/**
 * The charge from a non-streamed response's headers (`x-token-call-id`,
 * `-source`, `-model`, `-cost-micros`, `-fee-micros`, `-charged-micros`,
 * `-balance-micros`), or `null` when the answer did not come through the
 * gateway or carries no cost yet (a stream: take the id with
 * {@link callIdFromHeaders}, then `center.call(id, { wait })` or the opt-in
 * trailer, {@link parseTrailer}). Accepts `Headers`, a Node header record, or
 * the AI SDK's `response.headers`.
 */
export function chargeFromHeaders(headers: HeadersLike): HeaderCharge | null {
  const callId = callIdFromHeaders(headers)
  const cost = micros(headerOf(headers, TOKEN_HEADERS.costMicros))
  const fee = micros(headerOf(headers, TOKEN_HEADERS.feeMicros))
  const charged = micros(headerOf(headers, TOKEN_HEADERS.chargedMicros))
  const balance = micros(headerOf(headers, TOKEN_HEADERS.balanceMicros))
  const source = headerOf(headers, TOKEN_HEADERS.source)
  const model = headerOf(headers, TOKEN_HEADERS.model)
  if (
    !callId ||
    cost === null ||
    fee === null ||
    charged === null ||
    balance === null ||
    (source !== "tokens" && source !== "own") ||
    !model
  )
    return null
  return {
    callId,
    source,
    model,
    costMicros: cost,
    feeMicros: fee,
    chargedMicros: charged,
    balanceAfterMicros: balance,
  }
}

/** The `event: token_center` trailer of a stream read as text, parsed; `null` when absent. */
export function parseTrailer<T = import("../types").CallCharge>(
  sse: string,
): T | null {
  const blocks = sse.split(/\r?\n\r?\n/)
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i]!
    if (!/^event:\s*token_center\s*$/m.test(block)) continue
    const data = [...block.matchAll(/^data:\s?(.*)$/gm)]
      .map((m) => m[1])
      .join("\n")
    try {
      return JSON.parse(data) as T
    } catch {
      return null
    }
  }
  return null
}
