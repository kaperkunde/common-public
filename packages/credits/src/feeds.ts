/**
 * Prices from public price lists, proposed to the admin and never applied by themselves.
 *
 * Three feeds are read: a provider's own pricing page as Markdown (Anthropic's, whose shape the
 * parser knows), LiteLLM's price list and OpenRouter's models, each narrowed to one provider.
 * None of them is a contract: each is parsed defensively (a row that does not read is left out),
 * held to the documented cache multiples, and only a price two sources agree on goes forward
 * unflagged. `syncPrices` fetches them with an injected fetch, and for each model the app offers
 * confirms the price in force or proposes the difference (`{{prefix}}price_proposals`), which
 * the admin applies or dismisses. Nothing is ever priced from a proposal until applied.
 */

import {
  TOKEN_KINDS,
  kindUsd,
  priceInForce,
  type KindPrice,
  type ModelPrice,
  type PriceFactor,
} from "./pricing"
import type { CreditStore } from "./store"

/** What a source says one model costs, as price lists write it: dollars per million tokens. */
export type FeedQuote = {
  model: string
  source: string
  inputUsd: number
  outputUsd: number
  cacheReadUsd?: number | null
  cacheWriteUsd?: number | null
  cacheWrite1hUsd?: number | null
  longPromptTokens?: number | null
  longPromptFactor?: number | null
  /** What fast mode costs, as a multiple; a model factor `speed: fast`. */
  fastFactor?: number | null
}

/** Where each feed is read, and the name a proposal says it came from. */
export const PRICE_FEEDS = {
  anthropicPricingPage: {
    name: "anthropic pricing page",
    url: "https://platform.claude.com/docs/en/about-claude/pricing.md",
  },
  litellm: {
    name: "litellm",
    url: "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json",
  },
  openrouter: {
    name: "openrouter",
    url: "https://openrouter.ai/api/v1/models",
  },
} as const

const MILLION = 1_000_000

const dollarsIn = (cell: string) => {
  const match = /\$\s*([0-9]+(?:\.[0-9]+)?)/.exec(cell)
  return match ? Number(match[1]) : undefined
}

const perMillion = (value: unknown) => {
  const number = typeof value === "string" ? Number(value) : value
  return typeof number === "number" && Number.isFinite(number) && number >= 0
    ? Math.round(number * MILLION * 1e9) / 1e9
    : undefined
}

/** "Claude Opus 5.5" is claude-opus-5-5; anything in brackets or a link is left out. */
export const modelIdOf = (name: string) =>
  name
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\([^)]*\)/g, "")
    .replace(/<[^>]*>/g, "")
    .trim()
    .toLowerCase()
    .replace(/[.\s]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")

const cellsOf = (line: string) => {
  const trimmed = line.trim()
  if (!trimmed.startsWith("|")) return undefined
  return trimmed
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim())
}

type Table = { heading: string; header: string[]; rows: string[][] }

const tablesOf = (markdown: string) => {
  const tables: Table[] = []
  let heading = ""
  let current: Table | undefined
  markdown.split("\n").forEach((line) => {
    const headingMatch = /^#+\s+(.*)$/.exec(line.trim())
    if (headingMatch) {
      heading = headingMatch.at(1) ?? ""
      current = undefined
      return
    }
    const cells = cellsOf(line)
    if (!cells) {
      current = undefined
      return
    }
    if (!current) {
      current = { heading, header: cells, rows: [] }
      tables.push(current)
      return
    }
    if (cells.every((cell) => /^:?-+:?$/.test(cell))) return
    current.rows.push(cells)
  })
  return tables
}

const OVER = /over\s+([0-9][0-9,]*)\s+tokens/i
const UP_TO = /up to\s+[0-9][0-9,]*\s+tokens/i

/**
 * Anthropic's pricing page: its model table (base input, 5m and 1h cache writes, cache hits,
 * output), a model priced again "for prompts over N tokens" as a long-prompt tier, and the
 * fast mode table as each model's factor over its input price.
 */
export const parseAnthropicPricingPage = (
  markdown: string,
  source: string = PRICE_FEEDS.anthropicPricingPage.name,
) => {
  const tables = tablesOf(markdown)
  const main = tables.find((table) => {
    const header = table.header.join(" ").toLowerCase()
    return (
      header.includes("base input") &&
      header.includes("cache") &&
      header.includes("output")
    )
  })
  if (!main) return []
  const column = (pattern: RegExp) =>
    main.header.findIndex((cell) => pattern.test(cell))
  const at = {
    input: column(/base input/i),
    write5m: column(/5m cache/i),
    write1h: column(/1h cache/i),
    read: column(/cache hit/i),
    output: column(/output/i),
  }
  if (Object.values(at).some((index) => index < 0)) return []
  const quotes = new Map<string, FeedQuote>()
  const longTiers = new Map<string, { tokens: number; input: number }>()
  main.rows.forEach((cells) => {
    const name = cells[0] ?? ""
    const model = modelIdOf(name)
    const input = dollarsIn(cells[at.input] ?? "")
    const output = dollarsIn(cells[at.output] ?? "")
    if (
      !model.startsWith("claude-") ||
      input === undefined ||
      output === undefined
    )
      return
    const over = OVER.exec(name)
    if (over) {
      longTiers.set(model, {
        tokens: Number((over[1] ?? "").replace(/,/g, "")),
        input,
      })
      return
    }
    if (UP_TO.test(name) || !quotes.has(model)) {
      quotes.set(model, {
        model,
        source,
        inputUsd: input,
        outputUsd: output,
        cacheReadUsd: dollarsIn(cells[at.read] ?? "") ?? null,
        cacheWriteUsd: dollarsIn(cells[at.write5m] ?? "") ?? null,
        cacheWrite1hUsd: dollarsIn(cells[at.write1h] ?? "") ?? null,
      })
    }
  })
  longTiers.forEach((tier, model) => {
    const quote = quotes.get(model)
    if (quote && quote.inputUsd > 0) {
      quote.longPromptTokens = tier.tokens
      quote.longPromptFactor =
        Math.round((tier.input / quote.inputUsd) * 1e6) / 1e6
    }
  })
  const fast = tables.find((table) => /fast mode/i.test(table.heading))
  fast?.rows.forEach((cells) => {
    const input = dollarsIn(cells[1] ?? "")
    if (input === undefined) return
    ;(cells[0] ?? "")
      .split("/")
      .map(modelIdOf)
      .forEach((model) => {
        const quote = quotes.get(model)
        if (quote && quote.inputUsd > 0) {
          quote.fastFactor = Math.round((input / quote.inputUsd) * 1e6) / 1e6
        }
      })
  })
  return Array.from(quotes.values())
}

/**
 * LiteLLM's price list for one provider's own API (`litellm_provider`, keyed by the bare model
 * id, dated snapshots left out): per-token prices, the hour-long write as `_above_1hr`, a
 * long-prompt tier as `_above_<N>k_tokens`, and fast mode in `provider_specific_entry`.
 */
export const parseLitellm = (
  json: unknown,
  options: { provider?: string; modelPrefix?: string; source?: string } = {},
) => {
  const {
    provider = "anthropic",
    modelPrefix = "claude-",
    source = PRICE_FEEDS.litellm.name,
  } = options
  if (!json || typeof json !== "object") return []
  const quotes: FeedQuote[] = []
  Object.entries(json as Record<string, Record<string, unknown>>).forEach(
    ([model, entry]) => {
      if (
        !model.startsWith(modelPrefix) ||
        !entry ||
        entry.litellm_provider !== provider
      )
        return
      if (/-\d{8}$/.test(model)) return
      const input = perMillion(entry.input_cost_per_token)
      const output = perMillion(entry.output_cost_per_token)
      if (input === undefined || output === undefined) return
      const quote: FeedQuote = {
        model,
        source,
        inputUsd: input,
        outputUsd: output,
        cacheReadUsd: perMillion(entry.cache_read_input_token_cost) ?? null,
        cacheWriteUsd:
          perMillion(entry.cache_creation_input_token_cost) ?? null,
        cacheWrite1hUsd:
          perMillion(entry.cache_creation_input_token_cost_above_1hr) ?? null,
      }
      const tierKey = Object.keys(entry).find((key) =>
        /^input_cost_per_token_above_\d+k_tokens$/.test(key),
      )
      const tierInput = tierKey ? perMillion(entry[tierKey]) : undefined
      if (tierKey && tierInput !== undefined && input > 0) {
        quote.longPromptTokens =
          Number(/above_(\d+)k/.exec(tierKey)?.[1]) * 1000
        quote.longPromptFactor = Math.round((tierInput / input) * 1e6) / 1e6
      }
      const specific = entry.provider_specific_entry as
        Record<string, unknown> | undefined
      const fast = Number(specific?.fast)
      if (Number.isFinite(fast) && fast > 0) quote.fastFactor = fast
      quotes.push(quote)
    },
  )
  return quotes
}

/**
 * OpenRouter's models for one vendor (`<vendor>/...`, never the `:batch` variants): its prices
 * per token and a long-prompt tier as an override with `min_prompt_tokens`.
 */
export const parseOpenRouter = (
  json: unknown,
  options: { vendor?: string; modelPrefix?: string; source?: string } = {},
) => {
  const {
    vendor = "anthropic",
    modelPrefix = "claude-",
    source = PRICE_FEEDS.openrouter.name,
  } = options
  const data = (json as { data?: unknown })?.data
  if (!Array.isArray(data)) return []
  const quotes: FeedQuote[] = []
  data.forEach((entry: { id?: unknown; pricing?: Record<string, unknown> }) => {
    const id = typeof entry?.id === "string" ? entry.id : ""
    if (!id.startsWith(`${vendor}/`) || id.includes(":")) return
    const model = modelIdOf(id.slice(vendor.length + 1))
    const pricing = entry.pricing ?? {}
    const input = perMillion(pricing.prompt)
    const output = perMillion(pricing.completion)
    if (
      !model.startsWith(modelPrefix) ||
      input === undefined ||
      output === undefined
    )
      return
    const quote: FeedQuote = {
      model,
      source,
      inputUsd: input,
      outputUsd: output,
      cacheReadUsd: perMillion(pricing.input_cache_read) ?? null,
      cacheWriteUsd: perMillion(pricing.input_cache_write) ?? null,
      cacheWrite1hUsd: perMillion(pricing.input_cache_write_1h) ?? null,
    }
    const overrides = Array.isArray(pricing.overrides) ? pricing.overrides : []
    const tier = overrides.find(
      (one: Record<string, unknown>) => Number(one?.min_prompt_tokens) > 0,
    ) as Record<string, unknown> | undefined
    const tierInput = tier ? perMillion(tier.prompt) : undefined
    if (tier && tierInput !== undefined && input > 0) {
      quote.longPromptTokens = Number(tier.min_prompt_tokens)
      quote.longPromptFactor = Math.round((tierInput / input) * 1e6) / 1e6
    }
    quotes.push(quote)
  })
  return quotes
}

/** A quote's prices with every empty cache price worked out from the default multiples. */
const usdOf = (quote: Omit<FeedQuote, "model" | "source">) => {
  const kinds = quoteKinds(quote)
  const price = { kinds }
  return {
    input: kindUsd(price, TOKEN_KINDS.input) ?? 0,
    output: kindUsd(price, TOKEN_KINDS.output) ?? 0,
    cacheRead: kindUsd(price, TOKEN_KINDS.cacheRead) ?? 0,
    cacheWrite: kindUsd(price, TOKEN_KINDS.cacheWrite) ?? 0,
    cacheWrite1h: kindUsd(price, TOKEN_KINDS.cacheWrite1h) ?? 0,
  }
}

/** A quote as the kinds a price is set with. */
export const quoteKinds = (
  quote: Omit<FeedQuote, "model" | "source">,
): KindPrice[] => {
  const kinds: KindPrice[] = [
    {
      kind: TOKEN_KINDS.input,
      unit: "token",
      usdPerMillion: Number(quote.inputUsd),
    },
    {
      kind: TOKEN_KINDS.output,
      unit: "token",
      usdPerMillion: Number(quote.outputUsd),
    },
  ]
  const optional: [string, number | null | undefined][] = [
    [TOKEN_KINDS.cacheRead, quote.cacheReadUsd],
    [TOKEN_KINDS.cacheWrite, quote.cacheWriteUsd],
    [TOKEN_KINDS.cacheWrite1h, quote.cacheWrite1hUsd],
  ]
  optional.forEach(([kind, usd]) => {
    if (usd !== null && usd !== undefined && Number.isFinite(Number(usd))) {
      kinds.push({ kind, unit: "token", usdPerMillion: Number(usd) })
    }
  })
  return kinds
}

/** The model factors a quote carries: fast mode, where it says. */
export const quoteFactors = (quote: Pick<FeedQuote, "fastFactor">) =>
  quote.fastFactor && quote.fastFactor !== 1
    ? [{ dimension: "speed", value: "fast", factor: Number(quote.fastFactor) }]
    : []

/** A stored price (and its model's fast factor, if known) as a quote, to compare. */
export const quoteOfPrice = (
  price: Pick<
    ModelPrice,
    "model" | "kinds" | "longPromptUnits" | "longPromptFactor"
  >,
  source = "in force",
  fastFactor?: number | null,
): FeedQuote => ({
  model: price.model,
  source,
  inputUsd: kindUsd(price, TOKEN_KINDS.input) ?? 0,
  outputUsd: kindUsd(price, TOKEN_KINDS.output) ?? 0,
  cacheReadUsd: kindUsd(price, TOKEN_KINDS.cacheRead) ?? null,
  cacheWriteUsd: kindUsd(price, TOKEN_KINDS.cacheWrite) ?? null,
  cacheWrite1hUsd: kindUsd(price, TOKEN_KINDS.cacheWrite1h) ?? null,
  longPromptTokens: price.longPromptUnits ?? null,
  longPromptFactor: price.longPromptFactor ?? null,
  fastFactor: fastFactor ?? null,
})

/** The cache-read multiples providers document (0.1x most, 0.05x, 0.025x). */
export const READ_MULTIPLES = [0.1, 0.05, 0.025] as const

const near = (a: number, b: number) =>
  Math.abs(a - b) <= Math.max(Math.abs(b) * 1e-6, 1e-9)

/** What is odd about a quote against the documented multiples, in words; none is fine. */
export const multipleProblems = (
  quote: FeedQuote,
  readMultiples: readonly number[] = READ_MULTIPLES,
) => {
  const usd = usdOf(quote)
  const problems: string[] = []
  if (!near(usd.cacheWrite, usd.input * 1.25)) {
    problems.push(
      `${quote.model}: a five-minute write of $${usd.cacheWrite} is not 1.25 times input ($${usd.input})`,
    )
  }
  if (!near(usd.cacheWrite1h, usd.input * 2)) {
    problems.push(
      `${quote.model}: an hour-long write of $${usd.cacheWrite1h} is not twice input ($${usd.input})`,
    )
  }
  if (
    !readMultiples.some((multiple) => near(usd.cacheRead, usd.input * multiple))
  ) {
    problems.push(
      `${quote.model}: a cache read of $${usd.cacheRead} is none of ${readMultiples.join(", ").replace(/, ([^,]*)$/, " or $1")} times input ($${usd.input})`,
    )
  }
  return problems
}

const same = (a: number | null | undefined, b: number | null | undefined) =>
  a === null ||
  a === undefined ||
  b === null ||
  b === undefined ||
  near(Number(a), Number(b))

/** Whether two quotes say the same price; what one leaves out (fast mode, say) is no quarrel. */
export const quotesAgree = (a: FeedQuote, b: FeedQuote) => {
  const x = usdOf(a)
  const y = usdOf(b)
  return (
    near(x.input, y.input) &&
    near(x.output, y.output) &&
    near(x.cacheRead, y.cacheRead) &&
    near(x.cacheWrite, y.cacheWrite) &&
    near(x.cacheWrite1h, y.cacheWrite1h) &&
    same(a.longPromptTokens, b.longPromptTokens) &&
    same(a.longPromptFactor, b.longPromptFactor) &&
    same(a.fastFactor, b.fastFactor)
  )
}

const exact = (a: number | null | undefined, b: number | null | undefined) =>
  Math.round(Number(a ?? 0) * 1e9) === Math.round(Number(b ?? 0) * 1e9)

/** Whether a quote says something other than the price in force (or there is none). */
export const quoteDiffers = (
  current: FeedQuote | undefined,
  quote: FeedQuote,
) => {
  if (!current) return true
  const now = usdOf(current)
  const then = usdOf(quote)
  return (
    !exact(now.input, then.input) ||
    !exact(now.output, then.output) ||
    !exact(now.cacheRead, then.cacheRead) ||
    !exact(now.cacheWrite, then.cacheWrite) ||
    !exact(now.cacheWrite1h, then.cacheWrite1h) ||
    !exact(current.longPromptTokens, quote.longPromptTokens) ||
    !exact(current.longPromptFactor, quote.longPromptFactor) ||
    !exact(current.fastFactor ?? 1, quote.fastFactor ?? 1)
  )
}

/** What the sources come to for one model: the price, who said it, and what is odd about it. */
export type Consensus = {
  quote: FeedQuote
  sources: string[]
  problems: string[]
}

/**
 * The price the sources agree on, from the quotes for one model in order of trust: the first
 * that another agrees with, filled in with what the agreeing ones add -- and where none agree,
 * or only one answered, the most trusted, flagged.
 */
export const consensusOf = (
  quotes: readonly FeedQuote[],
): Consensus | undefined => {
  const first = quotes[0]
  if (!first) return undefined
  const backed = (quote: FeedQuote) =>
    quotes.some((other) => other !== quote && quotesAgree(quote, other))
  const agreed = quotes.find(backed)
  const chosen = agreed ?? first
  const agreeing = quotes.filter(
    (quote) => quote === chosen || quotesAgree(quote, chosen),
  )
  const filled: FeedQuote = { ...chosen }
  agreeing.forEach((quote) => {
    filled.longPromptTokens = filled.longPromptTokens ?? quote.longPromptTokens
    filled.longPromptFactor = filled.longPromptFactor ?? quote.longPromptFactor
    filled.fastFactor = filled.fastFactor ?? quote.fastFactor
  })
  const sources = agreeing.map((quote) => quote.source)
  filled.source = sources.join(" + ")
  const problems = [...multipleProblems(filled)]
  if (quotes.length === 1) {
    problems.push(`${chosen.model}: only ${chosen.source} answered`)
  } else if (!agreed) {
    problems.push(
      `${chosen.model}: the sources disagree (${quotes.map((quote) => `${quote.source} says $${quote.inputUsd} in, $${quote.outputUsd} out`).join("; ")})`,
    )
  } else if (agreeing.length < quotes.length) {
    const others = quotes
      .filter((quote) => !agreeing.includes(quote))
      .map((quote) => quote.source)
    problems.push(`${chosen.model}: ${others.join(" and ")} said otherwise`)
  }
  return { quote: filled, sources, problems }
}

/** A proposal waiting for the admin, as the store hands it back. */
export type PendingProposal = {
  id: number
  model: string
  kinds: readonly KindPrice[]
  longPromptUnits?: number | null
  longPromptFactor?: number | null
  factors?: readonly { dimension: string; value: string; factor: number }[]
}

const fastOf = (
  factors: readonly { dimension: string; value: string; factor: number }[] = [],
) =>
  factors.find((one) => one.dimension === "speed" && one.value === "fast")
    ?.factor ?? null

/** What the sync does for one model. */
export type SyncStep =
  | { model: string; action: "unknown" }
  | { model: string; action: "unchanged" }
  | { model: string; action: "confirm"; priceId?: number; retire: boolean }
  | { model: string; action: "propose"; said: Consensus }

/**
 * What a sync means to do for each model offered: nothing for a model no source knows; confirm
 * the price in force where the sources agree with it (retiring a proposal they no longer back);
 * leave a pending proposal that already says this; otherwise propose.
 */
export const syncPlan = (
  models: readonly string[],
  quotes: readonly FeedQuote[],
  prices: readonly (ModelPrice & { id?: number })[],
  proposals: readonly PendingProposal[],
  factors: readonly PriceFactor[] = [],
  now: Date = new Date(),
): SyncStep[] =>
  models.map((model): SyncStep => {
    const said = consensusOf(quotes.filter((quote) => quote.model === model))
    if (!said) return { model, action: "unknown" }
    const inForce = priceInForce(prices, model, now)
    const fast = factors
      .filter(
        (one) =>
          one.model === model &&
          one.dimension === "speed" &&
          one.value === "fast" &&
          new Date(one.effectiveFrom).getTime() <= now.getTime(),
      )
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]?.factor
    const current = inForce
      ? quoteOfPrice(inForce, "in force", fast)
      : undefined
    const pending = proposals.find((proposal) => proposal.model === model)
    if (current && !quoteDiffers(current, said.quote)) {
      return {
        model,
        action: "confirm",
        priceId: inForce?.id,
        retire: Boolean(pending),
      }
    }
    if (
      pending &&
      !quoteDiffers(
        quoteOfPrice(pending, "pending", fastOf(pending.factors)),
        said.quote,
      )
    ) {
      return { model, action: "unchanged" }
    }
    return { model, action: "propose", said }
  })

/** A feed to read: where, and how to read what it answers. */
export type PriceFeed = {
  name: string
  url: string
  read: (body: string) => FeedQuote[]
}

/** The three feeds, read for one provider (Anthropic by default). */
export const defaultFeeds = (
  options: { provider?: string; vendor?: string; modelPrefix?: string } = {},
): PriceFeed[] => [
  {
    ...PRICE_FEEDS.anthropicPricingPage,
    read: (body) => parseAnthropicPricingPage(body),
  },
  {
    ...PRICE_FEEDS.litellm,
    read: (body) => parseLitellm(JSON.parse(body), options),
  },
  {
    ...PRICE_FEEDS.openrouter,
    read: (body) => parseOpenRouter(JSON.parse(body), options),
  },
]

/**
 * Every feed read, each with its own timeout; a feed that does not answer, or answers what
 * does not read, is logged and left out. Quotes come back in the feeds' order of trust.
 */
export const fetchQuotes = async (
  fetcher: (
    url: string,
    init: { signal: AbortSignal },
  ) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>,
  feeds: readonly PriceFeed[] = defaultFeeds(),
  options: {
    timeoutMs?: number
    log?: (message: string, error?: unknown) => void
  } = {},
) => {
  const {
    timeoutMs = 15000,
    log = (message, error) => console.error(message, error),
  } = options
  const answers = await Promise.all(
    feeds.map(async (feed) => {
      try {
        const answer = await fetcher(feed.url, {
          signal: AbortSignal.timeout(timeoutMs),
        })
        if (!answer.ok) throw new Error(`${feed.url} answered ${answer.status}`)
        return feed.read(await answer.text())
      } catch (error) {
        log(`[pricing] ${feed.name} could not be read`, error)
        return []
      }
    }),
  )
  return answers.flat()
}

/**
 * A daily sync: what the feeds say about each model offered, held against the prices in force
 * and the proposals waiting. Confirms, proposes, or leaves alone; never prices anything.
 * `onProposed` is told of the models proposed (to tell the admin).
 */
export const syncPrices = async (options: {
  store: CreditStore
  models: readonly string[]
  quotes: readonly FeedQuote[]
  onProposed?: (models: string[]) => Promise<void> | void
  now?: Date
}) => {
  const { store, models, quotes, now = new Date() } = options
  const [prices, proposals, factors] = await Promise.all([
    store.prices(),
    store.pendingProposals(),
    store.factors(),
  ])
  const plan = syncPlan(models, quotes, prices, proposals, factors, now)
  const proposed: string[] = []
  for (const step of plan) {
    if (step.action === "confirm") {
      if (step.priceId) await store.confirmPrice(step.priceId)
      const pending = proposals.find(
        (proposal) => proposal.model === step.model,
      )
      if (step.retire && pending) await store.decideProposal(pending.id, false)
    }
    if (step.action === "propose") {
      const { quote, sources, problems } = step.said
      await store.propose({
        model: step.model,
        kinds: quoteKinds(quote),
        longPromptUnits: quote.longPromptTokens ?? null,
        longPromptFactor: quote.longPromptFactor ?? null,
        factors: quoteFactors(quote),
        sources,
        problems,
      })
      proposed.push(step.model)
    }
  }
  if (proposed.length > 0 && options.onProposed)
    await options.onProposed(proposed)
  return { plan, proposed }
}
