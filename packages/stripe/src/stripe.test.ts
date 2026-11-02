import type Stripe from "stripe"
import { describe, expect, it, vi } from "vitest"

import {
  belongsToApp,
  handleStripeWebhook,
  liveKeysOnDevelopment,
  readRawBody,
  stripeKeyMode,
  stripeWebhookRoute,
} from "./index"

const event = (metadata: Record<string, string> | null, id = "evt_1") =>
  ({
    id,
    type: "checkout.session.completed",
    data: { object: { metadata } },
  }) as unknown as Stripe.Event

function fakeStripe(retrieved: Stripe.Event, { badSignature = false } = {}) {
  return {
    webhooks: {
      constructEvent: vi.fn(() => {
        if (badSignature) throw new Error("bad")
        return {
          ...retrieved,
          data: { object: { metadata: { app: "forged" } } },
        }
      }),
    },
    events: { retrieve: vi.fn(async () => retrieved) },
  } as unknown as Pick<Stripe, "webhooks" | "events">
}

describe("keys", () => {
  it("tells live from test keys", () => {
    expect(stripeKeyMode("sk_live_x")).toBe("live")
    expect(stripeKeyMode("pk_test_x")).toBe("test")
    expect(stripeKeyMode("")).toBeNull()
  })

  it("refuses live keys on a development deployment only", () => {
    const keys = {
      STRIPE_SECRET_KEY: "sk_live_x",
      STRIPE_PUBLISHABLE_KEY: "pk_test_y",
    }
    expect(liveKeysOnDevelopment(false, keys)).toBeNull()
    expect(liveKeysOnDevelopment(true, keys)).toMatch(
      /^STRIPE_SECRET_KEY is a live Stripe key/,
    )
  })
})

describe("handleStripeWebhook", () => {
  const base = {
    webhookSecret: "whsec_x",
    rawBody: "{}",
    signature: "t=1,v1=x",
    app: "lorespawner",
  }

  it("believes only the event fetched back, and only when it is the app's", async () => {
    const handle = vi.fn(async () => "credited")
    const ours = await handleStripeWebhook({
      ...base,
      stripe: fakeStripe(event({ app: "lorespawner" })),
      handle,
    })
    expect(ours).toEqual({
      status: 200,
      body: { received: true, outcome: "credited" },
    })
    expect(handle).toHaveBeenCalledWith(
      expect.objectContaining({ id: "evt_1" }),
    )

    handle.mockClear()
    const theirs = await handleStripeWebhook({
      ...base,
      stripe: fakeStripe(event({ app: "plekje" })),
      handle,
    })
    expect(theirs.body).toEqual({ received: true, outcome: "not ours" })
    expect(handle).not.toHaveBeenCalled()
  })

  it("refuses an unsigned or badly signed delivery, and an unconfigured endpoint", async () => {
    const handle = vi.fn()
    expect(
      (
        await handleStripeWebhook({
          ...base,
          signature: null,
          stripe: fakeStripe(event(null)),
          handle,
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await handleStripeWebhook({
          ...base,
          stripe: fakeStripe(event(null), { badSignature: true }),
          handle,
        })
      ).status,
    ).toBe(400)
    expect(
      (await handleStripeWebhook({ ...base, stripe: null, handle })).status,
    ).toBe(503)
    expect(handle).not.toHaveBeenCalled()
  })

  it("answers 500 when the handler fails, so Stripe retries", async () => {
    const log = vi.fn()
    const answer = await handleStripeWebhook({
      ...base,
      stripe: fakeStripe(event({ app: "lorespawner" })),
      handle: async () => {
        throw new Error("db down")
      },
      log,
    })
    expect(answer.status).toBe(500)
    expect(log).toHaveBeenCalledOnce()
  })

  it("serves an App Router route and reads a raw Node body", async () => {
    const POST = stripeWebhookRoute({
      stripe: () => fakeStripe(event({ app: "lorespawner" })),
      webhookSecret: () => "whsec_x",
      app: "lorespawner",
      handle: async () => "ok",
    })
    const response = await POST(
      new Request("https://x/api/stripe/webhook", {
        method: "POST",
        body: "{}",
        headers: { "stripe-signature": "s" },
      }),
    )
    expect(response.status).toBe(200)
    async function* chunks() {
      yield Buffer.from("a")
      yield "b"
    }
    expect((await readRawBody(chunks())).toString()).toBe("ab")
    expect(belongsToApp(event({ app: "x" }), "x")).toBe(true)
  })
})
