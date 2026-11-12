import { describe, expect, it } from "vitest"

import {
  clipDeep,
  clipText,
  fitCall,
  flattenContent,
  tracedCall,
  tracedMessages,
  tracedStep,
} from "./trace"

describe("clipText and clipDeep", () => {
  it("says how much was left out", () => {
    expect(clipText("abcdef", 3)).toBe("abc… [3 more characters]")
    expect(clipText("abc", 3)).toBe("abc")
  })
  it("clips strings, long arrays, deep objects and drops undefined", () => {
    expect(clipDeep({ a: "xxxxx", b: undefined }, 2)).toEqual({
      a: "xx… [3 more characters]",
    })
    expect(
      (clipDeep(Array.from({ length: 70 }, (_, i) => i)) as unknown[]).length,
    ).toBe(61)
    let deep: unknown = "end"
    for (let i = 0; i < 12; i++) deep = { x: deep }
    expect(JSON.stringify(clipDeep(deep))).toContain("[…]")
    expect(clipDeep(new Date(0))).toBe("1970-01-01T00:00:00.000Z")
    expect(clipDeep(() => 1)).toMatch(/=>/)
  })
})

describe("flattenContent and tracedMessages", () => {
  it("flattens parts, saying non-text ones in brackets", () => {
    expect(
      flattenContent([
        { type: "text", text: "hi" },
        { type: "reasoning", text: "hm" },
        { type: "tool-call", toolName: "t", input: { a: 1 } },
        { type: "tool-result", toolName: "t", output: "ok" },
        { type: "image" },
      ]),
    ).toBe('hi\n[reasoning] hm\n[call t] {"a":1}\n[result t] "ok"\n[image]')
    expect(flattenContent({ a: 1 })).toBe('{"a":1}')
    expect(
      tracedMessages([{ role: "user", content: "hello" }], 3)[0]?.content,
    ).toBe("hel… [2 more characters]")
  })
})

describe("tracedStep and tracedCall", () => {
  it("keeps calls, results, errors and finish", () => {
    expect(
      tracedStep({
        text: "t",
        finishReason: "stop",
        toolCalls: [{ toolName: "a", input: { q: 1 } }],
        toolResults: [{ toolName: "a", output: "r" }],
        content: [
          { type: "tool-error", toolName: "b", error: new Error("bad") },
        ],
      }),
    ).toEqual({
      text: "t",
      calls: [{ tool: "a", input: { q: 1 } }],
      results: [{ tool: "a", output: "r" }],
      errors: [{ tool: "b", error: "bad" }],
      finish: "stop",
    })
  })

  it("builds a call with usage, ref and error", () => {
    const call = tracedCall({
      startedAt: 0,
      ms: 5,
      label: "x",
      model: "m",
      instructions: "i",
      messages: [{ role: "user", content: "u" }],
      steps: [{ finishReason: "stop" }],
      usageRef: "7",
      source: "own",
      usage: {
        inputTokens: 3,
        outputTokens: 2,
        inputTokenDetails: { cacheReadTokens: 1 },
      },
      failure: "boom",
    })
    expect(call).toMatchObject({
      kind: "call",
      at: "1970-01-01T00:00:00.000Z",
      label: "x",
      usageRef: "7",
      source: "own",
      finish: "stop",
      error: "boom",
      usage: { input: 3, output: 2, cached: 1, cacheWrite: 0, reasoning: 0 },
    })
  })
})

describe("fitCall", () => {
  const big = (n: number) =>
    tracedCall({
      startedAt: 0,
      ms: 1,
      model: "m",
      instructions: "i".repeat(n),
      messages: [{ role: "user", content: "u".repeat(n) }],
      steps: Array.from({ length: 30 }, () => ({ text: "s".repeat(n / 10) })),
      source: "own",
    })
  it("leaves a call that fits", () => {
    const small = big(10)
    expect(fitCall(small)).toBe(small)
  })
  it("clips until it fits and says so", () => {
    const fitted = fitCall(big(100_000), 50_000)
    expect(fitted.clipped).toBe(true)
    expect(JSON.stringify(fitted).length).toBeLessThanOrEqual(50_000)
  })
  it("drops steps past the shortest clip", () => {
    const fitted = fitCall(big(100_000), 3000)
    expect(fitted.clipped).toBe(true)
    expect(fitted.steps.length).toBeLessThan(30)
  })
})
