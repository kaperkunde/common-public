import { describe, expect, it } from "vitest"

import { requestOf, requestsOf } from "./usage"

describe("requestOf", () => {
  it("reads counts from the SDK's usage", () => {
    expect(
      requestOf({
        usage: {
          inputTokens: 100,
          outputTokens: 20,
          inputTokenDetails: { cacheReadTokens: 60, cacheWriteTokens: 10 },
        },
      }),
    ).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      cachedTokens: 60,
      cacheWriteTokens: 10,
      cacheWrite1hTokens: 0,
    })
  })

  it("reads Anthropic's hour-long write, geo, speed and tier, capped at the write", () => {
    const request = requestOf({
      usage: { inputTokens: 5, inputTokenDetails: { cacheWriteTokens: 8 } },
      providerMetadata: {
        anthropic: {
          usage: {
            cache_creation: { ephemeral_1h_input_tokens: 50 },
            inference_geo: "us",
            speed: "fast",
            service_tier: "standard",
          },
        },
      },
    })
    expect(request.cacheWrite1hTokens).toBe(8)
    expect(request).toMatchObject({
      inferenceGeo: "us",
      speed: "fast",
      serviceTier: "standard",
    })
  })

  it("treats missing, negative and rubbish counts as zero", () => {
    expect(
      requestOf({ usage: { inputTokens: -5, outputTokens: Number.NaN } }),
    ).toMatchObject({ inputTokens: 0, outputTokens: 0, cachedTokens: 0 })
    expect(requestOf({})).toMatchObject({ inputTokens: 0 })
  })
})

describe("requestsOf", () => {
  it("is empty for no steps", () => {
    expect(requestsOf(undefined)).toEqual({
      requests: [],
      cacheWrite1hTokens: 0,
    })
  })
  it("keeps a request a step and sums the hour-long writes", () => {
    const step = (write: number, h1: number, geo?: string) => ({
      usage: {
        inputTokens: 10,
        inputTokenDetails: { cacheWriteTokens: write },
      },
      providerMetadata: {
        anthropic: {
          usage: {
            cache_creation: { ephemeral_1h_input_tokens: h1 },
            inference_geo: geo,
          },
        },
      },
    })
    const result = requestsOf([step(4, 3), step(6, 2, "eu")])
    expect(result.requests).toHaveLength(2)
    expect(result.cacheWrite1hTokens).toBe(5)
    expect(result.inferenceGeo).toBe("eu")
    expect(result.speed).toBeUndefined()
  })
})
