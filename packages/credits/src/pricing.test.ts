import { describe, expect, it } from "vitest"

import {
  DEFAULT_KIND_FALLBACKS,
  callUsd,
  creditCost,
  creditRatesOf,
  dimensionsOf,
  factorAt,
  kindIsSet,
  resolveKinds,
  kindUsd,
  priceInForce,
  priceText,
  pricedCall,
  rateInForce,
  requestFactor,
  tokenKinds,
  tokenSplitText,
  usdText,
  type ModelPrice,
  type PriceFactor,
} from "./pricing"

const now = new Date("2026-11-11T12:00:00.000Z")
// Dollars per million, under a million credits to the dollar: $1 a million is a credit a token.
const ratio = 1_000_000

const price = (
  input: number,
  output: number,
  extra: Partial<ModelPrice> & { cacheRead?: number } = {},
): ModelPrice => ({
  model: extra.model ?? "m",
  effectiveFrom: "2026-01-01T00:00:00Z",
  kinds: [
    { kind: "input", usdPerMillion: input },
    { kind: "output", usdPerMillion: output },
    ...(extra.cacheRead !== undefined
      ? [{ kind: "cache_read", usdPerMillion: extra.cacheRead }]
      : []),
    ...(extra.kinds ?? []),
  ],
  longPromptUnits: extra.longPromptUnits,
  longPromptFactor: extra.longPromptFactor,
})

describe("the price arithmetic", () => {
  it("converts each kind at its own price, times the ratio", () => {
    const usage = { inputTokens: 100, outputTokens: 20 }
    expect(creditCost(usage, price(1, 5), ratio)).toBe(200)
    expect(creditCost(usage, price(1, 5), ratio * 2)).toBe(400)
  })

  it("rounds up, since a fraction of a credit is still spent", () => {
    expect(
      creditCost({ inputTokens: 3, outputTokens: 0 }, price(0.1, 1), ratio),
    ).toBe(1)
    expect(
      creditCost({ inputTokens: 0, outputTokens: 0 }, price(0.1, 1), ratio),
    ).toBe(0)
  })

  it("charges a cached prompt at its own price where it has one", () => {
    // 20 fresh at 1, 80 cached at 0.1, 10 out at 5: 20 + 8 + 50, and not a hair over.
    expect(
      creditCost(
        { inputTokens: 100, cachedTokens: 80, outputTokens: 10 },
        price(1, 5, { cacheRead: 0.1 }),
        ratio,
      ),
    ).toBe(78)
  })

  it("works out every empty cache price from the fallbacks", () => {
    const p = price(4, 20)
    expect(kindUsd(p, "cache_read")).toBeCloseTo(0.4)
    expect(kindUsd(p, "cache_write")).toBe(5)
    expect(kindUsd(p, "cache_write_1h")).toBe(8)
    expect(kindIsSet(p, "cache_read")).toBe(false)
    expect(kindIsSet(price(4, 20, { cacheRead: 0.2 }), "cache_read")).toBe(true)
    expect(kindUsd(p, "tts_chars")).toBeUndefined()
    expect(kindUsd(p, "cache_read", [])).toBeUndefined()
    // 100 prompt: 50 read, 30 written of which 10 kept an hour, 20 fresh; and 10 out.
    expect(
      creditCost(
        {
          inputTokens: 100,
          cachedTokens: 50,
          cacheWriteTokens: 30,
          cacheWrite1hTokens: 10,
          outputTokens: 10,
        },
        price(1, 5),
        ratio,
      ),
    ).toBe(20 + 5 + 25 + 20 + 50)
  })

  it("never counts one kind past the one holding it", () => {
    expect(
      tokenKinds({
        inputTokens: 10,
        outputTokens: 0,
        cachedTokens: 50,
        cacheWriteTokens: 5,
        cacheWrite1hTokens: 9,
      }),
    ).toEqual({
      input: 0,
      cache_read: 10,
      cache_write: 0,
      cache_write_1h: 0,
      output: 0,
    })
    expect(
      tokenKinds({
        inputTokens: 10,
        outputTokens: 1,
        cachedTokens: -5,
        cacheWriteTokens: 4,
        cacheWrite1hTokens: 9,
      }),
    ).toEqual({
      input: 6,
      cache_read: 0,
      cache_write: 0,
      cache_write_1h: 4,
      output: 1,
    })
  })

  it("prices a call request by request, with each request's own factors", () => {
    const tiered = price(0.1, 0.5, {
      cacheRead: 0.01,
      longPromptUnits: 100000,
      longPromptFactor: 5,
    })
    const factors: PriceFactor[] = [
      {
        dimension: "inference_geo",
        value: "us",
        factor: 1.1,
        effectiveFrom: "2026-01-01T00:00:00Z",
      },
    ]
    const usage = {
      inputTokens: 150001,
      outputTokens: 200,
      requests: [
        { inputTokens: 50000, outputTokens: 100 },
        {
          inputTokens: 100001,
          cachedTokens: 100000,
          outputTokens: 100,
          inferenceGeo: "us",
        },
      ],
    }
    expect(creditCost(usage, tiered, ratio, { factors, at: now })).toBe(
      Math.ceil(5050 + 5775.55),
    )
    expect(callUsd({ ...usage, requests: null }, tiered)).toBeGreaterThan(
      callUsd(usage, tiered),
    )
    expect(
      pricedCall(usage, tiered, { factors, at: now }).byKind.cache_read,
    ).toBeCloseTo(0.0055)
  })

  it("prices usage that is not tokens through the same ledger", () => {
    const speech = price(0, 0, {
      kinds: [{ kind: "tts_chars", unit: "char", usdPerMillion: 15 }],
    })
    // 2,000 characters at $15 a million is 3 cents: 30,000 credits.
    expect(creditCost({ units: { tts_chars: 2000 } }, speech, ratio)).toBe(
      30000,
    )
    const unpriced = pricedCall({ units: { tts_seconds: 10 } }, speech)
    expect(unpriced.unpriced).toEqual(["tts_seconds"])
    expect(unpriced.total).toBe(0)
  })

  it("multiplies by a model's own factor over every model's", () => {
    const factors: PriceFactor[] = [
      {
        model: "m",
        dimension: "speed",
        value: "fast",
        factor: 2,
        effectiveFrom: "2026-01-01T00:00:00Z",
      },
      {
        dimension: "service_tier",
        value: "batch",
        factor: 0.5,
        effectiveFrom: "2026-01-01T00:00:00Z",
      },
    ]
    const fast = { inputTokens: 1, outputTokens: 0, speed: "fast" }
    expect(requestFactor(fast, price(1, 1), factors, now)).toBe(2)
    expect(
      requestFactor(fast, { ...price(1, 1), model: "other" }, factors, now),
    ).toBe(1)
    expect(
      requestFactor(
        { inputTokens: 1, outputTokens: 0, serviceTier: "batch" },
        price(1, 1),
        factors,
        now,
      ),
    ).toBe(0.5)
    expect(
      dimensionsOf({ inferenceGeo: "us", dimensions: { region: "eu" } }),
    ).toEqual({ inference_geo: "us", region: "eu" })
  })

  it("reads the factors, the price and the ratio in force at a moment", () => {
    const factors: PriceFactor[] = [1.1, 1.2, 9].map((factor, index) => ({
      dimension: "inference_geo",
      value: "us",
      factor,
      effectiveFrom: [
        "2026-01-01T00:00:00Z",
        "2026-10-01T00:00:00Z",
        "2027-01-01T00:00:00Z",
      ][index] as string,
    }))
    expect(factorAt(factors, "m", "inference_geo", "us", now)).toBe(1.2)
    expect(factorAt(factors, "m", "inference_geo", "eu", now)).toBe(1)
    expect(
      rateInForce(
        [
          { perDollar: 1, effectiveFrom: "2026-01-01T00:00:00Z" },
          { perDollar: 2, effectiveFrom: "2026-09-01T00:00:00Z" },
        ],
        now,
      )?.perDollar,
    ).toBe(2)
    expect(rateInForce([], now)).toBeUndefined()
    const prices = [
      { ...price(1, 1), effectiveFrom: "2026-01-01T00:00:00Z" },
      { ...price(2, 2), effectiveFrom: "2026-06-01T00:00:00Z" },
      { ...price(3, 3), effectiveFrom: "2027-01-01T00:00:00Z" },
    ]
    expect(priceInForce(prices, "m", now)?.kinds[0]?.usdPerMillion).toBe(2)
    expect(priceInForce(prices, "nobody", now)).toBeUndefined()
    expect(
      priceInForce(prices, "m", new Date("2025-01-01T00:00:00Z")),
    ).toBeUndefined()
  })

  it("says what a price comes to in credits per unit", () => {
    const rates = creditRatesOf(price(2, 10), ratio)
    expect(rates.input).toBe(2)
    expect(rates.output).toBe(10)
    expect(rates.cache_read).toBeCloseTo(0.2)
    expect(rates.cache_write_1h).toBe(4)
    expect(creditRatesOf(price(2, 10), ratio, DEFAULT_KIND_FALLBACKS)).toEqual(
      rates,
    )
  })

  it("says a price the way the admin reads it", () => {
    expect(priceText(price(2, 10, { cacheRead: 0.2 }))).toBe(
      "$2 in, $10 out, $0.20 cache reads (set), $2.50 cache writes (5 min), $4 cache writes (1 h)",
    )
    expect(
      priceText({
        kinds: [{ kind: "tts_chars", unit: "char", usdPerMillion: 15 }],
      }),
    ).toBe("$15 tts_chars per M char")
    expect(usdText(0.025)).toBe("$0.025")
    expect(usdText(12.5)).toBe("$12.50")
  })

  it("says a call's tokens with what the cache served set apart", () => {
    expect(tokenSplitText({ input: 42000, cached: 30000, output: 400 })).toBe(
      "12k in (30k cached) · 400 out",
    )
    expect(tokenSplitText({ input: 900, output: 1500 })).toBe(
      "900 in · 1.5k out",
    )
  })
})

describe("a price's kinds as they are stored", () => {
  it("writes every kind a fallback works out onto the version, marked derived", () => {
    const kinds = resolveKinds([
      { kind: "input", usdPerMillion: 4 },
      { kind: "output", usdPerMillion: 20 },
      { kind: "cache_write", usdPerMillion: 6 },
    ])
    expect(kinds).toEqual([
      { kind: "input", usdPerMillion: 4 },
      { kind: "output", usdPerMillion: 20 },
      { kind: "cache_write", usdPerMillion: 6 },
      { kind: "cache_read", unit: "token", usdPerMillion: 0.4, derived: true },
      {
        kind: "cache_write_1h",
        unit: "token",
        usdPerMillion: 8,
        derived: true,
      },
    ])
    // A derived kind is not "set", and a stored price read back resolves the same way again.
    expect(kindIsSet({ kinds }, "cache_read")).toBe(false)
    expect(kindIsSet({ kinds }, "cache_write")).toBe(true)
    expect(resolveKinds(kinds)).toEqual(kinds)
  })

  it("prices a stored version by its own rows, whatever the fallbacks become", () => {
    const kinds = resolveKinds([
      { kind: "input", usdPerMillion: 10 },
      { kind: "output", usdPerMillion: 10 },
    ])
    const usage = {
      inputTokens: 1_000_000,
      cachedTokens: 1_000_000,
      outputTokens: 0,
    }
    const price = { model: "m", kinds }
    // The fallbacks a price is read with are only for kinds it lacks; it lacks none here.
    expect(
      callUsd(usage, price, {
        fallbacks: [{ kind: "cache_read", baseKind: "input", multiple: 0.5 }],
      }),
    ).toBeCloseTo(1)
    // Nothing to derive from: no derived kinds.
    expect(resolveKinds([{ kind: "tts_chars", usdPerMillion: 15 }])).toEqual([
      { kind: "tts_chars", usdPerMillion: 15 },
    ])
  })
})
