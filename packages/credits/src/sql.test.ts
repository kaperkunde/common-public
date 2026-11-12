/**
 * The SQL itself, rendered from the templates and run against a real Postgres: admission,
 * spending, the pool running dry, a new month, idempotent crediting, the refill claim, and the
 * server-only checks. Skipped unless CREDITS_TEST_DATABASE_URL names a Postgres to use.
 */

import type pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createCredits, CreditsRefusedError } from "./credits"
import { pgExecutor } from "./executor"
import { createStore } from "./store"
import { databaseUrl, freshDatabase } from "./test/database"

const MONTH = `date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`

describe.skipIf(!databaseUrl)("the credit SQL", () => {
  let pool: pg.Pool
  let store: ReturnType<typeof createStore>
  let credits: ReturnType<typeof createCredits>
  const told: string[] = []

  beforeAll(async () => {
    pool = await freshDatabase("kk_credits_test")
    const db = pgExecutor(pool, { role: "server" })
    store = createStore(db)
    credits = createCredits({
      db,
      unit: { one: "lore token", many: "lore tokens" },
      onOutOfCredits: (userId) => {
        told.push(userId)
      },
    })
    await pool.query(
      `INSERT INTO public."user" (id) VALUES ('ash'), ('bo'), ('cy'), ('dee'), ('eve'), ('fay')`,
    )
    await store.setAllotment(1_000_000)
    await store.addRate(1_000_000, "2020-01-01T00:00:00Z")
    await store.setPoolBudget(1.5, "admin@example.com")
    await store.setModelPrice({
      model: "m",
      kinds: [
        { kind: "input", usdPerMillion: 1 },
        { kind: "output", usdPerMillion: 5 },
      ],
      effectiveFrom: "2020-01-01T00:00:00Z",
    })
  })

  afterAll(async () => {
    await pool?.end()
  })

  it("lets nobody but the server move a balance", async () => {
    await expect(
      pool.query(`SELECT * FROM credit_admit('ash')`),
    ).rejects.toThrow(/by the server alone/)
    const client = await pool.connect()
    try {
      await client.query("BEGIN")
      await client.query(
        `SELECT set_config('hasura.user', '{"x-hasura-role":"user"}', true)`,
      )
      await expect(
        client.query(`SELECT * FROM credit_grant('ash', 5, 'x', 'y')`),
      ).rejects.toThrow(/by the server alone/)
    } finally {
      await client.query("ROLLBACK")
      client.release()
    }
  })

  it("hands out the allotment from the pool, and what is left of it, then nothing", async () => {
    const ash = await store.admit("ash")
    expect(ash.free).toBe(1_000_000)
    const expires = (
      await pool.query(`SELECT (${MONTH} + interval '1 month') AS at`)
    ).rows[0].at as Date
    expect(new Date(ash.freeExpiresAt as string).getTime()).toBe(
      expires.getTime(),
    )
    // $1.50 budget, $1 gone: half an allotment left.
    expect((await store.admit("bo")).free).toBe(500_000)
    const cy = await credits.admit("cy", { model: "m" })
    expect(cy.ok).toBe(false)
    expect(cy.ok ? undefined : cy.code).toBe("OUT_OF_CREDITS")
    expect(cy.ok ? "" : cy.message).toContain("lore tokens")
    expect(await store.wouldAdmit("cy")).toBe(false)
    // Told once a month, however often refused.
    await credits.admit("cy", { model: "m" })
    expect(told).toEqual(["cy"])
    const status = await store.poolStatus()
    expect(status.use.grantedUsd).toBeCloseTo(1.5)
    expect(status.users).toBe(2)
  })

  it("admits a model only once it is priced", async () => {
    const verdict = await credits.admit("ash", { model: "unpriced" })
    expect(verdict.ok ? undefined : verdict.code).toBe("UNPRICED")
    await expect(
      credits.beforeCall({ userId: "ash", model: "unpriced" }),
    ).rejects.toBeInstanceOf(CreditsRefusedError)
  })

  it("spends free first, once, at the price in force when the call was made", async () => {
    const row = await credits.onUsage({
      userId: "ash",
      model: "m",
      purpose: "chat",
      requests: [{ inputTokens: 100_000, outputTokens: 20_000 }],
    })
    expect(row.credits).toBe(200_000)
    expect(row.source).toBe("free")
    expect(row.usd).toBeCloseTo(0.2)
    expect((await store.balance("ash"))?.free).toBe(800_000)
    // Spending the same row again changes nothing.
    await store.spend(row.id)
    expect((await store.balance("ash"))?.free).toBe(800_000)

    // A call made last year is priced at last year's price, whatever is in force now.
    await store.setModelPrice({
      model: "m",
      kinds: [
        { kind: "input", usdPerMillion: 10 },
        { kind: "output", usdPerMillion: 50 },
      ],
    })
    const old = await store.insertUsage({
      ...(await import("./credits")).ledgerRowOf({
        userId: "ash",
        model: "m",
        purpose: "chat",
        requests: [{ inputTokens: 1000, outputTokens: 0 }],
      }),
    })
    await pool.query(
      `UPDATE credit_usage SET "createdAt" = '2025-06-01T00:00:00Z' WHERE id = $1`,
      [old.id],
    )
    expect((await store.spend(old.id)).credits).toBe(1000)
    const now = await credits.onUsage({
      userId: "ash",
      model: "m",
      purpose: "chat",
      requests: [{ inputTokens: 1000, outputTokens: 0 }],
    })
    expect(now.credits).toBe(10_000)
  })

  it("prices speech through the same ledger, and refuses what nobody priced", async () => {
    await store.setModelPrice({
      model: "voice",
      kinds: [{ kind: "tts_chars", unit: "char", usdPerMillion: 15 }],
      effectiveFrom: "2020-01-01T00:00:00Z",
    })
    const row = await credits.onUsage({
      userId: "ash",
      model: "voice",
      purpose: "speech",
      kind: "tts_chars",
      units: 2000,
    })
    expect(row.kind).toBe("tts_chars")
    expect(row.credits).toBe(30_000)
    await expect(
      credits.onUsage({
        userId: "ash",
        model: "voice",
        purpose: "speech",
        kind: "tts_seconds",
        units: 10,
      }),
    ).rejects.toThrow(/no price for tts_seconds/)
  })

  it("multiplies by a request's factors and its long-prompt tier", async () => {
    await store.setModelPrice({
      model: "tiered",
      kinds: [
        { kind: "input", usdPerMillion: 0.1 },
        { kind: "output", usdPerMillion: 0.5 },
        { kind: "cache_read", usdPerMillion: 0.01 },
      ],
      longPromptUnits: 100000,
      longPromptFactor: 5,
      effectiveFrom: "2020-01-01T00:00:00Z",
    })
    await store.addFactor({
      dimension: "inference_geo",
      value: "us",
      factor: 1.1,
      effectiveFrom: "2020-01-01T00:00:00Z",
    })
    await store.grant("dee", 100_000, "a playtest", "admin@example.com")
    const row = await credits.onUsage({
      userId: "dee",
      model: "tiered",
      purpose: "chat",
      requests: [
        { inputTokens: 50000, outputTokens: 100 },
        {
          inputTokens: 100001,
          cachedTokens: 100000,
          outputTokens: 100,
          inferenceGeo: "us",
        },
      ],
    })
    // The same figure pricing.test.ts works out by hand.
    expect(row.credits).toBe(Math.ceil(5050 + 5775.55))
    expect(row.source).toBe("purchased")
  })

  it("overdraws free only when nothing is left, and charges the pool for it", async () => {
    const before = (await store.poolStatus()).use.overdraftUsd
    // bo holds 500,000 free: a call of 600,000 overdraws 100,000.
    const row = await credits.onUsage({
      userId: "bo",
      model: "m",
      purpose: "chat",
      requests: [{ inputTokens: 60_000, outputTokens: 0 }], // $10 a million now
    })
    expect(row.overdraftCredits).toBe(100_000)
    expect((await store.balance("bo"))?.free).toBe(-100_000)
    const after = (await store.poolStatus()).use.overdraftUsd
    expect(after - before).toBeCloseTo(0.1)
  })

  it("starts again in a new month, and expires what the old one granted", async () => {
    await pool.query(
      `UPDATE credit_balances SET "freeExpiresAt" = now() - interval '1 second' WHERE "userId" = 'ash'`,
    )
    // Expired, and this month's allotment already handed out: nothing more.
    expect((await store.admit("ash")).free).toBe(0)
    // Move this month into the past, as the calendar would.
    await pool.query(
      `UPDATE credit_free_grants SET "periodStart" = "periodStart" - interval '1 month'`,
    )
    await pool.query(
      `UPDATE credit_pool_periods SET "periodStart" = "periodStart" - interval '1 month'`,
    )
    expect(await store.wouldAdmit("ash")).toBe(true)
    expect((await store.admit("ash")).free).toBe(1_000_000)
  })

  it("hands one allotment to two admissions racing for the last of the pool", async () => {
    await pool.query(
      `UPDATE credit_pool_periods SET "grantedUsd" = 1.5 WHERE "periodStart" = ${MONTH}`,
    )
    const [one, two] = await Promise.all([
      store.admit("eve"),
      store.admit("fay"),
    ])
    // The pool is spent: nothing for either.
    expect(one.free + two.free).toBe(0)
    // Another dollar: one allotment between them, never two.
    await pool.query(
      `INSERT INTO credit_pool_budgets ("budgetUsd", "adminEmail") VALUES (2.5, 'a')`,
    )
    const [three, four] = await Promise.all([
      store.admit("eve"),
      store.admit("fay"),
    ])
    expect(three.free + four.free).toBe(1_000_000)
  })

  it("grants into what was bought, and refuses a correction below nothing", async () => {
    const after = await store.grant("cy", 50, " a comp ", "admin@example.com")
    expect(after.purchased).toBe(50)
    await expect(
      store.grant("cy", -51, "too much", "admin@example.com"),
    ).rejects.toThrow(/below nothing/)
    await expect(store.grant("nobody", 5, "x", "a")).rejects.toThrow(/no user/)
    expect((await store.grants({ userId: "cy" }))[0]?.reason).toBe("a comp")
  })

  it("credits a purchase once, whatever Stripe sends again", async () => {
    await store.addSalePrice("eur", 250)
    const purchase = await store.purchaseOpen("ash", "eur", 500)
    expect(purchase.credits).toBe(2_000_000)
    await expect(store.purchaseOpen("ash", "eur", 499)).rejects.toThrow(
      /at least 500/,
    )
    await expect(store.purchaseOpen("ash", "gbp", 500)).rejects.toThrow(
      /no price in gbp/,
    )
    const credit = {
      eventId: "evt_1",
      eventType: "checkout.session.completed",
      purchaseId: purchase.id,
      userId: "ash",
      credits: purchase.credits,
    }
    const before = (await store.balance("ash"))?.purchased ?? 0
    expect(await store.credit(credit)).toBe(true)
    expect(await store.credit(credit)).toBe(false)
    expect(await store.credit({ ...credit, eventId: "evt_2" })).toBe(false)
    await expect(
      store.credit({ ...credit, eventId: "evt_3", credits: 5 }),
    ).rejects.toThrow(/does not match/)
    expect((await store.balance("ash"))?.purchased).toBe(before + 2_000_000)
    expect((await store.purchases("ash"))[0]?.status).toBe("paid")
  })

  it("claims one refill at a time, within the month's maximum, and turns itself off on failure", async () => {
    // cy holds 50 bought and nothing free: below the threshold.
    await store.saveCard("cy", "cus_1", "pm_1", "Visa ending 4242")
    await store.saveAutorefill("cy", {
      enabled: true,
      thresholdCredits: 100_000,
      amountCents: 500,
      currency: "eur",
      monthlyMaxCents: 1000,
    })
    const claimed = await store.refillClaim("cy")
    expect(claimed?.credits).toBe(2_000_000)
    expect(await store.refillClaim("cy")).toBeUndefined()
    await store.setPurchaseStripe(claimed!.id, { stripeId: "pi_1" })
    expect(
      await store.credit({
        eventId: "evt_refill",
        eventType: "payment_intent.succeeded",
        purchaseId: claimed!.id,
        userId: "cy",
        credits: claimed!.credits,
      }),
    ).toBe(true)
    expect((await store.autorefill("cy"))?.pending).toBe(false)

    // Spend it back below the threshold, and a second refill this month fits the maximum.
    await pool.query(
      `UPDATE credit_balances SET purchased = 10 WHERE "userId" = 'cy'`,
    )
    const second = await store.refillClaim("cy")
    expect(second).toBeDefined()
    expect(
      (await store.refillFailed(second!.id, null, "Card declined"))?.enabled,
    ).toBe(false)
    expect(
      await store.refillFailed(second!.id, null, "Card declined"),
    ).toBeUndefined()
    expect((await store.autorefill("cy"))?.enabled).toBe(false)

    // On again, but €5 + €5 already this month leaves no room under €10.
    await store.saveAutorefill("cy", {
      enabled: true,
      thresholdCredits: 100_000,
      amountCents: 500,
      currency: "eur",
      monthlyMaxCents: 1000,
    })
    await pool.query(
      `UPDATE credit_purchases SET status = 'paid' WHERE id = $1`,
      [second!.id],
    )
    expect(await store.refillClaim("cy")).toBeUndefined()
  })

  it("writes a call on the user's own key at no credits, and holds it to their limit", async () => {
    await store.saveOwnBackend({
      userId: "dee",
      baseUrl: "https://models.example.com/v1",
      keyCiphertext: "v1:aa:bb:cc",
      keyLast4: "abcd",
      models: ["own-model"],
      toolChoice: "auto",
      tokenLimit: 1000,
      order: "own_only",
    })
    const before = await store.balance("dee")
    const row = await credits.onUsage({
      userId: "dee",
      model: "own-model",
      purpose: "chat",
      source: "own",
      requests: [{ inputTokens: 900, outputTokens: 200 }],
    })
    expect(row.source).toBe("own")
    expect(row.credits).toBe(0)
    expect((await store.balance("dee"))?.purchased).toBe(before?.purchased)
    const verdict = await credits.admit("dee", {
      model: "own-model",
      source: "own",
    })
    expect(verdict.ok ? undefined : verdict.code).toBe("OWN_LIMIT")
    expect((await store.ownBackend("dee"))?.models).toEqual(["own-model"])
  })

  it("keeps one proposal per model and applies it as a new price", async () => {
    const proposal = {
      model: "m",
      kinds: [
        { kind: "input", usdPerMillion: 3 },
        { kind: "output", usdPerMillion: 15 },
      ],
      factors: [{ dimension: "speed", value: "fast", factor: 2 }],
      sources: ["feed a", "feed b"],
      problems: [],
    }
    await store.propose(proposal)
    await store.propose({ ...proposal, sources: ["feed a"] })
    const pending = await store.pendingProposals()
    expect(pending).toHaveLength(1)
    expect(await store.decideProposal(pending[0]!.id, true)).toBe(true)
    expect(await store.decideProposal(pending[0]!.id, true)).toBe(false)
    const now = await store.priceNow("m")
    expect(
      now?.kinds.find((kind) => kind.kind === "input")?.usdPerMillion,
    ).toBe(3)
    expect(now?.source).toBe("feed a")
    expect(
      (await store.factors()).some((f) => f.model === "m" && f.factor === 2),
    ).toBe(true)
  })

  it("rolls back whole", async () => {
    const { migrations, render, TEST_VARS } = await import("./test/database")
    for (const migration of migrations().reverse()) {
      await pool.query(render(migration.down, TEST_VARS))
    }
    const left = await pool.query(
      `SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname LIKE 'credit_%'`,
    )
    expect(left.rows[0].n).toBe(0)
  })
})
