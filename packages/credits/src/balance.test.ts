import { describe, expect, it } from "vitest"

import {
  admitted,
  balanceText,
  creditsLeft,
  debitSplit,
  freeCreditsText,
  freeNow,
  outOfCreditsMessage,
} from "./balance"
import {
  countText,
  creditsText,
  dayText,
  lastDayText,
  shortCount,
} from "./units"

const now = new Date("2026-10-22T12:00:00.000Z")
const past = "2026-10-01T00:00:00.000Z"
const future = "2026-11-01T00:00:00.000Z"

describe("what a balance admits", () => {
  it("admits anything left, free or bought", () => {
    expect(
      admitted({ free: 5, purchased: 0, freeExpiresAt: future }, now),
    ).toBe(true)
    expect(admitted({ free: 0, purchased: 40 }, now)).toBe(true)
    expect(admitted({ free: 0, purchased: 0 }, now)).toBe(false)
  })

  it("counts free and bought together", () => {
    expect(creditsLeft({ free: -20, purchased: 50 }, now)).toBe(30)
  })

  it("counts free credits past their month as none, an overdraft with them", () => {
    expect(freeNow({ free: 800, purchased: 0, freeExpiresAt: past }, now)).toBe(
      0,
    )
    expect(freeNow({ free: -80, purchased: 0, freeExpiresAt: past }, now)).toBe(
      0,
    )
    expect(
      admitted({ free: 800, purchased: 0, freeExpiresAt: past }, now),
    ).toBe(false)
    expect(
      creditsLeft({ free: -80, purchased: 50, freeExpiresAt: past }, now),
    ).toBe(50)
  })

  it("keeps free credits until the instant they expire", () => {
    expect(
      freeNow({ free: 800, purchased: 0, freeExpiresAt: future }, now),
    ).toBe(800)
    expect(
      freeNow(
        { free: 800, purchased: 0, freeExpiresAt: now.toISOString() },
        now,
      ),
    ).toBe(0)
  })
})

describe("the debit split", () => {
  it("takes from free first", () => {
    expect(debitSplit({ free: 500, purchased: 300 }, 200)).toMatchObject({
      fromFree: 200,
      fromPurchased: 0,
      short: 0,
      source: "free",
      after: { free: 300, purchased: 300 },
    })
  })

  it("takes the rest from bought tokens once free runs out", () => {
    expect(debitSplit({ free: 50, purchased: 300 }, 200)).toMatchObject({
      fromFree: 50,
      fromPurchased: 150,
      short: 0,
      source: "purchased",
      after: { free: 0, purchased: 150 },
    })
  })

  it("overdraws free only when both are exhausted, by exactly what was missing", () => {
    expect(debitSplit({ free: 50, purchased: 30 }, 200)).toMatchObject({
      fromFree: 50,
      fromPurchased: 30,
      short: 120,
      after: { free: -120, purchased: 0 },
    })
    expect(debitSplit({ free: 100, purchased: 0 }, 220)).toMatchObject({
      source: "free",
      after: { free: -120, purchased: 0 },
    })
  })

  it("never takes from an overdraft already there", () => {
    expect(debitSplit({ free: -50, purchased: 100 }, 30)).toMatchObject({
      fromFree: 0,
      fromPurchased: 30,
      after: { free: -50, purchased: 70 },
    })
  })

  it("costs nothing for a call that cost nothing", () => {
    expect(debitSplit({ free: 10, purchased: 0 }, 0)).toMatchObject({
      source: "free",
      after: { free: 10, purchased: 0 },
    })
  })
})

describe("what the player is told", () => {
  it("writes long counts the way a reader counts them", () => {
    expect(countText(1234567)).toBe("1,234,567")
    expect(creditsText(1)).toBe("1 credit")
    expect(creditsText(-2500, { one: "lore token", many: "lore tokens" })).toBe(
      "-2,500 lore tokens",
    )
    expect(shortCount(1234)).toBe("1.2k")
    expect(shortCount(12_345_678)).toBe("12M")
  })

  it("never promises a date for free credits when the AI stops", () => {
    expect(dayText("2026-11-21T12:00:00.000Z")).toBe("21 November 2026")
    const message = outOfCreditsMessage()
    expect(message).toContain("may become available")
    expect(message).not.toMatch(/\d{4}/)
  })

  it("says the balance, overdraft and all", () => {
    expect(balanceText({ free: 800, purchased: 0 }, undefined, now)).toBe(
      "800 free credits",
    )
    expect(balanceText({ free: 800, purchased: 1000 }, undefined, now)).toBe(
      "800 free credits and 1,000 bought",
    )
    expect(balanceText({ free: -120, purchased: 0 }, undefined, now)).toContain(
      "120 overdrawn, forgiven at the end of the month",
    )
    expect(
      balanceText(
        { free: 800, purchased: 0, freeExpiresAt: past },
        { one: "lore token", many: "lore tokens" },
        now,
      ),
    ).toBe("0 free lore tokens")
  })

  it("says the last day free credits are good for", () => {
    expect(lastDayText("2026-11-01T00:00:00.000Z")).toBe("31 October 2026")
  })

  it("says when the free credits held expire, and otherwise only that some may come", () => {
    expect(
      freeCreditsText({ free: 10, purchased: 0, freeExpiresAt: future }, undefined, now),
    ).toContain("expire at the end of 31 October 2026")
    expect(freeCreditsText({ free: 0, purchased: 0 }, undefined, now)).toContain(
      "may become available",
    )
    expect(freeCreditsText(undefined, undefined, now)).toContain("may become available")
    expect(freeCreditsText({ free: 0, purchased: 0 }, undefined, now)).not.toMatch(/\d{4}/)
  })
})

