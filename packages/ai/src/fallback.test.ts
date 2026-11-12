import { describe, expect, it } from "vitest"

import { BackendRefusedError } from "./refusal"
import { fallbackWorthy } from "./fallback"

const named = (name: string, extra: object = {}) =>
  Object.assign(new Error("x"), { name }, extra)

describe("fallbackWorthy", () => {
  it("is for the provider's trouble", () => {
    expect(fallbackWorthy(named("TimeoutError"))).toBe(true)
    expect(fallbackWorthy(named("AI_APICallError", { statusCode: 503 }))).toBe(
      true,
    )
    expect(fallbackWorthy(named("AI_APICallError", { statusCode: 404 }))).toBe(
      true,
    )
    expect(fallbackWorthy(named("AI_APICallError", { statusCode: 429 }))).toBe(
      true,
    )
    expect(
      fallbackWorthy(
        named("AI_APICallError", { isRetryable: true, statusCode: 400 }),
      ),
    ).toBe(true)
    expect(fallbackWorthy(Object.assign(new TypeError("fetch failed")))).toBe(
      true,
    )
  })
  it("is not for a malformed request, an abort or rubbish", () => {
    expect(fallbackWorthy(named("AI_APICallError", { statusCode: 400 }))).toBe(
      false,
    )
    expect(fallbackWorthy(named("AbortError"))).toBe(false)
    expect(fallbackWorthy(null)).toBe(false)
    expect(fallbackWorthy("boom")).toBe(false)
    expect(fallbackWorthy(new Error("other"))).toBe(false)
  })
  it("looks inside a retry error", () => {
    expect(
      fallbackWorthy(
        named("AI_RetryError", { lastError: named("TimeoutError") }),
      ),
    ).toBe(true)
    expect(
      fallbackWorthy(
        named("AI_RetryError", { lastError: named("AbortError") }),
      ),
    ).toBe(false)
  })
  it("lets an app's refusal say for itself", () => {
    expect(
      fallbackWorthy(new BackendRefusedError("no", { fallbackWorthy: true })),
    ).toBe(true)
    expect(fallbackWorthy(new BackendRefusedError("no"))).toBe(false)
  })
})
