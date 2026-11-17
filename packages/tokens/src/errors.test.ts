import { describe, expect, it } from "vitest"

import {
  TokenCenterError,
  centerUnavailable,
  errorFromResponse,
  isTokenError,
} from "./errors"
import { ERROR_CODES, ERROR_STATUS } from "./types"

describe("error mapping", () => {
  it("reads the app API body", () => {
    const e = errorFromResponse(402, {
      error: {
        code: "insufficient_balance",
        message: "Out.",
        action: "buy_tokens",
      },
    })
    expect(e).toBeInstanceOf(TokenCenterError)
    expect(e.code).toBe("insufficient_balance")
    expect(e.status).toBe(402)
    expect(e.action).toBe("buy_tokens")
    expect(isTokenError(e, "insufficient_balance")).toBe(true)
    expect(isTokenError(e, "forbidden")).toBe(false)
  })

  it("reads the gateway body's token_center, and a provider error passed through", () => {
    const e = errorFromResponse(502, {
      type: "error",
      error: { type: "overloaded_error", message: "Overloaded" },
      token_center: {
        code: "provider_error",
        message: "The provider failed.",
        status: 529,
      },
    })
    expect(e.code).toBe("provider_error")
    expect(e.detail.status).toBe(529)
  })

  it("falls back to x-token-error, then Retry-After", () => {
    const e = errorFromResponse(429, null, {
      code: "rate_limited",
      retryAfter: "7",
    })
    expect(e.code).toBe("rate_limited")
    expect(e.detail.retryAfterSeconds).toBe(7)
  })

  it("is center_unavailable for a 5xx with no contract body, mapped by status otherwise", () => {
    expect(errorFromResponse(502, "<html>bad gateway</html>").code).toBe(
      "center_unavailable",
    )
    expect(errorFromResponse(503, null).code).toBe("center_unavailable")
    expect(errorFromResponse(401, null).code).toBe("unauthenticated")
    expect(errorFromResponse(404, {}).code).toBe("not_found")
    expect(errorFromResponse(418, {}).code).toBe("internal_error")
  })

  it("ignores a code the contract does not know", () => {
    expect(
      errorFromResponse(400, { error: { code: "nope", message: "x" } }).code,
    ).toBe("invalid_request")
  })

  it("carries a status for every code", () => {
    for (const code of ERROR_CODES)
      expect(new TokenCenterError({ code, message: "m" }).status).toBe(
        ERROR_STATUS[code],
      )
    expect(centerUnavailable().status).toBe(503)
  })
})
