import { describe, expect, it } from "vitest"

import {
  driftAlerts,
  driftOf,
  driftText,
  ledgerCosts,
  periodOf,
  reconcile,
  type Reconciliation,
} from "./reconcile"

const price = {
  model: "m",
  effectiveFrom: "2026-01-01T00:00:00Z",
  kinds: [
    { kind: "input", usdPerMillion: 1 },
    { kind: "output", usdPerMillion: 5 },
  ],
}

describe("the ledger's side", () => {
  it("prices each row in its stretch at the price in force then", () => {
    const costs = ledgerCosts(
      [
        {
          model: "m",
          createdAt: "2026-11-11T10:15:00Z",
          inputTokens: 1_000_000,
          outputTokens: 0,
          credits: 7,
        },
        {
          model: "m",
          createdAt: "2026-11-11T10:45:00Z",
          inputTokens: 0,
          outputTokens: 1_000_000,
        },
        {
          model: "unpriced",
          createdAt: "2026-11-11T10:45:00Z",
          inputTokens: 5,
          outputTokens: 5,
        },
      ],
      [price],
      [],
      "hour",
    )
    const m = costs.find((cost) => cost.model === "m")
    expect(m).toMatchObject({
      periodStart: "2026-11-11T10:00:00.000Z",
      periodEnd: "2026-11-11T11:00:00.000Z",
      cents: 600,
      calls: 2,
      credits: 7,
      byKind: { input: 100, output: 500 },
    })
    expect(costs.find((cost) => cost.model === "unpriced")?.cents).toBe(0)
  })

  it("cuts time into hours or UTC days", () => {
    expect(periodOf("2026-11-11T23:59:00+02:00", "day")).toEqual({
      periodStart: "2026-11-11T00:00:00.000Z",
      periodEnd: "2026-11-12T00:00:00.000Z",
    })
  })
})

describe("the two sides together", () => {
  it("sets every stretch either knows beside the other, and how far apart", () => {
    expect(driftOf(110, 100)).toBeCloseTo(0.0909, 3)
    expect(driftOf(0, 0)).toBeNull()
    const rows = reconcile(
      {
        report: "hourly",
        refreshedAt: "2026-11-11T11:30:00Z",
        costs: [
          {
            periodStart: "2026-11-11T10:00:00.000Z",
            periodEnd: "2026-11-11T11:00:00.000Z",
            model: "m",
            cents: 660,
            byKind: { input: 160 },
          },
        ],
      },
      [
        {
          periodStart: "2026-11-11T10:00:00.000Z",
          periodEnd: "2026-11-11T11:00:00.000Z",
          model: "m",
          cents: 600,
          byKind: { input: 100 },
          calls: 2,
          credits: 6000,
        },
        {
          periodStart: "2026-11-11T11:00:00.000Z",
          periodEnd: "2026-11-11T12:00:00.000Z",
          model: "m",
          cents: 10,
          byKind: {},
          calls: 1,
          credits: 100,
        },
        {
          periodStart: "2026-11-11T11:00:00.000Z",
          periodEnd: "2026-11-11T12:00:00.000Z",
          model: "elsewhere",
          cents: 10,
          byKind: {},
          calls: 1,
          credits: 100,
        },
      ],
      (model) => model === "m",
    )
    expect(rows.map((row) => [row.model, row.complete])).toEqual([
      ["m", true],
      ["m", false],
    ])
    expect(rows[0]?.drift).toBeCloseTo(60 / 660)
  })

  it("names a model whose day drifts past the threshold, and the kind furthest apart", () => {
    const row = (provider: number, ledger: number): Reconciliation => ({
      periodStart: "2026-11-11T10:00:00.000Z",
      periodEnd: "2026-11-11T11:00:00.000Z",
      model: "m",
      report: "hourly",
      complete: true,
      providerCents: provider,
      ledgerCents: ledger,
      providerByKind: { input: provider - 10, output: 10 },
      ledgerByKind: { input: ledger - 10, output: 10 },
      drift: driftOf(provider, ledger),
      ledgerCalls: 1,
      ledgerCredits: 1,
    })
    const now = new Date("2026-11-11T12:00:00Z")
    const alerts = driftAlerts([row(660, 600)], now)
    expect(alerts[0]).toMatchObject({ model: "m", worstKind: "input" })
    expect(driftText(alerts[0]!)).toContain("The provider billed $6.60")
    expect(driftAlerts([row(601, 600)], now)).toEqual([])
    expect(driftAlerts([row(20, 10)], now)).toEqual([])
  })
})
