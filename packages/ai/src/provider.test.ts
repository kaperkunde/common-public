import { describe, expect, it } from "vitest"

import { LlmOffError } from "./config"
import { chatModel, providerCacheSize } from "./provider"

const backend = (extra: object = {}) => ({
  source: "deployment",
  baseURL: "http://h/v1",
  apiKey: "k",
  ...extra,
})

describe("chatModel", () => {
  it("refuses with no base URL", () => {
    expect(() => chatModel("m", backend({ baseURL: "" }))).toThrow(LlmOffError)
  })

  it("speaks OpenAI-compatible by default, Anthropic's own when asked", () => {
    const compatible = chatModel("m", backend()) as {
      modelId: string
      provider: string
    }
    expect(compatible.modelId).toBe("m")
    expect(compatible.provider).toContain("openai-compatible")
    const anthropic = chatModel(
      "claude-x",
      backend({
        provider: "anthropic",
        baseURL: "https://api.anthropic.com/v1",
      }),
    ) as {
      modelId: string
      provider: string
    }
    expect(anthropic.modelId).toBe("claude-x")
    expect(anthropic.provider).toContain("anthropic")
  })

  it("names the provider as asked", () => {
    const named = chatModel("m", backend({ providerName: "own-model" })) as {
      provider: string
    }
    expect(named.provider).toContain("own-model")
  })

  it("builds a provider once per address and key, and is bounded", () => {
    chatModel("m", backend({ apiKey: "same" }))
    const before = providerCacheSize()
    chatModel("m2", backend({ apiKey: "same" }))
    expect(providerCacheSize()).toBe(before)
    chatModel("m", backend({ apiKey: "other" }))
    expect(providerCacheSize()).toBe(before + 1)
    for (let i = 0; i < 250; i++) chatModel("m", backend({ apiKey: `key${i}` }))
    expect(providerCacheSize()).toBeLessThanOrEqual(200)
  })
})
