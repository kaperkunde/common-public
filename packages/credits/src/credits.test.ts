import { describe, expect, it } from "vitest"

import { CreditsRefusedError, kindsNeeded, ledgerRowOf } from "./credits"

describe("a hook's usage as a ledger row", () => {
  it("sums an LLM call's requests and keeps them for pricing", () => {
    const row = ledgerRowOf({
      userId: "ash",
      model: "m",
      purpose: "chat",
      requests: [
        { inputTokens: 100, outputTokens: 10, cachedTokens: 80, speed: "fast" },
        {
          inputTokens: 50,
          outputTokens: 5,
          cacheWriteTokens: 20,
          cacheWrite1hTokens: 5,
          reasoningTokens: 3,
        },
      ],
      scopeId: "world-1",
    })
    expect(row).toMatchObject({
      kind: "llm",
      inputTokens: 150,
      outputTokens: 15,
      totalTokens: 165,
      cachedTokens: 80,
      cacheWriteTokens: 20,
      cacheWrite1hTokens: 5,
      reasoningTokens: 3,
      speed: "fast",
      inferenceGeo: null,
      scopeId: "world-1",
      own: false,
      units: null,
    })
    expect(row.requests).toHaveLength(2)
  })

  it("writes speech as a quantity of its own kind", () => {
    expect(
      ledgerRowOf({
        userId: "ash",
        model: "voice",
        purpose: "speech",
        kind: "tts_chars",
        units: 1200,
      }),
    ).toMatchObject({
      kind: "tts_chars",
      units: { tts_chars: 1200 },
      totalTokens: 0,
      requests: null,
    })
    expect(
      ledgerRowOf({
        userId: "ash",
        model: "voice",
        purpose: "speech",
        units: { tts_seconds: 4 },
        source: "own",
      }),
    ).toMatchObject({ units: { tts_seconds: 4 }, own: true })
  })

  it("refuses with a code a hook can read", () => {
    const error = new CreditsRefusedError("OUT_OF_CREDITS", "none left")
    expect(error.code).toBe("OUT_OF_CREDITS")
    expect(error).toBeInstanceOf(Error)
  })
})

describe("the kinds a call needs priced", () => {
  it("asks input and output of a prompt-and-answer call, and the unit kind of a metered one", () => {
    expect(kindsNeeded()).toEqual(["input", "output"])
    expect(kindsNeeded("llm")).toEqual(["input", "output"])
    expect(kindsNeeded("tts_chars")).toEqual(["tts_chars"])
    expect(kindsNeeded(["llm", "tts_chars", "tts_chars"])).toEqual([
      "input",
      "output",
      "tts_chars",
    ])
    expect(kindsNeeded([])).toEqual(["input", "output"])
  })
})
