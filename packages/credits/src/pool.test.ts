import { describe, expect, it } from "vitest"
import {
  EMPTY_USE,
  allotmentsCovered,
  dollarsText,
  driftFactorOf,
  effectiveDrift,
  forecastText,
  grantFor,
  overBudget,
  poolCommittedUsd,
  poolForecast,
  poolLeftUsd,
  poolLevel,
  poolLevelText,
  poolNoticeText,
  poolPeriod,
  monthText,
  noBudgetText,
  overBudgetText,
  agoText,
} from "./pool"
import { lastDayText } from "./units"

const now = new Date("2026-11-11T12:00:00.000Z")
const november = poolPeriod(now)

describe("the pool's period", () => {
  it("is the calendar month, UTC", () => {
    expect(november).toEqual({
      start: "2026-11-01T00:00:00.000Z",
      end: "2026-12-01T00:00:00.000Z",
    })
    expect(poolPeriod(new Date("2026-12-31T23:59:59.999Z"))).toEqual({
      start: "2026-12-01T00:00:00.000Z",
      end: "2027-01-01T00:00:00.000Z",
    })
  })

  it("names the last day of a month by when it ends", () => {
    expect(lastDayText(november.end)).toBe("30 November 2026")
    expect(monthText(november)).toBe("November 2026")
  })
})

describe("what the pool holds", () => {
  const use = {
    grantedCredits: 30_000_000,
    grantedUsd: 30,
    overdraftUsd: 2,
    driftFactor: 1,
  }

  it("counts grants and overdrafts against the budget", () => {
    expect(poolCommittedUsd(use)).toBe(32)
    expect(poolLeftUsd(50, use)).toBe(18)
  })

  it("counts every dollar at the drift factor where Anthropic bills more, never less", () => {
    expect(poolCommittedUsd({ ...use, driftFactor: 1.25 })).toBe(40)
    expect(poolCommittedUsd({ ...use, driftFactor: 0.5 })).toBe(32)
    expect(effectiveDrift(Number.NaN)).toBe(1)
    expect(effectiveDrift(undefined)).toBe(1)
  })

  it("goes below nothing when a budget is lowered past what was granted", () => {
    expect(poolLeftUsd(20, use)).toBe(-12)
    expect(poolLevel(20, use)).toBe("empty")
  })

  it("says where it stands", () => {
    expect(poolLevel(0, EMPTY_USE)).toBe("none")
    expect(poolLevel(100, use)).toBe("ok")
    expect(poolLevel(40, use)).toBe("low")
    expect(poolLevel(32, use)).toBe("empty")
  })
})

describe("a refill from the pool", () => {
  const base = {
    allotment: 1_000_000,
    takenThisMonth: 0,
    budgetUsd: 50,
    use: EMPTY_USE,
    perDollar: 1_000_000,
  }

  it("is the whole allotment while the pool has it", () => {
    expect(grantFor(base)).toBe(1_000_000)
  })

  it("is what is left of the player's allotment this month", () => {
    expect(grantFor({ ...base, takenThisMonth: 400_000 })).toBe(600_000)
    expect(grantFor({ ...base, takenThisMonth: 1_000_000 })).toBe(0)
  })

  it("is what is left of the pool when that is less", () => {
    expect(
      grantFor({
        ...base,
        use: { ...EMPTY_USE, grantedUsd: 49.75, grantedCredits: 49_750_000 },
      }),
    ).toBe(250_000)
  })

  it("is what the pool can pay for at the drift factor", () => {
    expect(
      grantFor({
        ...base,
        budgetUsd: 1,
        use: { ...EMPTY_USE, driftFactor: 2 },
      }),
    ).toBe(500_000)
  })

  it("is nothing with no budget, an empty pool, or no ratio", () => {
    expect(grantFor({ ...base, budgetUsd: 0 })).toBe(0)
    expect(grantFor({ ...base, use: { ...EMPTY_USE, grantedUsd: 60 } })).toBe(0)
    expect(grantFor({ ...base, perDollar: 0 })).toBe(0)
  })
})

describe("the drift factor", () => {
  it("is the provider's figure over the ledger's, never below one", () => {
    expect(driftFactorOf(110, 100)).toBeCloseTo(1.1)
    expect(driftFactorOf(90, 100)).toBe(1)
    expect(driftFactorOf(100, 0)).toBe(1)
    expect(driftFactorOf(null, 100)).toBe(1)
  })
})

describe("what the admin is shown", () => {
  it("says how many allotments a budget pays for", () => {
    expect(allotmentsCovered(50, 1_000_000, 1_000_000)).toBe(50)
    expect(allotmentsCovered(50, 0, 1_000_000)).toBe(0)
  })

  it("says plainly that no budget is no free tokens", () => {
    expect(poolLevelText(undefined, EMPTY_USE)).toBe(noBudgetText())
    expect(noBudgetText({ one: "token", many: "tokens" })).toBe(
      "No free-token budget set: users get no free tokens.",
    )
    expect(poolLevelText(0, EMPTY_USE)).toContain("no free credits")
    expect(poolLevelText(50, { ...EMPTY_USE, grantedUsd: 10 })).toBe(
      "$40.00 left this month.",
    )
  })

  it("forecasts when the pool runs out at this month's pace", () => {
    // Ten and a half days in, $21 gone of $50: about the 25th.
    const use = { ...EMPTY_USE, grantedUsd: 21 }
    const runsOut = poolForecast(50, use, november, now)
    expect(runsOut?.slice(0, 10)).toBe("2026-11-26")
    expect(forecastText(50, use, november, now)).toBe(
      "At this pace it runs out around 26 November 2026.",
    )
    expect(forecastText(500, use, november, now)).toBe(
      "At this pace it lasts the month.",
    )
    expect(forecastText(50, EMPTY_USE, november, now)).toBe(
      "Nothing handed out yet this month.",
    )
  })

  it("says when the key's whole bill is past the budget and what was bought", () => {
    expect(overBudget({ providerUsd: 80, budgetUsd: 50, boughtUsd: 20 })).toBe(
      true,
    )
    expect(overBudget({ providerUsd: 60, budgetUsd: 50, boughtUsd: 20 })).toBe(
      false,
    )
    expect(
      overBudget({ providerUsd: undefined, budgetUsd: 0, boughtUsd: 0 }),
    ).toBe(false)
  })

  it("words the notices with the month and the budget", () => {
    expect(poolNoticeText("empty", november, 50)).toContain(
      "November 2026 ($50.00) is empty",
    )
    expect(poolNoticeText("low", november, 50)).toContain("Four-fifths")
    expect(overBudgetText(november, 80, 50, 20)).toContain(
      "more than the free-credit budget ($50.00)",
    )
  })

  it("says how long ago a check was", () => {
    expect(agoText("2026-11-11T11:30:00.000Z", now)).toBe("within the hour")
    expect(agoText("2026-11-11T09:00:00.000Z", now)).toBe("3 hours ago")
    expect(agoText("2026-11-09T12:00:00.000Z", now)).toBe("2 days ago")
  })

  it("keeps small amounts readable", () => {
    expect(dollarsText(12.5)).toBe("$12.50")
    expect(dollarsText(0.0015)).toBe("$0.0015")
    expect(dollarsText(-3)).toBe("-$3.00")
  })
})
