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

  it("keeps the path of a refusal and the call a failure belongs to", () => {
    const refused = errorFromResponse(
      400,
      {
        type: "error",
        error: { type: "invalid_request_error", message: "No." },
        token_center: {
          code: "invalid_request",
          message: "Server tools are not priced.",
          path: "tools[0].type",
        },
      },
      { code: "invalid_request", callId: "call_9" },
    )
    expect(refused).toMatchObject({
      code: "invalid_request",
      status: 400,
      path: "tools[0].type",
      callId: "call_9",
    })
    expect(
      errorFromResponse(
        502,
        { error: { code: "provider_error", message: "The provider failed." } },
        { callId: "call_3" },
      ),
    ).toMatchObject({ code: "provider_error", status: 502, callId: "call_3" })
    expect(
      errorFromResponse(403, {
        error: {
          code: "forbidden",
          message: "A test key reaches no live provider.",
        },
      }),
    ).toMatchObject({ code: "forbidden", status: 403 })
    expect(errorFromResponse(502, null, { callId: "call_4" }).code).toBe(
      "center_unavailable",
    )
    expect(errorFromResponse(409, {}, { callId: "call_5" }).callId).toBe(
      "call_5",
    )
    expect(
      errorFromResponse(
        400,
        { error: { code: "invalid_request", message: "m", callId: "body_id" } },
        { callId: "hdr" },
      ).callId,
    ).toBe("body_id")
  })

  it("carries a status for every code", () => {
    for (const code of ERROR_CODES)
      expect(new TokenCenterError({ code, message: "m" }).status).toBe(
        ERROR_STATUS[code],
      )
    expect(centerUnavailable().status).toBe(503)
  })
})

describe("provider refusals", () => {
  it("knows the codes and their statuses", () => {
    expect(ERROR_CODES).toContain("provider_out_of_credit")
    expect(ERROR_STATUS.provider_out_of_credit).toBe(503)
    expect(ERROR_STATUS.provider_rate_limited).toBe(429)
    expect(ERROR_STATUS.provider_overloaded).toBe(503)
  })

  it("keeps provider and model, and is not retryable", () => {
    const e = errorFromResponse(503, {
      error: {
        code: "provider_out_of_credit",
        message: "Out of credit.",
        provider: "openai",
        model: "tts-1",
      },
    })
    expect(e.code).toBe("provider_out_of_credit")
    expect(e.detail.provider).toBe("openai")
    expect(e.detail.model).toBe("tts-1")
    expect(e.retryable).toBe(false)
  })

  it("is not mistaken for center_unavailable on a bodiless 503, and reads Retry-After", () => {
    const out = errorFromResponse(503, null, {
      code: "provider_out_of_credit",
    })
    expect(out.code).toBe("provider_out_of_credit")
    const rl = errorFromResponse(
      429,
      { error: { code: "provider_rate_limited", message: "Slow." } },
      { retryAfter: "7" },
    )
    expect(rl.detail.retryAfterSeconds).toBe(7)
    expect(rl.retryable).toBe(true)
  })

  describe("refund and unknown codes", () => {
    it("knows the refund codes and their statuses", () => {
      expect(ERROR_STATUS.refund_not_available).toBe(409)
      expect(ERROR_STATUS.refund_amount_invalid).toBe(400)
      expect(ERROR_STATUS.refund_refused_by_processor).toBe(409)
      const e = errorFromResponse(409, {
        error: {
          code: "refund_refused_by_processor",
          message: "Stripe will not.",
        },
      })
      expect(e.code).toBe("refund_refused_by_processor")
      expect(e.refundableCreditMicros).toBeUndefined()
      expect(e.retryable).toBe(false)
    })

    it("never throws on a code it does not know: the status class, the center's words kept", () => {
      const e = errorFromResponse(409, {
        error: {
          code: "wallet_frozen",
          message: "Your wallet is frozen.",
          action: "wait",
          retryAfterSeconds: 5,
        },
      })
      expect(e).toBeInstanceOf(TokenCenterError)
      expect(e.code).toBe("conflict")
      expect(e.status).toBe(409)
      expect(e.message).toBe("Your wallet is frozen.")
      expect(e.action).toBe("wait")
      expect(e.centerCode).toBe("wallet_frozen")
      expect(e.detail.retryAfterSeconds).toBe(5)
      expect(
        errorFromResponse(400, { error: { code: "new_thing" } }).code,
      ).toBe("invalid_request")
      expect(
        errorFromResponse(
          503,
          { error: { code: "new_thing", message: "x" } },
          { code: "new_thing" },
        ).code,
      ).toBe("center_unavailable")
      expect(errorFromResponse(402, null, { code: "new_thing" }).code).toBe(
        "insufficient_balance",
      )
    })

    it("keeps the raw code, action, retry hint, refundable credit and message of an unknown code", () => {
      const e = errorFromResponse(
        409,
        {
          error: {
            code: "refund_window_closed",
            message: "Too late.",
            action: "wait",
            refundableCreditMicros: 3_000_000,
          },
        },
        { retryAfter: "9", callId: "call_1" },
      )
      expect(e.code).toBe("conflict")
      expect(e.centerCode).toBe("refund_window_closed")
      expect(e.action).toBe("wait")
      expect(e.detail.retryAfterSeconds).toBe(9)
      expect(e.refundableCreditMicros).toBe(3_000_000)
      expect(e.message).toBe("Too late.")
      expect(e.callId).toBe("call_1")
      // A known code reads back as itself.
      expect(
        errorFromResponse(402, { error: { code: "insufficient_balance" } })
          .centerCode,
      ).toBe("insufficient_balance")
      // A header-only unknown code, and a 5xx, keep theirs too.
      const h = errorFromResponse(402, null, { code: "new_thing" })
      expect(h.centerCode).toBe("new_thing")
      const down = errorFromResponse(503, {
        error: {
          code: "maintenance",
          message: "Back soon.",
          retryAfterSeconds: 60,
        },
      })
      expect(down.code).toBe("center_unavailable")
      expect(down.centerCode).toBe("maintenance")
      expect(down.message).toBe("Back soon.")
      expect(down.detail.retryAfterSeconds).toBe(60)
    })
  })
})
