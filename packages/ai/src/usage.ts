/** One request of a call, as the provider reported it. */
export type RequestTokens = {
  inputTokens: number
  outputTokens: number
  /** Of `inputTokens`, what was read from the provider's prompt cache. */
  cachedTokens: number
  /** Of `inputTokens`, what was written to the cache. */
  cacheWriteTokens: number
  /** Of the write, what is kept an hour rather than five minutes. */
  cacheWrite1hTokens: number
  /** Reasoning tokens, part of `outputTokens`, where the provider says. */
  reasoningTokens: number
  inferenceGeo?: string
  speed?: string
  serviceTier?: string
  /** Any further pricing dimensions the app wants to carry. */
  dimensions?: Record<string, string>
}

/** As much of an SDK step as this reads. */
export type StepUsageLike = {
  usage?: {
    inputTokens?: number | null
    outputTokens?: number | null
    outputTokenDetails?: { reasoningTokens?: number | null }
    inputTokenDetails?: {
      cacheReadTokens?: number | null
      cacheWriteTokens?: number | null
    }
  } | null
  providerMetadata?: Record<string, unknown> | null
}

const count = (value: unknown) => {
  const number = typeof value === "number" ? value : Number(value)
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0
}

const text = (value: unknown) =>
  typeof value === "string" && value.trim()
    ? value.trim().slice(0, 40)
    : undefined

/** Anthropic's raw usage for a step, where there is one. */
const rawUsageOf = (step: StepUsageLike) => {
  const anthropic = step.providerMetadata?.anthropic as
    { usage?: unknown } | undefined
  const usage = anthropic?.usage
  return usage && typeof usage === "object"
    ? (usage as Record<string, unknown>)
    : undefined
}

/**
 * One step as one request. The SDK's usage gives the counts on every
 * provider; Anthropic's raw usage adds the hour-long part of a cache write and
 * where, how fast and at what tier it ran.
 */
export const requestOf = (step: StepUsageLike): RequestTokens => {
  const raw = rawUsageOf(step)
  const creation = raw?.cache_creation as Record<string, unknown> | undefined
  const written = count(step.usage?.inputTokenDetails?.cacheWriteTokens)
  const geo = text(raw?.inference_geo)
  const speed = text(raw?.speed)
  const tier = text(raw?.service_tier)
  return {
    inputTokens: count(step.usage?.inputTokens),
    outputTokens: count(step.usage?.outputTokens),
    cachedTokens: count(step.usage?.inputTokenDetails?.cacheReadTokens),
    cacheWriteTokens: written,
    cacheWrite1hTokens: Math.min(
      count(creation?.ephemeral_1h_input_tokens),
      written,
    ),
    reasoningTokens: count(step.usage?.outputTokenDetails?.reasoningTokens),
    ...(geo ? { inferenceGeo: geo } : {}),
    ...(speed ? { speed } : {}),
    ...(tier ? { serviceTier: tier } : {}),
  }
}

/** What a ledger keeps of a call's requests. */
export type CallRequests = {
  /** One entry a request; empty for a call with no steps to read. */
  requests: RequestTokens[]
  /** The hour-long part of every write, together. */
  cacheWrite1hTokens: number
  /** Where, how fast and at what tier the call ran: its first request's, where it says. */
  inferenceGeo?: string
  speed?: string
  serviceTier?: string
}

/** A call's steps as the requests it made. */
export const requestsOf = (
  steps: readonly StepUsageLike[] | null | undefined,
): CallRequests => {
  const requests = (steps ?? []).map(requestOf)
  const first = <K extends "inferenceGeo" | "speed" | "serviceTier">(key: K) =>
    requests.find((request) => request[key])?.[key] ?? undefined
  const geo = first("inferenceGeo")
  const speed = first("speed")
  const tier = first("serviceTier")
  return {
    requests,
    cacheWrite1hTokens: requests.reduce(
      (sum, request) => sum + request.cacheWrite1hTokens,
      0,
    ),
    ...(geo ? { inferenceGeo: geo } : {}),
    ...(speed ? { speed } : {}),
    ...(tier ? { serviceTier: tier } : {}),
  }
}
