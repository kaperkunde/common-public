import { describe, expect, it } from "vitest"

import {
  creditFor,
  formatCompact,
  formatMoney,
  formatUnits,
  microsOf,
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
