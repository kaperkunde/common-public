/**
 * Prices, as arithmetic: what a call costs in US dollars, and in credits.
 *
 * A model's price is a version from a moment on with a price per million units for each kind
 * of usage it is charged for: fresh prompt tokens (`input`), cache reads, five-minute and
 * hour-long cache writes, answer tokens (`output`), and anything else an app meters -- `tts_chars`,
 * `tts_seconds`. A kind a price leaves out may be worked out from another (`KindFallback`: a
 * cache read a tenth of input, by default). A request may cost more or less by its dimensions
 * (where it ran, a batch, fast mode: `PriceFactor`), and a request whose prompt is long may cost
 * a multiple on a model with a long-prompt tier. Dollars become credits at one credits-per-dollar
 * ratio. Every piece is a history, read as it stood when the call was made.
 *
 * The database decides (`{{prefix}}call_usd` and `{{prefix}}spend`); this is the same rule,
 * pure, for the screens and for tests.
 */

import { shortCount } from "./units"

/** The kinds a prompt-and-answer call is priced by. */
export const TOKEN_KINDS = {
  input: "input",
  cacheRead: "cache_read",
  cacheWrite: "cache_write",
  cacheWrite1h: "cache_write_1h",
  output: "output",
} as const

export type KindPrice = {
  kind: string
  /** What one unit is: `token`, `char`, `second`. */
  unit?: string
  usdPerMillion: number
}

/** One price version of one model. */
export type ModelPrice = {
  model: string
  effectiveFrom: string
  kinds: readonly KindPrice[]
  longPromptUnits?: number | null
  longPromptFactor?: number | null
  source?: string | null
  syncedAt?: string | null
}

/** A kind worked out from another where a price leaves it out. */
export type KindFallback = { kind: string; baseKind: string; multiple: number }

/**
 * The fallbacks the migration seeds: the multiples most providers document for prompt caching.
 * A provider that charges otherwise has the kind set on its price.
 */
export const DEFAULT_KIND_FALLBACKS: readonly KindFallback[] = [
  { kind: TOKEN_KINDS.cacheRead, baseKind: TOKEN_KINDS.input, multiple: 0.1 },
  { kind: TOKEN_KINDS.cacheWrite, baseKind: TOKEN_KINDS.input, multiple: 1.25 },
  { kind: TOKEN_KINDS.cacheWrite1h, baseKind: TOKEN_KINDS.input, multiple: 2 },
]

/** A multiple for one value of one dimension of a request; `model` null holds for every model. */
export type PriceFactor = {
  model?: string | null
  dimension: string
  value: string
  factor: number
  effectiveFrom: string
}

/** Credits per US dollar, from a moment on. */
export type DollarRate = { perDollar: number; effectiveFrom: string }

const finite = (value: unknown): value is number | string =>
  value !== null &&
  value !== undefined &&
  value !== "" &&
  Number.isFinite(Number(value))

/** What one kind costs under a price, in dollars per million units, or undefined if unpriced. */
export const kindUsd = (
  price: Pick<ModelPrice, "kinds">,
  kind: string,
  fallbacks: readonly KindFallback[] = DEFAULT_KIND_FALLBACKS,
): number | undefined => {
  const own = price.kinds.find((one) => one.kind === kind)
  if (own && finite(own.usdPerMillion)) return Number(own.usdPerMillion)
  const fallback = fallbacks.find((one) => one.kind === kind)
  if (!fallback) return undefined
  const base = price.kinds.find((one) => one.kind === fallback.baseKind)
  return base && finite(base.usdPerMillion)
    ? Number(base.usdPerMillion) * fallback.multiple
    : undefined
}

/** Whether a kind's price is set on the row rather than worked out from a fallback. */
export const kindIsSet = (price: Pick<ModelPrice, "kinds">, kind: string) =>
  price.kinds.some((one) => one.kind === kind && finite(one.usdPerMillion))

/** A request's tokens as a provider reports them; every count but the first two may be missing. */
export type RequestTokens = {
  inputTokens: number
  outputTokens: number
  /** Part of `inputTokens`: served from the provider's cache. */
  cachedTokens?: number | null
  /** Part of `inputTokens`: written into the provider's cache. */
  cacheWriteTokens?: number | null
  /** Part of `cacheWriteTokens`: kept an hour rather than five minutes. */
  cacheWrite1hTokens?: number | null
  inferenceGeo?: string | null
  speed?: string | null
  serviceTier?: string | null
  /** Any other dimension the price factors know: `{ region: "eu" }`. */
  dimensions?: Readonly<Record<string, string>> | null
}

/** A ledger row as pricing reads it: one call's totals, its requests, and its other units. */
export type CallUsage = Partial<RequestTokens> & {
  requests?: readonly RequestTokens[] | null
  /** Usage that is not prompt and answer, by price kind: `{ tts_chars: 1200 }`. */
  units?: Readonly<Record<string, number>> | null
}

const clamp = (value: number | null | undefined, most: number) =>
  Math.min(Math.max(Number(value ?? 0) || 0, 0), most)

/**
 * A request's tokens split by kind, each count held inside the one above it whatever a provider
 * reports: no more cached than there was prompt, no more written than the rest, no more kept an
 * hour than was written.
 */
export const tokenKinds = (usage: Partial<RequestTokens>) => {
  const prompt = Math.max(Number(usage.inputTokens ?? 0) || 0, 0)
  const cached = clamp(usage.cachedTokens, prompt)
  const written = clamp(usage.cacheWriteTokens, prompt - cached)
  const writtenLong = clamp(usage.cacheWrite1hTokens, written)
  return {
    [TOKEN_KINDS.input]: prompt - cached - written,
    [TOKEN_KINDS.cacheRead]: cached,
    [TOKEN_KINDS.cacheWrite]: written - writtenLong,
    [TOKEN_KINDS.cacheWrite1h]: writtenLong,
    [TOKEN_KINDS.output]: Math.max(Number(usage.outputTokens ?? 0) || 0, 0),
  } as Record<string, number>
}

const takesEffect = (row: { effectiveFrom: string }) =>
  new Date(row.effectiveFrom).getTime()

/** The newest of rows that had begun by a moment. */
const newestBy = <ROW extends { effectiveFrom: string }>(
  rows: readonly ROW[],
  at: Date,
) =>
  rows
    .filter((row) => takesEffect(row) <= at.getTime())
    .reduce<ROW | undefined>(
      (newest, row) =>
        !newest || takesEffect(row) > takesEffect(newest) ? row : newest,
      undefined,
    )

/** The price a model is charged at a moment: the newest of its versions that had begun. */
export const priceInForce = <PRICE extends { model: string; effectiveFrom: string }>(
  prices: readonly PRICE[],
  model: string,
  at: Date = new Date(),
) =>
  newestBy(
    prices.filter((price) => price.model === model),
    at,
  )

/** The credits per dollar in force at a moment, or undefined before the first. */
export const rateInForce = (rates: readonly DollarRate[], at: Date = new Date()) =>
  newestBy(rates, at)

/** A factor in force for a model at a moment: its own, else every model's, else 1. */
export const factorAt = (
  factors: readonly PriceFactor[],
  model: string,
  dimension: string,
  value: string,
  at: Date = new Date(),
) => {
  const matching = factors.filter(
    (one) => one.dimension === dimension && one.value === value,
  )
  const own = newestBy(
    matching.filter((one) => one.model === model),
    at,
  )
  const shared = newestBy(
    matching.filter((one) => one.model === null || one.model === undefined),
    at,
  )
  return Number((own ?? shared)?.factor ?? 1)
}

/** A request's dimensions: its own map over the three a provider usually reports. */
export const dimensionsOf = (request: Partial<RequestTokens>) => {
  const dims: Record<string, string> = {}
  if (request.inferenceGeo) dims.inference_geo = request.inferenceGeo
  if (request.speed) dims.speed = request.speed
  if (request.serviceTier) dims.service_tier = request.serviceTier
  return { ...dims, ...(request.dimensions ?? {}) }
}

/**
 * What one request is priced at as a multiple of its model's price: a long prompt on a model
 * with a long-prompt tier, and the factors of its dimensions in force when it was made.
 */
export const requestFactor = (
  request: Partial<RequestTokens>,
  price: Pick<ModelPrice, "model" | "longPromptUnits" | "longPromptFactor">,
  factors: readonly PriceFactor[] = [],
  at: Date = new Date(),
) => {
  const prompt = Math.max(Number(request.inputTokens ?? 0) || 0, 0)
  let factor = 1
  if (finite(price.longPromptUnits) && prompt > Number(price.longPromptUnits)) {
    factor *= finite(price.longPromptFactor) ? Number(price.longPromptFactor) : 1
  }
  Object.entries(dimensionsOf(request)).forEach(([dimension, value]) => {
    factor *= factorAt(factors, price.model, dimension, value, at)
  })
  return factor
}

/** A call's dollars by kind, the total, and any kind it used that nobody priced. */
export type PricedCall = {
  byKind: Record<string, number>
  total: number
  /** Kinds the call used that the price neither sets nor can work out; counted as nothing. */
  unpriced: string[]
}

export type PricingOptions = {
  factors?: readonly PriceFactor[]
  fallbacks?: readonly KindFallback[]
  /** When the call was made, for the factors in force; now by default. */
  at?: Date
}

/**
 * What a call cost in US dollars at a price, by kind: request by request where the row kept
 * them, else as one request read off its totals, plus its other units -- `{{prefix}}call_usd`.
 * The database refuses a call that used an unpriced kind; here it is named in `unpriced`.
 */
export const pricedCall = (
  usage: CallUsage,
  price: Pick<ModelPrice, "model" | "kinds" | "longPromptUnits" | "longPromptFactor">,
  options: PricingOptions = {},
): PricedCall => {
  const { factors = [], fallbacks = DEFAULT_KIND_FALLBACKS, at = new Date() } = options
  const own = Number(usage.inputTokens ?? 0) + Number(usage.outputTokens ?? 0) > 0
  const requests =
    usage.requests && usage.requests.length > 0
      ? usage.requests
      : own
        ? [usage as RequestTokens]
        : []
  const byKind: Record<string, number> = {}
  const unpriced = new Set<string>()
  const add = (kind: string, quantity: number, factor: number) => {
    if (!(quantity > 0)) return
    const usd = kindUsd(price, kind, fallbacks)
    if (usd === undefined) {
      unpriced.add(kind)
      return
    }
    byKind[kind] = (byKind[kind] ?? 0) + (quantity * usd * factor) / 1_000_000
  }
  requests.forEach((request) => {
    const factor = requestFactor(request, price, factors, at)
    Object.entries(tokenKinds(request)).forEach(([kind, quantity]) =>
      add(kind, quantity, factor),
    )
  })
  Object.entries(usage.units ?? {}).forEach(([kind, quantity]) =>
    add(kind, Math.max(Number(quantity) || 0, 0), 1),
  )
  return {
    byKind,
    total: Object.values(byKind).reduce((sum, usd) => sum + usd, 0),
    unpriced: Array.from(unpriced),
  }
}

/** What a call cost in US dollars at a price. */
export const callUsd = (
  usage: CallUsage,
  price: Pick<ModelPrice, "model" | "kinds" | "longPromptUnits" | "longPromptFactor">,
  options: PricingOptions = {},
) => pricedCall(usage, price, options).total

/**
 * What a call cost in credits: its dollars times the credits per dollar, rounded up -- what
 * `{{prefix}}spend` charges.
 */
export const creditCost = (
  usage: CallUsage,
  price: Pick<ModelPrice, "model" | "kinds" | "longPromptUnits" | "longPromptFactor">,
  perDollar: number,
  options: PricingOptions = {},
) => {
  const exact = callUsd(usage, price, options) * perDollar
  // The database's numeric is exact and a float is not: 80 × 0.1 is a hair over 8 here, which
  // would round up a whole credit the database never charges.
  return Math.ceil(Math.round(exact * 1e9) / 1e9)
}

/** What each kind of a price comes to in credits per unit, under a ratio. */
export const creditRatesOf = (
  price: Pick<ModelPrice, "kinds">,
  perDollar: number,
  fallbacks: readonly KindFallback[] = DEFAULT_KIND_FALLBACKS,
) => {
  const kinds = new Set([
    ...price.kinds.map((one) => one.kind),
    ...fallbacks
      .filter((one) => price.kinds.some((kind) => kind.kind === one.baseKind))
      .map((one) => one.kind),
  ])
  const rates: Record<string, number> = {}
  kinds.forEach((kind) => {
    const usd = kindUsd(price, kind, fallbacks)
    if (usd !== undefined) rates[kind] = (usd * perDollar) / 1_000_000
  })
  return rates
}

/** Dollars as a price list says them: `$2`, `$0.20`, `$0.025`. */
export const usdText = (dollars: number) => {
  const value = Number(dollars)
  const decimals = value !== 0 && Math.abs(value) < 0.1 ? 4 : 2
  const fixed = value.toFixed(decimals).replace(/(\.\d\d\d*?)0+$/, "$1")
  return `$${fixed.endsWith(".00") ? fixed.slice(0, -3) : fixed}`
}

/** How the admin screen names each kind; any other kind is said as itself. */
export const KIND_LABELS: Readonly<Record<string, string>> = {
  [TOKEN_KINDS.input]: "in",
  [TOKEN_KINDS.output]: "out",
  [TOKEN_KINDS.cacheRead]: "cache reads",
  [TOKEN_KINDS.cacheWrite]: "cache writes (5 min)",
  [TOKEN_KINDS.cacheWrite1h]: "cache writes (1 h)",
}

const KIND_ORDER: readonly string[] = [
  TOKEN_KINDS.input,
  TOKEN_KINDS.output,
  TOKEN_KINDS.cacheRead,
  TOKEN_KINDS.cacheWrite,
  TOKEN_KINDS.cacheWrite1h,
]

/**
 * A price as the admin reads it, per million units: "$2 in, $10 out, $0.20 cache reads,
 * $2.50 cache writes (5 min), $4 cache writes (1 h)", "(set)" beside a cache price the row
 * gives rather than works out, and every other kind with its unit: "$15 tts_chars per M char".
 */
export const priceText = (
  price: Pick<ModelPrice, "kinds">,
  fallbacks: readonly KindFallback[] = DEFAULT_KIND_FALLBACKS,
) => {
  const tokenPriced = price.kinds.some((one) => one.kind === TOKEN_KINDS.input)
  const parts: string[] = []
  KIND_ORDER.forEach((kind) => {
    if (!tokenPriced && !kindIsSet(price, kind)) return
    const usd = kindUsd(price, kind, fallbacks)
    if (usd === undefined) return
    const fallback = fallbacks.some((one) => one.kind === kind)
    const mark = fallback && kindIsSet(price, kind) ? " (set)" : ""
    parts.push(`${usdText(usd)} ${KIND_LABELS[kind]}${mark}`)
  })
  price.kinds
    .filter((one) => !KIND_ORDER.includes(one.kind))
    .forEach((one) =>
      parts.push(
        `${usdText(Number(one.usdPerMillion))} ${one.kind} per M ${one.unit ?? "unit"}`,
      ),
    )
  return parts.join(", ")
}

/**
 * A call's tokens with what the cache served set apart: "12k in (30k cached) · 400 out".
 * `input` counts every prompt token, the cached ones included, as the ledger does.
 */
export const tokenSplitText = (tokens: {
  input: number
  cached?: number | null
  output: number
}) => {
  const input = Math.max(Number(tokens.input) || 0, 0)
  const cached = Math.min(Math.max(Number(tokens.cached ?? 0) || 0, 0), input)
  const cachedText = cached > 0 ? ` (${shortCount(cached)} cached)` : ""
  return `${shortCount(input - cached)} in${cachedText} · ${shortCount(tokens.output)} out`
}
