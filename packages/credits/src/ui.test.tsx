import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { EMPTY_USE } from "./pool"
import type { PoolStatus } from "./store"
import {
  CreditsCard,
  FreePoolPanel,
  GrantsPanel,
  ModelPricesPanel,
  PRICE_FORM_KINDS,
  RatioPanel,
} from "./ui"

const now = new Date("2026-11-11T12:00:00Z")
const unit = { one: "lore token", many: "lore tokens" }
const nothing = async () => undefined

describe("a user's card", () => {
  it("says the balance, when free credits expire, what an amount buys, and the history", () => {
    const html = renderToStaticMarkup(
      <CreditsCard
        unit={unit}
        balance={{
          free: 800,
          purchased: 1000,
          freeExpiresAt: "2026-12-01T00:00:00Z",
        }}
        currencies={{ eur: "inclusive", usd: "exclusive" }}
        salePrices={[
          {
            currency: "eur",
            centsPerMillion: 250,
            effectiveFrom: "2026-01-01T00:00:00Z",
          },
        ]}
        history={[
          {
            type: "grant",
            grant: {
              id: 1,
              amount: 500,
              reason: "a playtest",
              createdAt: "2026-11-02T00:00:00Z",
            },
          },
        ]}
        stripeEnabled
        onBuy={nothing}
        onSaveAutorefill={nothing}
        onSaveCard={nothing}
        now={now}
      />,
    )
    expect(html).toContain("800 free lore tokens and 1,000 bought")
    expect(html).toContain("expire at the end of 30 November 2026")
    expect(html).toContain("€5.00 buys 2,000,000 lore tokens")
    expect(html).toContain("Granted by the admin: a playtest")
    expect(html).toContain("Tax included")
  })

  it("says nothing is sold where Stripe is off", () => {
    const html = renderToStaticMarkup(
      <CreditsCard
        currencies={{ eur: "inclusive" }}
        salePrices={[]}
        stripeEnabled={false}
        onBuy={nothing}
        onSaveAutorefill={nothing}
        onSaveCard={nothing}
        now={now}
      />,
    )
    expect(html).toContain("Credits cannot be bought here yet.")
    expect(html).toContain("Nothing bought or granted yet.")
  })
})

describe("the admin's panels", () => {
  it("lists every model offered with its price or none", () => {
    const html = renderToStaticMarkup(
      <ModelPricesPanel
        models={["m", "unpriced"]}
        prices={[
          {
            model: "m",
            effectiveFrom: "2026-01-01T00:00:00Z",
            kinds: [
              { kind: "input", usdPerMillion: 2 },
              { kind: "output", usdPerMillion: 10 },
            ],
          },
        ]}
        perDollar={1_000_000}
        onSetPrice={nothing}
        now={now}
      />,
    )
    expect(html).toContain("$2 in, $10 out")
    expect(html).toContain("Not priced: never used.")
    expect(PRICE_FORM_KINDS.map((kind) => kind.kind)).toContain(
      "cache_write_1h",
    )
  })

  it("says the ratio, the pool and the grants", () => {
    expect(
      renderToStaticMarkup(
        <RatioPanel
          rates={[
            { perDollar: 1_000_000, effectiveFrom: "2026-01-01T00:00:00Z" },
          ]}
          onSetRatio={nothing}
          now={now}
        />,
      ),
    ).toContain("1,000,000 credits to the dollar")
    const status: PoolStatus = {
      period: {
        start: "2026-11-01T00:00:00.000Z",
        end: "2026-12-01T00:00:00.000Z",
      },
      budgetUsd: 50,
      budgets: [],
      use: { ...EMPTY_USE, grantedUsd: 10, grantedCredits: 10_000_000 },
      users: 3,
      freeSpentUsd: 4,
      boughtSpentUsd: 2,
      grantedByAdmin: 0,
      allotment: 1_000_000,
      perDollar: 1_000_000,
    }
    const pool = renderToStaticMarkup(
      <FreePoolPanel
        status={status}
        onSetBudget={nothing}
        onSetAllotment={nothing}
        now={now}
      />,
    )
    expect(pool).toContain("$40.00 left this month.")
    expect(pool).toContain("to 3 users")
    expect(pool).toContain("covers 50 full")
    const grants = renderToStaticMarkup(
      <GrantsPanel
        grants={[
          {
            id: 1,
            userId: "ash",
            amount: -300,
            reason: "counted twice",
            adminEmail: "admin@example.com",
            createdAt: "2026-11-02T00:00:00Z",
          },
        ]}
        onGrant={nothing}
      />,
    )
    expect(grants).toContain("ash: Corrected by the admin: counted twice")
    expect(grants).toContain("-300 credits")
  })
})
