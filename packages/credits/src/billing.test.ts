import { describe, expect, it } from "vitest"
import {
  type AutorefillSettings,
  type SalePrice,
  MAX_PURCHASE_CENTS,
  MIN_PURCHASE_CENTS,
  amountProblem,
  autorefillProblem,
  isCurrency,
  UNSUPPORTED_CURRENCIES,
  moneyText,
  monthStart,
  parseAmount,
  salePriceInForce,
  purchaseStatusText,
  refillDecision,
  refillFailedMessage,
  taxText,
  creditsFor,
} from "./billing"

const prices: SalePrice[] = [
  {
    currency: "eur",
    centsPerMillion: 300,
    effectiveFrom: "2026-01-01T00:00:00Z",
  },
  {
    currency: "eur",
    centsPerMillion: 250,
    effectiveFrom: "2026-06-01T00:00:00Z",
  },
  {
    currency: "usd",
    centsPerMillion: 275,
    effectiveFrom: "2026-03-01T00:00:00Z",
  },
  {
    currency: "eur",
    centsPerMillion: 200,
    effectiveFrom: "2027-01-01T00:00:00Z",
  },
]

describe("the price in force", () => {
  it("is the newest of that currency that had begun", () => {
    const at = new Date("2026-10-22T12:00:00Z")
    expect(salePriceInForce(prices, "eur", at)?.centsPerMillion).toBe(250)
    expect(salePriceInForce(prices, "usd", at)?.centsPerMillion).toBe(275)
  })

  it("is the earlier one before a change, and nothing before the first", () => {
    expect(
      salePriceInForce(prices, "eur", new Date("2026-05-31T23:59:59Z"))
        ?.centsPerMillion,
    ).toBe(300)
    expect(
      salePriceInForce(prices, "usd", new Date("2026-02-01T00:00:00Z")),
    ).toBeUndefined()
  })

  it("never reads a price set for later", () => {
    expect(
      salePriceInForce(prices, "eur", new Date("2026-12-31T23:59:59Z"))
        ?.centsPerMillion,
    ).toBe(250)
  })
})

describe("what an amount buys", () => {
  it("is the amount over the price of a million", () => {
    // €5 at €2.50 a million
    expect(creditsFor(500, 250)).toBe(2000000)
    expect(creditsFor(1250, 250)).toBe(5000000)
  })

  it("rounds down, since a fraction of a credit cannot be spent", () => {
    // €5 at €3.00 a million is 1,666,666.67
    expect(creditsFor(500, 300)).toBe(1666666)
    expect(creditsFor(500, 7)).toBe(Math.floor(500000000 / 7))
  })

  it("is nothing at no price at all", () => {
    expect(creditsFor(500, 0)).toBe(0)
  })
})

describe("an amount", () => {
  it("reads as people type money", () => {
    expect(parseAmount("5")).toBe(500)
    expect(parseAmount("5.5")).toBe(550)
    expect(parseAmount("12,50")).toBe(1250)
    expect(parseAmount(" €20 ")).toBe(2000)
    expect(parseAmount("$7.25")).toBe(725)
    expect(parseAmount(5)).toBe(500)
  })

  it("is nothing for what is not money", () => {
    expect(parseAmount("five")).toBeUndefined()
    expect(parseAmount("5.555")).toBeUndefined()
    expect(parseAmount("-5")).toBeUndefined()
    expect(parseAmount("")).toBeUndefined()
    expect(parseAmount(undefined)).toBeUndefined()
  })

  it("is five or more, in either currency", () => {
    expect(MIN_PURCHASE_CENTS).toBe(500)
    expect(amountProblem(500, "eur")).toBeUndefined()
    expect(amountProblem(500, "usd")).toBeUndefined()
    expect(amountProblem(499, "eur")).toBe("The smallest amount is €5.00.")
    expect(amountProblem(499, "usd")).toBe("The smallest amount is US$5.00.")
    expect(amountProblem(900, "eur", { minCents: 1000 })).toBe(
      "The smallest amount is €10.00.",
    )
  })

  it("is refused past the most at once, and when it is not a number", () => {
    expect(amountProblem(MAX_PURCHASE_CENTS, "eur")).toBeUndefined()
    expect(amountProblem(MAX_PURCHASE_CENTS + 1, "eur")).toMatch(
      /largest amount/,
    )
    expect(amountProblem(undefined, "eur")).toMatch(/is a number/)
  })

  it("is written as money", () => {
    expect(moneyText(1250, "eur")).toBe("€12.50")
  })
})

describe("tax", () => {
  it("is said as inside the price or on top of it", () => {
    expect(taxText("inclusive")).toBe("Tax included")
    expect(taxText("exclusive")).toMatch(/added at checkout/)
  })

  it("knows a currency by Stripe's three lower-case letters", () => {
    expect(isCurrency("eur")).toBe(true)
    expect(isCurrency("gbp")).toBe(true)
    expect(isCurrency("EUR")).toBe(false)
    expect(isCurrency("euro")).toBe(false)
  })

  it("sells only in currencies counted in cents", () => {
    // Zero-decimal: 500 "cents" of yen would be charged as 500 yen, a hundred times off.
    ;["jpy", "krw", "clp", "vnd", "xof", "isk"].forEach((currency) =>
      expect(isCurrency(currency), currency).toBe(false),
    )
    // Three-decimal: thousandths, ten times off.
    ;["kwd", "bhd", "jod", "omr", "tnd"].forEach((currency) =>
      expect(isCurrency(currency), currency).toBe(false),
    )
    expect(isCurrency("chf")).toBe(true)
    expect(UNSUPPORTED_CURRENCIES).toContain("jpy")
  })
})

describe("the auto-refill decision", () => {
  const on: AutorefillSettings = {
    enabled: true,
    hasCard: true,
    pending: false,
    thresholdCredits: 100000,
    amountCents: 500,
    monthlyMaxCents: 1500,
  }
  const low = { free: 0, purchased: 99999 }

  it("charges once the free allotment is gone and what was bought falls below the threshold", () => {
    expect(refillDecision(on, low, 0)).toEqual({ charge: true })
  })

  it("waits while anything free is left, since that is spent first", () => {
    expect(refillDecision(on, { free: 1, purchased: 0 }, 0)).toEqual({
      charge: false,
      reason: "free left",
    })
  })

  it("waits at or above the threshold", () => {
    expect(refillDecision(on, { free: 0, purchased: 100000 }, 0)).toEqual({
      charge: false,
      reason: "above threshold",
    })
  })

  it("treats an overdrawn free allotment as gone", () => {
    expect(refillDecision(on, { free: -40, purchased: 0 }, 0)).toEqual({
      charge: true,
    })
  })

  it("treats free credits past their month as gone", () => {
    const now = new Date("2026-12-02T00:00:00.000Z")
    expect(
      refillDecision(
        on,
        { free: 900, purchased: 0, freeExpiresAt: "2026-12-01T00:00:00.000Z" },
        0,
        now,
      ),
    ).toEqual({ charge: true })
    expect(
      refillDecision(
        on,
        { free: 900, purchased: 0, freeExpiresAt: "2027-01-01T00:00:00.000Z" },
        0,
        now,
      ),
    ).toEqual({ charge: false, reason: "free left" })
  })

  it("charges once for a burst: a refill in flight holds the next", () => {
    expect(refillDecision({ ...on, pending: true }, low, 0)).toEqual({
      charge: false,
      reason: "pending",
    })
  })

  it("never passes the monthly maximum", () => {
    expect(refillDecision(on, low, 1000)).toEqual({ charge: true })
    expect(refillDecision(on, low, 1001)).toEqual({
      charge: false,
      reason: "monthly maximum",
    })
    expect(refillDecision(on, low, 1500)).toEqual({
      charge: false,
      reason: "monthly maximum",
    })
  })

  it("does nothing when off or with no card", () => {
    expect(refillDecision({ ...on, enabled: false }, low, 0)).toEqual({
      charge: false,
      reason: "off",
    })
    expect(refillDecision({ ...on, hasCard: false }, low, 0)).toEqual({
      charge: false,
      reason: "no card",
    })
  })

  it("counts the month from its first day, in UTC", () => {
    expect(monthStart(new Date("2026-10-22T23:30:00-05:00"))).toBe(
      "2026-10-01T00:00:00.000Z",
    )
    expect(monthStart(new Date("2026-11-01T00:30:00+02:00"))).toBe(
      "2026-10-01T00:00:00.000Z",
    )
  })
})

describe("auto-refill settings", () => {
  const fine = {
    currency: "eur" as const,
    thresholdCredits: 100000,
    amountCents: 500,
    monthlyMaxCents: 2000,
  }

  it("are fine as a sensible set", () => {
    expect(autorefillProblem(fine)).toBeUndefined()
    expect(autorefillProblem({ ...fine, monthlyMaxCents: 500 })).toBeUndefined()
  })

  it("need a threshold that can be crossed", () => {
    expect(autorefillProblem({ ...fine, thresholdCredits: 0 })).toMatch(
      /one or more/,
    )
    expect(autorefillProblem({ ...fine, thresholdCredits: undefined })).toMatch(
      /one or more/,
    )
  })

  it("need each refill to be five or more, and the maximum to cover one", () => {
    expect(autorefillProblem({ ...fine, amountCents: 499 })).toMatch(
      /smallest amount/,
    )
    expect(autorefillProblem({ ...fine, monthlyMaxCents: 499 })).toMatch(
      /cover at least one refill/,
    )
    expect(autorefillProblem({ ...fine, monthlyMaxCents: undefined })).toMatch(
      /monthly maximum/,
    )
  })
})

describe("what a user is told", () => {
  it("names each state of a purchase", () => {
    expect(purchaseStatusText({ status: "paid" })).toBe("paid")
    expect(purchaseStatusText({ status: "pending" })).toBe("waiting for Stripe")
    expect(
      purchaseStatusText({
        status: "failed",
        failure: "Your card was declined.",
      }),
    ).toBe("failed: Your card was declined.")
    expect(purchaseStatusText({ status: "abandoned" })).toBe("not charged")
  })

  it("reads a checkout nobody finished as not completed once it could no longer be paid", () => {
    const now = new Date("2026-10-22T12:00:00Z")
    const opened = (createdAt: string, kind = "purchase") =>
      purchaseStatusText(
        {
          status: "pending",
          kind,
          createdAt,
        },
        now,
      )
    expect(opened("2026-10-22T00:00:00Z")).toBe("waiting for Stripe")
    expect(opened("2026-10-21T11:00:00Z")).toBe("not completed")
    // a refill is charged at once, and waits on the webhook however long that takes
    expect(opened("2026-10-21T11:00:00Z", "refill")).toBe("waiting for Stripe")
  })

  it("says a failed refill turned auto-refill off, and what to do", () => {
    const message = refillFailedMessage(500, "eur", "Your card was declined.")
    expect(message).toContain("€5.00")
    expect(message).toContain("(Your card was declined)")
    expect(message).toContain("auto-refill is now off")
  })
})
