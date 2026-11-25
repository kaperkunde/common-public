import { describe, expect, it } from "vitest"

import {
  creditFor,
  formatCompact,
  formatMoney,
  formatUnits,
  microsOf,
  parseUnits,
  refundCentsFor,
  unitsOf,
} from "./units"

const lore = { one: "credit", many: "credits", perDollar: 1_000_000 }

describe("units", () => {
  it("is one unit per micro at 1,000,000 per dollar, and scales otherwise", () => {
    expect(unitsOf(8_000_000, lore)).toBe(8_000_000)
    expect(unitsOf(1_000_000, 100)).toBe(100)
    expect(unitsOf(1_999_999, 1)).toBe(1)
    expect(unitsOf(-1_500_000, 1)).toBe(-1)
    expect(microsOf(100, 100)).toBe(1_000_000)
  })

  it("formats compactly without rounding up into the next suffix", () => {
    expect(formatCompact(0)).toBe("0")
    expect(formatCompact(950)).toBe("950")
    expect(formatCompact(84_000)).toBe("84k")
    expect(formatCompact(84_900)).toBe("84k")
    expect(formatCompact(1_234)).toBe("1.2k")
    expect(formatCompact(1_200_000)).toBe("1.2M")
    expect(formatCompact(12_000_000)).toBe("12M")
    expect(formatCompact(999_999)).toBe("999k")
    expect(formatCompact(-5_500)).toBe("-5.5k")
    expect(formatCompact(Number.NaN)).toBe("0")
  })

  it("says an amount in the app's own unit, singular for one", () => {
    expect(formatUnits(8_000_000, lore)).toBe("8,000,000 credits")
    expect(formatUnits(1, lore)).toBe("1 credit")
    expect(formatUnits(84_000, lore, { compact: true })).toBe("84k credits")
    expect(formatUnits(84_000, lore, { bare: true })).toBe("84,000")
  })

  it("formats prices and what a purchase credits", () => {
    expect(formatMoney(1000, "eur")).toBe("€10.00")
    expect(formatMoney(450, "usd")).toBe("$4.50")
    expect(creditFor(1000, { centsPerDollar: 100 })).toBe(10_000_000)
    expect(creditFor(1000, { centsPerDollar: 120 })).toBe(8_333_333)
  })
})

describe("refundCentsFor", () => {
  const purchase = {
    amountCents: 1000,
    totalCents: 1210,
    creditMicros: 10_000_000,
  }
  it("is pro rata of what was paid, tax included, rounded down", () => {
    expect(refundCentsFor(purchase, 10_000_000)).toBe(1210)
    expect(refundCentsFor(purchase, 5_000_000)).toBe(605)
    expect(refundCentsFor(purchase, 3_333_333)).toBe(403)
  })
  it("makes the parts add up to the whole", () => {
    const first = refundCentsFor(purchase, 3_333_333)
    const second = refundCentsFor(
      { ...purchase, refundedCreditMicros: 3_333_333, refundedCents: first },
      6_666_667,
    )
    expect(first + second).toBe(1210)
  })
  it("falls back to the amount when the total is unknown, and is zero for nothing", () => {
    expect(refundCentsFor({ ...purchase, totalCents: null }, 10_000_000)).toBe(
      1000,
    )
    expect(refundCentsFor(purchase, 0)).toBe(0)
  })
  it("does not overflow on a large purchase", () => {
    expect(
      refundCentsFor(
        { amountCents: 9_000_000, totalCents: 9_000_000, creditMicros: 9e12 },
        9e12,
      ),
    ).toBe(9_000_000)
  })
})

describe("parseUnits", () => {
  it("reads a thousands separator in en", () => {
    expect(parseUnits("250,000", "en")).toBe(250000)
    expect(parseUnits("250000", "en")).toBe(250000)
    expect(parseUnits("1.5", "en")).toBe(1.5)
  })
  it("reads nl: dot groups, comma decimals", () => {
    expect(parseUnits("250.000", "nl")).toBe(250000)
    expect(parseUnits("1,5", "nl")).toBe(1.5)
  })
  it("ignores spaces and rejects garbage", () => {
    expect(parseUnits(" 250 000 ", "en")).toBe(250000)
    for (const bad of ["", "abc", "1e3", "-5", "1.2.3", "12abc"])
      expect(parseUnits(bad, "en")).toBeNull()
  })
})
