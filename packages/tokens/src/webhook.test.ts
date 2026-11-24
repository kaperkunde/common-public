import { describe, expect, it, vi } from "vitest"

import {
  signWebhook,
  isKnownWebhookEvent,
  verifyWebhook,
  webhookRoute,
  WebhookVerificationError,
} from "./server/webhook"
import type { PurchaseCompletedEvent } from "./types"

const secret = "whsec_test"
const event: PurchaseCompletedEvent = {
  id: "evt_1",
  type: "purchase.completed",
  createdAt: "2026-11-17T10:00:00.000Z",
  appId: "app_1",
  livemode: false,
  data: {
    userId: "u1",
    purchase: {
      id: "pur_1",
      kind: "checkout",
      status: "paid",
      currency: "eur",
      amountCents: 1000,
      taxCents: 0,
      totalCents: 1000,
      creditMicros: 10_000_000,
      failure: null,
      createdAt: "2026-11-17T09:59:00.000Z",
      paidAt: "2026-11-17T10:00:00.000Z",
    },
    balance: {
      availableMicros: 10_000_000,
      purchasedMicros: 10_000_000,
      grantsMicros: 0,
    },
  },
}
const body = JSON.stringify(event)
const T = 1_800_000_000

const reason = (fn: () => unknown) => {
  try {
    fn()
  } catch (e) {
    return e instanceof WebhookVerificationError ? e.reason : "other"
  }
  return "none"
}

describe("verifyWebhook", () => {
  it("accepts a good signature and types the event", () => {
    const parsed = verifyWebhook(body, signWebhook(body, secret, T), secret, {
      now: T + 5,
    })
    expect(parsed.type).toBe("purchase.completed")
    expect(isKnownWebhookEvent(parsed)).toBe(true)
    if (isKnownWebhookEvent(parsed) && parsed.type === "purchase.completed")
      expect(parsed.data.purchase.creditMicros).toBe(10_000_000)
  })

  it("matches a vector computed outside this code (openssl dgst -sha256 -hmac)", () => {
    const raw = '{"id":"evt_x","type":"balance.empty","data":{}}'
    const header =
      "t=1800000000,v1=4de4b02db866f38b9d93f1a57747b0f8bf9274a95789639e71b4010f9b5c9570"
    expect(signWebhook(raw, secret, 1_800_000_000)).toBe(header)
    expect(verifyWebhook(raw, header, secret, { now: T }).id).toBe("evt_x")
  })

  it("rejects a tampered body, a wrong secret and a missing or malformed header", () => {
    const header = signWebhook(body, secret, T)
    expect(
      reason(() =>
        verifyWebhook(body.replace("1000", "9999"), header, secret, { now: T }),
      ),
    ).toBe("signature")
    expect(reason(() => verifyWebhook(body, header, "other", { now: T }))).toBe(
      "signature",
    )
    expect(reason(() => verifyWebhook(body, null, secret, { now: T }))).toBe(
      "malformed",
    )
    expect(
      reason(() => verifyWebhook(body, "garbage", secret, { now: T })),
    ).toBe("malformed")
    expect(
      reason(() => verifyWebhook(body, `t=${T},v1=zz`, secret, { now: T })),
    ).toBe("signature")
  })

  it("rejects a stale or future timestamp but not one inside the tolerance", () => {
    const header = signWebhook(body, secret, T)
    expect(
      reason(() => verifyWebhook(body, header, secret, { now: T + 301 })),
    ).toBe("stale")
    expect(
      reason(() => verifyWebhook(body, header, secret, { now: T - 301 })),
    ).toBe("stale")
    expect(
      reason(() => verifyWebhook(body, header, secret, { now: T + 300 })),
    ).toBe("none")
    expect(
      reason(() =>
        verifyWebhook(body, header, secret, {
          now: T + 61,
          toleranceSeconds: 60,
        }),
      ),
    ).toBe("stale")
  })

  it("takes several secrets while one rotates, and several v1 values", () => {
    const header = signWebhook(body, "new", T)
    expect(
      reason(() => verifyWebhook(body, header, ["old", "new"], { now: T })),
    ).toBe("none")
    const both = `t=${T},v1=${"a".repeat(64)},v1=${header.split("v1=")[1]}`
    expect(reason(() => verifyWebhook(body, both, "new", { now: T }))).toBe(
      "none",
    )
  })

  it("returns an event of a type it does not know instead of throwing", () => {
    const future = JSON.stringify({
      id: "evt_2",
      type: "something.else",
      data: { a: 1 },
    })
    const parsed = verifyWebhook(
      future,
      signWebhook(future, secret, T),
      secret,
      {
        now: T,
      },
    )
    expect(isKnownWebhookEvent(parsed)).toBe(false)
    expect(parsed).toMatchObject({ id: "evt_2", type: "something.else" })
  })

  it("types the refund events", () => {
    const refund = {
      id: "ref_1",
      purchaseId: "pur_1",
      status: "succeeded",
      creditMicros: 4_000_000,
      amountCents: 400,
      currency: "eur",
      initiatedBy: "app",
      failure: null,
      createdAt: "2026-11-24T10:00:00.000Z",
      settledAt: "2026-11-24T10:00:01.000Z",
    }
    for (const type of ["purchase.refunded", "purchase.refund_failed"]) {
      const raw = JSON.stringify({
        id: `evt_${type}`,
        type,
        createdAt: "2026-11-24T10:00:01.000Z",
        appId: "app_x",
        livemode: false,
        data: { userId: "u1", purchase: {}, refund, balance: {} },
      })
      const parsed = verifyWebhook(raw, signWebhook(raw, secret, T), secret, {
        now: T,
      })
      expect(isKnownWebhookEvent(parsed)).toBe(true)
      if (
        isKnownWebhookEvent(parsed) &&
        (parsed.type === "purchase.refunded" ||
          parsed.type === "purchase.refund_failed")
      )
        expect(parsed.data.refund.amountCents).toBe(400)
    }
  })

  it("rejects a signed body that is no event at all", () => {
    const junk = JSON.stringify({ id: "evt_2", data: {} })
    expect(
      reason(() =>
        verifyWebhook(junk, signWebhook(junk, secret, T), secret, { now: T }),
      ),
    ).toBe("body")
    expect(
      reason(() =>
        verifyWebhook("nope", signWebhook("nope", secret, T), secret, {
          now: T,
        }),
      ),
    ).toBe("body")
  })
})

describe("webhookRoute", () => {
  const post = (payload: string, signature: string | null) =>
    new Request("http://app.test/api/tokens/webhook", {
      method: "POST",
      headers: signature ? { "token-signature": signature } : {},
      body: payload,
    })

  it("calls the handler for the type, 200s a type with none, 400s a bad signature, 500s a failing handler", async () => {
    const handled = vi.fn()
    const route = webhookRoute({
      secret: () => secret,
      handlers: { "purchase.completed": handled },
    })
    const now = Math.floor(Date.now() / 1000)
    expect(
      (await route(post(body, signWebhook(body, secret, now)))).status,
    ).toBe(200)
    expect(handled).toHaveBeenCalledOnce()

    const low = JSON.stringify({ ...event, type: "balance.low", data: {} })
    expect((await route(post(low, signWebhook(low, secret, now)))).status).toBe(
      200,
    )
    expect(handled).toHaveBeenCalledOnce()

    expect(
      (await route(post(body, signWebhook(body, "wrong", now)))).status,
    ).toBe(400)
    expect((await route(post(body, null))).status).toBe(400)
    expect(
      (await route(new Request("http://app.test/", { method: "GET" }))).status,
    ).toBe(405)

    // A type from a newer center: acknowledged, offered to onUnknown, never a handler's.
    const seen = vi.fn()
    const lenient = webhookRoute({
      secret,
      handlers: { "purchase.completed": handled },
      onUnknown: seen,
    })
    const future = JSON.stringify({ ...event, type: "wallet.frozen", data: {} })
    expect(
      (await lenient(post(future, signWebhook(future, secret, now)))).status,
    ).toBe(200)
    expect(seen).toHaveBeenCalledOnce()
    expect(handled).toHaveBeenCalledOnce()
    expect(
      (await route(post(future, signWebhook(future, secret, now)))).status,
    ).toBe(200)

    const failing = webhookRoute({
      secret,
      handlers: {
        "purchase.completed": () => {
          throw new Error("boom")
        },
      },
      onError: () => {},
    })
    expect(
      (await failing(post(body, signWebhook(body, secret, now)))).status,
    ).toBe(500)
  })
})
