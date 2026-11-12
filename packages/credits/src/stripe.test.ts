import type Stripe from "stripe"
import { describe, expect, it, vi } from "vitest"

import type { CreditStore } from "./store"
import {
  cardLabel,
  createPurchases,
  ourNumbers,
  refillFailureOf,
  stripeFailure,
} from "./stripe"

const fakeStore = (overrides: Partial<CreditStore> = {}) =>
  ({
    credit: vi.fn(async () => true),
    refillFailed: vi.fn(async () => ({
      userId: "ash",
      amountCents: 500,
      currency: "eur",
    })),
    refillClaim: vi.fn(async () => undefined),
    autorefill: vi.fn(async () => undefined),
    saveCard: vi.fn(async () => undefined),
    ...overrides,
  }) as unknown as CreditStore

const purchases = (
  store: CreditStore,
  stripe?: Partial<Stripe>,
  told?: string[],
  logged?: unknown[],
) =>
  createPurchases({
    store,
    stripe: () => stripe as Stripe | undefined,
    app: "testapp",
    product: { id: "testapp_credits", name: "Credits" },
    currencies: { eur: "inclusive", usd: "exclusive" },
    urls: {
      purchaseDone: "https://x/done",
      purchaseCancelled: "https://x/cancel",
      cardSaved: "https://x/card",
      cardCancelled: "https://x/nocard",
    },
    onRefillFailed: (userId, message, failure) => {
      told?.push(`${userId}: ${message} [${failure}]`)
    },
    log: (message, error) => {
      logged?.push(message, error)
    },
  })

const event = (type: string, object: unknown) =>
  ({ id: "evt_1", type, data: { object } }) as unknown as Stripe.Event

const ours = {
  app: "testapp",
  kind: "purchase",
  userId: "ash",
  purchaseId: "7",
  credits: "2000000",
}

describe("the currencies sold in", () => {
  it("refuses a currency not counted in cents when it is configured", () => {
    const config = (currency: string) => () =>
      createPurchases({
        store: fakeStore(),
        stripe: () => undefined,
        app: "testapp",
        product: { id: "testapp_credits", name: "Credits" },
        currencies: { eur: "inclusive", [currency]: "exclusive" },
        urls: {
          purchaseDone: "https://x/done",
          purchaseCancelled: "https://x/cancel",
          cardSaved: "https://x/card",
          cardCancelled: "https://x/nocard",
        },
      })
    expect(config("jpy")).toThrow(/counted in cents/)
    expect(config("kwd")).toThrow(/counted in cents/)
    expect(config("usd")).not.toThrow()
  })
})

describe("the webhook's handler", () => {
  it("credits a paid checkout of this app's, with the event's id", async () => {
    const store = fakeStore()
    const answer = await purchases(store, {}).handleEvent(
      event("checkout.session.completed", {
        id: "cs_1",
        mode: "payment",
        payment_status: "paid",
        metadata: ours,
        amount_total: 500,
        total_details: { amount_tax: 83 },
      }),
    )
    expect(answer).toBe("credited")
    expect(store.credit).toHaveBeenCalledWith({
      eventId: "evt_1",
      eventType: "checkout.session.completed",
      purchaseId: 7,
      credits: 2000000,
      userId: "ash",
      stripeId: "cs_1",
      taxCents: 83,
      totalCents: 500,
    })
  })

  it("says so when the database had credited it already", async () => {
    const store = fakeStore({ credit: vi.fn(async () => false) })
    expect(
      await purchases(store, {}).handleEvent(
        event("checkout.session.completed", {
          mode: "payment",
          payment_status: "paid",
          metadata: ours,
        }),
      ),
    ).toBe("already credited")
  })

  it("ignores another product's events, unpaid ones, and those it does not act on", async () => {
    const store = fakeStore()
    const handle = purchases(store, {}).handleEvent
    expect(
      await handle(
        event("checkout.session.completed", {
          mode: "payment",
          payment_status: "paid",
          metadata: { ...ours, app: "other" },
        }),
      ),
    ).toBe("ignored: not this app's")
    expect(
      await handle(
        event("checkout.session.completed", {
          mode: "payment",
          payment_status: "unpaid",
          metadata: ours,
        }),
      ),
    ).toBe("ignored: not paid")
    expect(await handle(event("customer.created", {}))).toBe(
      "ignored: not an event this app acts on",
    )
    expect(store.credit).not.toHaveBeenCalled()
  })

  it("turns auto-refill off on a declined refill, and tells the user once, in its own words", async () => {
    const told: string[] = []
    const logged: unknown[] = []
    const store = fakeStore()
    const raw =
      "Your card has insufficient funds. (req_8f2a; processor: acquirer_x)"
    const answer = await purchases(store, {}, told, logged).handleEvent(
      event("payment_intent.payment_failed", {
        id: "pi_1",
        metadata: { ...ours, kind: "refill" },
        last_payment_error: {
          message: raw,
          code: "card_declined",
          decline_code: "insufficient_funds",
        },
      }),
    )
    expect(answer).toBe("refill failed")
    // The purchase and the user get the package's words and a kind; Stripe's only the log.
    expect(store.refillFailed).toHaveBeenCalledWith(
      7,
      "pi_1",
      "the card has insufficient funds",
    )
    expect(told).toHaveLength(1)
    expect(told[0]).toContain("auto-refill is now off")
    expect(told[0]).toContain("[insufficient_funds]")
    expect(told[0]).not.toContain("req_8f2a")
    expect(logged).toContain(raw)
  })

  it("credits a checkout paid later, when its asynchronous payment succeeds", async () => {
    const store = fakeStore()
    const answer = await purchases(store, {}).handleEvent(
      event("checkout.session.async_payment_succeeded", {
        id: "cs_2",
        mode: "payment",
        payment_status: "paid",
        metadata: ours,
        amount_total: 500,
      }),
    )
    expect(answer).toBe("credited")
    expect(store.credit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "checkout.session.async_payment_succeeded",
        purchaseId: 7,
        stripeId: "cs_2",
      }),
    )
    // Completed but not yet paid (the debit is still on its way): nothing yet.
    expect(
      await purchases(fakeStore(), {}).handleEvent(
        event("checkout.session.completed", {
          id: "cs_3",
          mode: "payment",
          payment_status: "unpaid",
          metadata: ours,
        }),
      ),
    ).toBe("ignored: not paid")
  })

  it("does not charge a refill nobody claimed, nor without Stripe", async () => {
    expect(await purchases(fakeStore(), undefined).maybeRefill("ash")).toBe(
      "off: Stripe is not configured",
    )
    expect(await purchases(fakeStore(), {}).maybeRefill("ash")).toBe("not due")
  })
})

describe("the helpers", () => {
  it("reads back only numbers this app wrote", () => {
    expect(ourNumbers(ours)).toEqual({
      purchaseId: 7,
      credits: 2000000,
      userId: "ash",
    })
    expect(ourNumbers({ ...ours, credits: "lots" })).toBeUndefined()
    expect(ourNumbers(null)).toBeUndefined()
  })

  it("names a card, and a failure in Stripe's words", () => {
    expect(
      cardLabel({
        type: "card",
        card: { brand: "visa", last4: "4242" },
      } as Stripe.PaymentMethod),
    ).toBe("Visa ending 4242")
    expect(cardLabel({ type: "sepa_debit" } as Stripe.PaymentMethod)).toBe(
      "sepa debit",
    )
    expect(stripeFailure({ message: "Declined" })).toBe("Declined")
    expect(stripeFailure({})).toBe("The charge did not go through.")
  })

  it("sorts a failure into a kind of its own", () => {
    expect(refillFailureOf({ decline_code: "insufficient_funds" })).toBe(
      "insufficient_funds",
    )
    expect(refillFailureOf({ code: "expired_card" })).toBe("expired_card")
    expect(refillFailureOf({ code: "authentication_required" })).toBe(
      "authentication_required",
    )
    expect(refillFailureOf({ code: "card_declined" })).toBe("declined")
    expect(refillFailureOf({ decline_code: "do_not_honor" })).toBe("error")
    expect(refillFailureOf(undefined)).toBe("error")
  })
})
