import { describe, expect, it } from "vitest"

import { TokenCenterError } from "./errors"
import { tokenErrorOf } from "./server/error-of"
import {
  callIdFromHeaders,
  chargeFromHeaders,
  gatewayConfig,
  gatewayHeaders,
  parseTrailer,
} from "./server/gateway"

describe("gatewayHeaders", () => {
  it("encodes every value and cuts it to 200 characters", () => {
    const h = gatewayHeaders({
      user: "user/1 é",
      email: "a+b@example.com",
      attribution: {
        purpose: "storyteller",
        activity: "Telling Åsa & Bo",
        scope: "u1",
        job: "j1",
        subject: "c1",
        correlation: "usage_9",
      },
      trailer: true,
      backend: "own",
    })
    expect(h["x-token-user"]).toBe("user%2F1%20%C3%A9")
    expect(h["x-token-email"]).toBe("a%2Bb%40example.com")
    expect(h["x-token-activity"]).toBe("Telling%20%C3%85sa%20%26%20Bo")
    expect(h["x-token-purpose"]).toBe("storyteller")
    expect(h["x-token-correlation"]).toBe("usage_9")
    expect(h["x-token-backend"]).toBe("own")
    expect(h["x-token-trailer"]).toBe("event")
    expect(
      decodeURIComponent(
        gatewayHeaders({
          user: "u",
          attribution: { activity: "x".repeat(500) },
        })["x-token-activity"]!,
      ),
    ).toHaveLength(200)
  })

  it("leaves out what is not set and demands a user", () => {
    expect(
      Object.keys(gatewayHeaders({ user: "u", backend: "tokens" })),
    ).toEqual(["x-token-user"])
    expect(() => gatewayHeaders({ user: "" })).toThrow()
  })

  it("makes provider settings with the /v1 base once", () => {
    for (const baseUrl of [
      "https://c.test",
      "https://c.test/",
      "https://c.test/v1",
    ]) {
      const c = gatewayConfig({ baseUrl, apiKey: "tk_test_x", user: "u1" })
      expect(c.baseURL).toBe("https://c.test/v1")
      expect(c.apiKey).toBe("tk_test_x")
      expect(c.headers["x-token-user"]).toBe("u1")
    }
  })
})

describe("chargeFromHeaders", () => {
  it("reads Headers and plain records, case-insensitively", () => {
    const record = {
      "X-Token-Call-Id": "call_1",
      "x-token-source": "tokens",
      "x-token-model": "claude-sonnet-5-5",
      "x-token-cost-micros": "600",
      "x-token-fee-micros": "120",
      "x-token-charged-micros": "720",
      "x-token-balance-micros": "4999280",
    }
    const expected = {
      callId: "call_1",
      source: "tokens",
      model: "claude-sonnet-5-5",
      costMicros: 600,
      feeMicros: 120,
      chargedMicros: 720,
      balanceAfterMicros: 4_999_280,
    }
    expect(chargeFromHeaders(record)).toEqual(expected)
    expect(chargeFromHeaders(new Headers(record))).toEqual(expected)
  })

  it("is null off the gateway and on a stream, whose call id is still readable", () => {
    expect(chargeFromHeaders(new Headers())).toBeNull()
    const stream = new Headers({ "x-token-call-id": "call_2" })
    expect(chargeFromHeaders(stream)).toBeNull()
    expect(callIdFromHeaders(stream)).toBe("call_2")
  })
})

describe("parseTrailer", () => {
  it("finds the token_center event at the end of a stream", () => {
    const sse =
      'event: message_stop\ndata: {"type":"message_stop"}\n\nevent: token_center\ndata: {"callId":"c1","chargedMicros":720}\n\n'
    expect(parseTrailer(sse)).toEqual({ callId: "c1", chargedMicros: 720 })
    expect(parseTrailer("event: message_stop\ndata: {}\n\n")).toBeNull()
  })
})

describe("tokenErrorOf", () => {
  it("reads an AI SDK APICallError's body and headers", () => {
    const apiCallError = Object.assign(new Error("Out."), {
      name: "AI_APICallError",
      statusCode: 402,
      responseHeaders: { "x-token-error": "insufficient_balance" },
      responseBody: JSON.stringify({
        type: "error",
        error: { type: "permission_error", message: "Out of tokens." },
        token_center: {
          code: "insufficient_balance",
          message: "Out of tokens.",
          action: "buy_tokens",
          provider: "anthropic",
        },
      }),
    })
    const e = tokenErrorOf(apiCallError)
    expect(e?.code).toBe("insufficient_balance")
    expect(e?.action).toBe("buy_tokens")
    expect(e?.status).toBe(402)
  })

  it("reads just the header when the body is not JSON", () => {
    const e = tokenErrorOf({
      statusCode: 429,
      responseHeaders: { "x-token-error": "rate_limited", "retry-after": "3" },
      responseBody: "slow down",
    })
    expect(e?.code).toBe("rate_limited")
    expect(e?.detail.retryAfterSeconds).toBe(3)
  })

  it("maps failed fetches, found down the cause chain, to center_unavailable", () => {
    const refused = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("connect ECONNREFUSED"), {
        code: "ECONNREFUSED",
      }),
    })
    expect(tokenErrorOf(refused)?.code).toBe("center_unavailable")
    expect(
      tokenErrorOf(
        Object.assign(new Error("Cannot connect to API: x"), {
          cause: refused,
        }),
      )?.code,
    ).toBe("center_unavailable")
  })

  it("returns a TokenCenterError as it is and null for anything else", () => {
    const own = new TokenCenterError({ code: "forbidden", message: "No." })
    expect(tokenErrorOf(own)).toBe(own)
    expect(tokenErrorOf(new Error("whatever"))).toBeNull()
    expect(tokenErrorOf(undefined)).toBeNull()
    expect(tokenErrorOf({ statusCode: 400, responseBody: "{}" })).toBeNull()
  })
})
