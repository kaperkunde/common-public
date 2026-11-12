import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it, vi } from "vitest"

import type { CreditStore } from "./store"
import {
  consensusOf,
  priceFeeds,
  fetchQuotes,
  PRICE_FEEDS,
  syncPrices,
  modelIdOf,
  multipleProblems,
  parseLitellm,
  parseOpenRouter,
  parseAnthropicPricingPage,
  quoteFactors,
  quoteKinds,
  quoteOfPrice,
  quotesAgree,
  syncPlan,
} from "./feeds"

// Copies of what each feed answered on 2026-11-01.
const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, "fixtures", name), "utf8")
const page = parseAnthropicPricingPage(fixture("anthropic-pricing.md"))
const litellm = parseLitellm(JSON.parse(fixture("litellm-prices.json")), {
  provider: "anthropic",
  modelPrefix: "claude-",
})
const openrouter = parseOpenRouter(
  JSON.parse(fixture("openrouter-models.json")),
  { vendor: "anthropic", modelPrefix: "claude-" },
)
const of = (quotes: typeof page, model: string) =>
  quotes.find((quote) => quote.model === model)

describe("reading the price lists", () => {
  it("names a model the way LLM_MODELS does", () => {
    expect(modelIdOf("Claude Opus 5.5")).toBe("claude-opus-5-5")
    expect(
      modelIdOf(
        "Claude Mythos 5.1 ([limited availability](https://example.com))",
      ),
    ).toBe("claude-mythos-5-1")
    expect(
      modelIdOf("Claude Haiku 5.5 (for prompts up to 100,000 tokens)"),
    ).toBe("claude-haiku-5-5")
    expect(modelIdOf("claude-sonnet-5.5")).toBe("claude-sonnet-5-5")
  })

  it("reads the pricing page, its long-prompt tier and its fast mode", () => {
    expect(of(page, "claude-opus-5-5")).toMatchObject({
      inputUsd: 4,
      outputUsd: 20,
      cacheReadUsd: 0.2,
      cacheWriteUsd: 5,
      cacheWrite1hUsd: 8,
      fastFactor: 2,
    })
    expect(of(page, "claude-opus-4-8")?.fastFactor).toBe(2)
    expect(of(page, "claude-sonnet-5-5")?.cacheReadUsd).toBe(0.1)
    expect(of(page, "claude-haiku-5-5")).toMatchObject({
      inputUsd: 0.1,
      longPromptTokens: 100000,
      longPromptFactor: 5,
    })
    expect(of(page, "claude-fable-5-1")?.cacheReadUsd).toBe(0.25)
  })

  it("reads LiteLLM for Anthropic's own API alone", () => {
    expect(of(litellm, "claude-opus-5-5")).toMatchObject({
      inputUsd: 4,
      outputUsd: 20,
      cacheReadUsd: 0.2,
      cacheWrite1hUsd: 8,
      fastFactor: 2,
    })
    expect(of(litellm, "claude-haiku-5-5")).toMatchObject({
      longPromptTokens: 100000,
      longPromptFactor: 5,
    })
    expect(litellm.some((quote) => quote.model.includes("anthropic."))).toBe(
      false,
    )
  })

  it("reads OpenRouter, leaving the batch variants out", () => {
    expect(of(openrouter, "claude-sonnet-5-5")).toMatchObject({
      inputUsd: 2,
      outputUsd: 10,
      cacheReadUsd: 0.1,
      cacheWriteUsd: 2.5,
      cacheWrite1hUsd: 4,
    })
    expect(of(openrouter, "claude-haiku-5-5")?.longPromptFactor).toBe(5)
    expect(
      openrouter.filter((quote) => quote.model === "claude-opus-5-5"),
    ).toHaveLength(1)
  })

  it("reads nothing out of what is not a price list", () => {
    expect(parseAnthropicPricingPage("# Nothing here\n\nNo tables.")).toEqual(
      [],
    )
    expect(parseLitellm(null, { provider: "anthropic" })).toEqual([])
    expect(parseOpenRouter({ data: "no" }, { vendor: "anthropic" })).toEqual([])
  })

  it("assumes no provider, vendor or model prefix", () => {
    const list = JSON.parse(fixture("litellm-prices.json"))
    expect(() => parseLitellm(list, {} as never)).toThrow(/provider/)
    expect(() =>
      parseOpenRouter(JSON.parse(fixture("openrouter-models.json")), {
        vendor: "",
      }),
    ).toThrow(/vendor/)
    // With no prefix, every model of the provider is read.
    const all = parseLitellm(list, { provider: "anthropic" })
    expect(all.length).toBeGreaterThanOrEqual(litellm.length)
    expect(priceFeeds({})).toEqual([])
    expect(
      priceFeeds({ litellm: { provider: "openai" } }).map((feed) => feed.name),
    ).toEqual([PRICE_FEEDS.litellm.name])
  })
})

describe("what the sources come to", () => {
  it("takes the price two sources agree on, filled in with what each adds", () => {
    const said = consensusOf([
      of(page, "claude-opus-5-5")!,
      of(litellm, "claude-opus-5-5")!,
      of(openrouter, "claude-opus-5-5")!,
    ])
    expect(said?.sources).toEqual([
      "anthropic pricing page",
      "litellm",
      "openrouter",
    ])
    expect(said?.quote).toMatchObject({ inputUsd: 4, fastFactor: 2 })
    expect(said?.problems).toEqual([])
  })

  it("sides with the two that agree, and says who did not", () => {
    const wrong = {
      ...of(page, "claude-sonnet-5-5")!,
      inputUsd: 3,
      cacheWriteUsd: 3.75,
      cacheWrite1hUsd: 6,
    }
    const said = consensusOf([
      wrong,
      of(litellm, "claude-sonnet-5-5")!,
      of(openrouter, "claude-sonnet-5-5")!,
    ])
    expect(said?.quote.inputUsd).toBe(2)
    expect(said?.problems.join(" ")).toContain(
      "anthropic pricing page said otherwise",
    )
  })

  it("flags a single source, sources that disagree, and a price off its multiples", () => {
    const one = consensusOf([of(page, "claude-opus-5-5")!])
    expect(one?.problems.join(" ")).toContain(
      "only anthropic pricing page answered",
    )
    const odd = { ...of(page, "claude-opus-5-5")!, cacheReadUsd: 0.3 }
    expect(multipleProblems(odd).join(" ")).toContain(
      "none of 0.1, 0.05 or 0.025",
    )
    const apart = consensusOf([odd, { ...odd, source: "litellm", inputUsd: 9 }])
    expect(apart?.problems.join(" ")).toContain("the sources disagree")
    expect(consensusOf([])).toBeUndefined()
  })
})

describe("what a sync means to do", () => {
  const opus = of(page, "claude-opus-5-5")!
  const quotes = [opus, of(litellm, "claude-opus-5-5")!]
  const asPrice = (quote: typeof opus) => ({
    model: quote.model,
    kinds: quoteKinds(quote),
    longPromptUnits: quote.longPromptTokens,
    longPromptFactor: quote.longPromptFactor,
    effectiveFrom: "2026-11-01T00:00:00Z",
  })
  const inForce = asPrice(opus)
  const fast = [
    {
      model: "claude-opus-5-5",
      dimension: "speed",
      value: "fast",
      factor: 2,
      effectiveFrom: "2026-11-01T00:00:00Z",
    },
  ]
  const now = new Date("2026-11-11T00:00:00Z")

  it("confirms a price the sources agree with, and leaves a model they do not know", () => {
    const plan = syncPlan(
      ["claude-opus-5-5", "fake-small"],
      quotes,
      [inForce],
      [],
      fast,
      now,
    )
    expect(plan.map((step) => step.action)).toEqual(["confirm", "unknown"])
  })

  it("proposes a price that differs, and a model never priced, but only once", () => {
    const old = asPrice({
      ...opus,
      inputUsd: 5,
      cacheWriteUsd: 6.25,
      cacheWrite1hUsd: 10,
    })
    const plan = syncPlan(["claude-opus-5-5"], quotes, [old], [], fast, now)
    expect(plan[0]).toMatchObject({
      action: "propose",
      said: { quote: { inputUsd: 4 } },
    })
    expect(syncPlan(["claude-opus-5-5"], quotes, [], [])[0]?.action).toBe(
      "propose",
    )
    const waiting = {
      ...asPrice(opus),
      id: 1,
      factors: quoteFactors(opus),
    }
    expect(
      syncPlan(["claude-opus-5-5"], quotes, [old], [waiting], fast, now)[0]
        ?.action,
    ).toBe("unchanged")
    expect(
      syncPlan(["claude-opus-5-5"], quotes, [inForce], [waiting], fast, now)[0],
    ).toMatchObject({ action: "confirm", retire: true })
  })
})

describe("a quote and a price", () => {
  it("go back and forth through the kinds a price is set with", () => {
    const opus = page.find((quote) => quote.model === "claude-opus-5-5")!
    const back = quoteOfPrice(
      { model: opus.model, kinds: quoteKinds(opus) },
      "x",
      opus.fastFactor,
    )
    expect(quotesAgree(back, opus)).toBe(true)
    expect(quoteFactors({ fastFactor: 1 })).toEqual([])
  })
})

describe("the sync", () => {
  it("reads every feed it can, and leaves out one that fails", async () => {
    const bodies: Record<string, string> = {
      [PRICE_FEEDS.anthropicPricingPage.url]: fixture("anthropic-pricing.md"),
      [PRICE_FEEDS.litellm.url]: fixture("litellm-prices.json"),
    }
    const log = vi.fn()
    const quotes = await fetchQuotes(
      async (url) => ({
        ok: url in bodies,
        status: url in bodies ? 200 : 503,
        text: async () => bodies[url] ?? "",
      }),
      priceFeeds({
        anthropicPricingPage: true,
        litellm: { provider: "anthropic", modelPrefix: "claude-" },
        openRouter: { vendor: "anthropic", modelPrefix: "claude-" },
      }),
      { log },
    )
    expect(quotes.some((quote) => quote.source === "litellm")).toBe(true)
    expect(quotes.some((quote) => quote.source === "openrouter")).toBe(false)
    expect(log).toHaveBeenCalledTimes(1)
  })

  it("proposes what differs and prices nothing itself", async () => {
    const store = {
      prices: vi.fn(async () => []),
      pendingProposals: vi.fn(async () => []),
      factors: vi.fn(async () => []),
      propose: vi.fn(async () => undefined),
      confirmPrice: vi.fn(async () => undefined),
      decideProposal: vi.fn(async () => true),
      setModelPrice: vi.fn(),
    } as unknown as CreditStore
    const onProposed = vi.fn()
    const outcome = await syncPrices({
      store,
      models: ["claude-opus-5-5", "nobody"],
      quotes: [...page, ...litellm],
      onProposed,
    })
    expect(outcome.proposed).toEqual(["claude-opus-5-5"])
    expect(store.propose).toHaveBeenCalledTimes(1)
    expect(store.setModelPrice).not.toHaveBeenCalled()
    expect(onProposed).toHaveBeenCalledWith(["claude-opus-5-5"])
  })
})
