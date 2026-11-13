import { describe, expect, it } from "vitest"

import {
  LLM_OFF_MESSAGE,
  LlmOffError,
  defineLlmConfig,
  llmConfigProblem,
  llmProviderOf,
  modelFor,
  parseModels,
} from "./config"

describe("parseModels", () => {
  it("trims, drops blanks and keeps order, from a string or an array", () => {
    expect(parseModels(" a , b,,c ")).toEqual(["a", "b", "c"])
    expect(parseModels([" x ", "", "y"])).toEqual(["x", "y"])
    expect(parseModels(undefined)).toEqual([])
    expect(parseModels(null)).toEqual([])
  })
})

describe("llmProviderOf", () => {
  it("honours an explicit name", () => {
    expect(llmProviderOf("Anthropic", "http://x")).toBe("anthropic")
    expect(llmProviderOf("openai", "https://api.anthropic.com")).toBe(
      "openai-compatible",
    )
    expect(llmProviderOf("openai-compatible", "")).toBe("openai-compatible")
  })
  it("reads Anthropic's host when none is named", () => {
    expect(llmProviderOf(undefined, "https://api.anthropic.com/v1")).toBe(
      "anthropic",
    )
    expect(llmProviderOf(null, "http://localhost:11434/v1")).toBe(
      "openai-compatible",
    )
    expect(llmProviderOf("", "not a url")).toBe("openai-compatible")
  })
})

describe("defineLlmConfig", () => {
  it("is enabled with a base and models, and trims the base", () => {
    const config = defineLlmConfig({
      baseURL: " http://h/v1/// ",
      apiKey: " k ",
      models: "m1, m2",
    })
    expect(config).toMatchObject({
      enabled: true,
      baseURL: "http://h/v1",
      apiKey: "k",
      models: ["m1", "m2"],
      defaultModel: "m1",
      toolChoice: "required",
      provider: "openai-compatible",
    })
  })
  it("never throws and reads as off when half-configured", () => {
    expect(defineLlmConfig({}).enabled).toBe(false)
    expect(defineLlmConfig({ baseURL: "http://h" }).enabled).toBe(false)
    expect(defineLlmConfig({ models: ["m"] }).enabled).toBe(false)
    expect(defineLlmConfig({}).apiKey).toBeUndefined()
  })
  it("reads tool choice auto", () => {
    expect(defineLlmConfig({ toolChoice: " AUTO " }).toolChoice).toBe("auto")
  })
})

describe("llmConfigProblem", () => {
  it("names which half is missing, using the app's own names", () => {
    expect(
      llmConfigProblem(defineLlmConfig({ baseURL: "http://h" }), {
        baseURL: "BASE",
        models: "MODELS",
      }),
    ).toContain("MODELS names no model")
    expect(
      llmConfigProblem(defineLlmConfig({ models: "m" }), {
        baseURL: "BASE",
        models: "MODELS",
      }),
    ).toContain("BASE is unset")
    expect(llmConfigProblem(defineLlmConfig({}))).toBe(LLM_OFF_MESSAGE)
    expect(
      llmConfigProblem(defineLlmConfig({ baseURL: "h", models: "m" })),
    ).toBeUndefined()
  })
})

describe("modelFor and LlmOffError", () => {
  const config = defineLlmConfig({ baseURL: "h", models: "a,b" })
  it("keeps a chosen model that is still offered, else the default", () => {
    expect(modelFor("b", config)).toBe("b")
    expect(modelFor("gone", config)).toBe("a")
    expect(modelFor(null, config)).toBe("a")
  })
  it("carries its message", () => {
    expect(new LlmOffError().message).toBe(LLM_OFF_MESSAGE)
    expect(new LlmOffError("x").name).toBe("LlmOffError")
  })
})
