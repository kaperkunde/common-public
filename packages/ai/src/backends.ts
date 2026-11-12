import type { LlmConfig } from "./config"

/**
 * Which back end a person's AI runs a call on, as rules.
 *
 * There are two. **Hosted** is the deployment's own model, paid for however
 * the app charges for it. **Own** is a model the person brought: an
 * OpenAI-compatible endpoint and a key of their own, measured in that
 * provider's tokens, with an optional limit per calendar month (UTC). The
 * person's `order` says which is tried first and whether the other may serve
 * when the first cannot.
 *
 * Pure: the app asks its database and the network what each can do, and the
 * screens draw from the same rules.
 */
export type BackendSource = "deployment" | "own"

export type BackendOrder =
  "deployment_then_own" | "own_then_deployment" | "deployment_only" | "own_only"

/** What a saved back end starts as: the person brought a key, so it is tried first. */
export const DEFAULT_ORDER: BackendOrder = "own_then_deployment"

export const BACKEND_ORDERS: readonly BackendOrder[] = [
  "own_then_deployment",
  "deployment_then_own",
  "own_only",
  "deployment_only",
]

export const isBackendOrder = (value: unknown): value is BackendOrder =>
  BACKEND_ORDERS.includes(value as BackendOrder)

/** The back ends a call tries, in turn. With no back end of one's own, only the hosted one. */
export const backendSequence = (
  order: BackendOrder | null | undefined,
): BackendSource[] => {
  switch (order) {
    case "deployment_then_own":
      return ["deployment", "own"]
    case "own_then_deployment":
      return ["own", "deployment"]
    case "own_only":
      return ["own"]
    default:
      return ["deployment"]
  }
}

/** The order as a model screen asks it: which back end the picked model is on, and whether the other may serve. */
export const orderFor = (
  source: BackendSource,
  fallback: boolean,
): BackendOrder =>
  source === "own"
    ? fallback
      ? "own_then_deployment"
      : "own_only"
    : fallback
      ? "deployment_then_own"
      : "deployment_only"

export const sourceOfOrder = (
  order: BackendOrder | null | undefined,
): BackendSource => backendSequence(order)[0]!

export const fallbackOfOrder = (order: BackendOrder | null | undefined) =>
  backendSequence(order).length > 1

export type RefusalReason =
  | "off"
  | "unlisted"
  | "unpriced"
  | "out"
  | "unconfigured"
  | "unreadable"
  | "unreachable"
  | "over_limit"

export type Refusal = {
  source: BackendSource
  reason: RefusalReason
  /** What the person is told, already worded. */
  message: string
  /** When it may serve again, for a refusal that ends by itself (an ISO stamp). */
  until?: string
}

export type Verdict<T> =
  { ok: true; value: T } | { ok: false; refusal: Refusal }

export type Chosen<T> =
  | { ok: true; source: BackendSource; value: T; passedOver: Refusal[] }
  | { ok: false; refusals: Refusal[] }

/**
 * Walks the order and takes the first back end that can serve. Each is asked
 * only when the one before it has refused, because asking can have
 * consequences (a top-up, a charge).
 */
export const chooseBackend = async <T>(
  order: BackendOrder | null | undefined,
  check: (source: BackendSource) => Verdict<T> | Promise<Verdict<T>>,
): Promise<Chosen<T>> => {
  const refusals: Refusal[] = []
  for (const source of backendSequence(order)) {
    const verdict = await check(source)
    if (verdict.ok) {
      return { ok: true, source, value: verdict.value, passedOver: refusals }
    }
    refusals.push(verdict.refusal)
  }
  return { ok: false, refusals }
}

/** Whether a refusal is the deployment back end's credit run out. */
export const outOfCredit = (refusal: Refusal) =>
  refusal.source === "deployment" && refusal.reason === "out"

/**
 * Which refusal to answer with when nothing could serve: credit run out beats
 * the rest (it ends by itself), then one that ends on a date, the soonest
 * first, then the first back end the order named.
 */
export const finalRefusal = (
  refusals: readonly Refusal[],
): Refusal | undefined => {
  const out = refusals.find(outOfCredit)
  if (out) return out
  const dated = refusals
    .filter((refusal) => refusal.until)
    .sort((a, b) => new Date(a.until!).getTime() - new Date(b.until!).getTime())
  return dated[0] ?? refusals[0]
}

/** The calendar month (UTC) an own-key limit counts within. */
export const calendarMonthUtc = (now: Date = new Date()) => {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return { start: start.toISOString(), end: end.toISOString() }
}

/** A person's own back end as the rules need it: never the key itself. */
export type OwnBackendShape = {
  baseUrl: string
  models: readonly string[]
  llmTokenLimit?: number | null
}

/** What a person is told when their own key has reached its limit. */
export const ownLimitMessage = (limit: number, until?: string) =>
  `Your own model has used the ${limit.toLocaleString("en-US")} tokens you allowed it this month${until ? `, and can be used again from ${until.slice(0, 10)}` : ""}. Raise the limit to carry on sooner.`

/** Whether a person's own back end can serve this model, before the key is opened. */
export const ownVerdict = (
  backend: OwnBackendShape | undefined,
  model: string,
  spend: { spent: number; period?: { start: string; end: string } },
  words: { limit?: (limit: number, until?: string) => string } = {},
): Verdict<true> => {
  if (!backend || !backend.baseUrl) {
    return {
      ok: false,
      refusal: {
        source: "own",
        reason: "unconfigured",
        message: "You have no model of your own set up.",
      },
    }
  }
  if (!backend.models.includes(model)) {
    return {
      ok: false,
      refusal: {
        source: "own",
        reason: "unlisted",
        message: `${model} is not one of the models on your own back end.`,
      },
    }
  }
  const limit = backend.llmTokenLimit
  if (limit !== null && limit !== undefined && spend.spent >= limit) {
    const until = spend.period?.end
    return {
      ok: false,
      refusal: {
        source: "own",
        reason: "over_limit",
        message: (words.limit ?? ownLimitMessage)(limit, until),
        until,
      },
    }
  }
  return { ok: true, value: true }
}

/** Whether the deployment's model can be asked for this one at all, before any balance. */
export const deploymentOffers = (
  config: Pick<LlmConfig, "enabled" | "models">,
  model: string,
): Verdict<true> => {
  if (!config.enabled) {
    return {
      ok: false,
      refusal: {
        source: "deployment",
        reason: "off",
        message: "This service has no model of its own configured.",
      },
    }
  }
  if (!config.models.includes(model)) {
    return {
      ok: false,
      refusal: {
        source: "deployment",
        reason: "unlisted",
        message: `${model} is not one of this service's models.`,
      },
    }
  }
  return { ok: true, value: true }
}

/**
 * The model a call runs on, on one back end: the one asked for where that back
 * end has it, else the preferred one, else its first.
 */
export const modelOnSource = (
  model: string,
  offered: readonly string[],
  preferred?: string,
): string | undefined => {
  if (offered.includes(model)) return model
  if (preferred && offered.includes(preferred)) return preferred
  return offered[0]
}

type OwnModels = { models: readonly string[]; order: BackendOrder } | null

/**
 * The model a person's AI runs on: the one they chose if a back end their
 * order allows still offers it, else the first model of the first back end the
 * order tries. A choice is a preference, not a promise.
 */
export const modelForPlayer = (
  chosen: string | null | undefined,
  config: Pick<LlmConfig, "models" | "defaultModel">,
  own?: OwnModels,
) => {
  const sequence = backendSequence(own?.order)
  const offered = (source: BackendSource) =>
    source === "deployment" ? config.models : (own?.models ?? [])
  if (chosen && sequence.some((source) => offered(source).includes(chosen))) {
    return chosen
  }
  return (
    sequence.map((source) => offered(source)[0]).find(Boolean) ??
    config.defaultModel
  )
}

/** The model a model screen shows as picked, and the back end it is on. */
export const pickedModel = (
  chosen: string | null | undefined,
  config: Pick<LlmConfig, "models" | "defaultModel">,
  own?: OwnModels,
): { model: string; source: BackendSource } => {
  const model = modelForPlayer(chosen, config, own)
  const offered = (source: BackendSource) =>
    source === "deployment" ? config.models : (own?.models ?? [])
  const source = backendSequence(own?.order).find((each) =>
    offered(each).includes(model),
  )
  return { model, source: source ?? "deployment" }
}

/** Every model a person may pick between, each with the back ends that serve it in order. */
export const pickableModels = (
  deploymentModels: readonly string[],
  own?: OwnModels,
) => {
  const sequence = backendSequence(own?.order)
  const all = [...deploymentModels, ...(own?.models ?? [])].filter(
    (model, index, list) => list.indexOf(model) === index,
  )
  return all.map((model) => ({
    model,
    sources: sequence.filter((source) =>
      source === "deployment"
        ? deploymentModels.includes(model)
        : (own?.models ?? []).includes(model),
    ),
    offeredElsewhere: [
      ...(deploymentModels.includes(model) ? ["deployment" as const] : []),
      ...((own?.models ?? []).includes(model) ? ["own" as const] : []),
    ].filter((source) => !sequence.includes(source)),
  }))
}

/** A base URL as it is kept: trimmed and without the trailing slash. */
export const normalBaseUrl = (raw: string) => raw.trim().replace(/\/+$/, "")

export type UrlVerdict = { ok: true } | { ok: false; reason: string }

const PRIVATE_NAME = /(^|\.)(localhost|local|internal|lan|home|corp)$/i
const V4 = /^\d{1,3}(\.\d{1,3}){3}$/

/** Whether a hostname is obviously this machine or a private network; the connect-time check does the rest. */
const obviouslyPrivate = (host: string): boolean => {
  const bare = host.replace(/^\[|\]$/g, "").toLowerCase()
  if (PRIVATE_NAME.test(bare) || (!bare.includes(".") && !bare.includes(":"))) {
    return true
  }
  if (V4.test(bare)) {
    const [a = 0, b = 0] = bare.split(".").map(Number)
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    )
  }
  if (bare.includes(":")) {
    return (
      bare === "::1" ||
      bare === "::" ||
      /^f[cd]/.test(bare) ||
      /^fe[89ab]/.test(bare)
    )
  }
  return false
}

/**
 * Whether a person's base URL is one the server may send their key to, before
 * anything is resolved: http(s), no credentials, no query, https unless
 * private addresses are allowed, and not obviously on this machine or a
 * private network. Every request is checked again as the socket connects
 * (`guardedFetch`).
 */
export const ownEndpointShape = (
  raw: string,
  allowPrivate: boolean,
): UrlVerdict => {
  let url: URL
  try {
    url = new URL(normalBaseUrl(raw))
  } catch {
    return { ok: false, reason: "that is not a web address" }
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: "the address has to start with https://" }
  }
  if (url.username || url.password) {
    return {
      ok: false,
      reason: "put the key in the key field, not in the address",
    }
  }
  if (url.search || url.hash) {
    return {
      ok: false,
      reason:
        "the address is the base the paths go after, with no ? or # in it",
    }
  }
  if (allowPrivate) return { ok: true }
  if (url.protocol !== "https:") {
    return {
      ok: false,
      reason:
        "the address has to start with https://, or the key would travel in the clear",
    }
  }
  if (obviouslyPrivate(url.hostname)) {
    return {
      ok: false,
      reason: "that address is on this machine or a private network",
    }
  }
  return { ok: true }
}

/** A person's own back end as availability needs it. */
export type OwnAvailabilityShape = {
  baseUrl: string
  models: readonly string[]
  order: BackendOrder
}

/** Whether a person's own back end could ever serve: a callable address, a model, and an order that tries it. */
export const ownBackendUsable = (
  own: OwnAvailabilityShape | null | undefined,
  allowPrivate: boolean,
) =>
  Boolean(
    own &&
    own.baseUrl &&
    own.models.length > 0 &&
    backendSequence(own.order).includes("own") &&
    ownEndpointShape(own.baseUrl, allowPrivate).ok,
  )

export type AiAvailability = {
  available: boolean
  deployment: boolean
  own: boolean
}

/** Whether a person has an AI: the deployment's model or one of their own. Either alone is enough. */
export const aiAvailability = (input: {
  deployment: Pick<LlmConfig, "enabled">
  own?: OwnAvailabilityShape | null
  allowPrivate: boolean
}): AiAvailability => {
  const deployment = input.deployment.enabled
  const own = ownBackendUsable(input.own, input.allowPrivate)
  return { available: deployment || own, deployment, own }
}
