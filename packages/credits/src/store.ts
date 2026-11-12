/**
 * Every read and write of the credit tables, over an injected executor. The functions that
 * move money are the SQL functions the migrations ship; this only calls them and reads rows
 * back into numbers. Server side only.
 */

import type { CreditBalance } from "./balance"
import { namesOf, type CreditNames, type Executor } from "./executor"
import { EMPTY_USE, poolPeriod, type PoolPeriod, type PoolUse } from "./pool"
import type {
  DollarRate,
  KindPrice,
  ModelPrice,
  PriceFactor,
  RequestTokens,
} from "./pricing"

type Row = Record<string, unknown>

const num = (value: unknown) => {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}
const iso = (value: unknown) =>
  value === null || value === undefined
    ? null
    : value instanceof Date
      ? value.toISOString()
      : String(value)

export type BalanceRow = CreditBalance & {
  userId: string
  notifiedFor?: string | null
}

const balanceOf = (row: Row): BalanceRow => ({
  userId: String(row.userId),
  free: num(row.free),
  purchased: num(row.purchased),
  freeExpiresAt: iso(row.freeExpiresAt),
  notifiedFor: iso(row.notifiedFor),
})

/** A ledger row as the stores hand it back. */
export type UsageRow = {
  id: number
  userId: string
  model: string
  purpose: string
  kind: string
  source: "free" | "purchased" | "own" | null
  credits: number | null
  usd: number | null
  freeCredits: number | null
  purchasedCredits: number | null
  overdraftCredits: number | null
  inputTokens: number
  cachedTokens: number
  outputTokens: number
  totalTokens: number
  scopeId: string | null
  jobId: string | null
  activity: string | null
  createdAt: string
}

const nullableNum = (value: unknown) =>
  value === null || value === undefined ? null : num(value)

const usageOf = (row: Row): UsageRow => ({
  id: num(row.id),
  userId: String(row.userId),
  model: String(row.model),
  purpose: String(row.purpose),
  kind: String(row.kind),
  source: (row.source as UsageRow["source"]) ?? null,
  credits: nullableNum(row.credits),
  usd: nullableNum(row.usd),
  freeCredits: nullableNum(row.freeCredits),
  purchasedCredits: nullableNum(row.purchasedCredits),
  overdraftCredits: nullableNum(row.overdraftCredits),
  inputTokens: num(row.inputTokens),
  cachedTokens: num(row.cachedTokens),
  outputTokens: num(row.outputTokens),
  totalTokens: num(row.totalTokens),
  scopeId: (row.scopeId as string | null) ?? null,
  jobId: (row.jobId as string | null) ?? null,
  activity: (row.activity as string | null) ?? null,
  createdAt: String(iso(row.createdAt)),
})

/** A call as admission asks about its price: the model, and the kinds it will use. */
export type PricedCallAsk = { model: string; kinds: readonly string[] }

/** What the ledger is handed for one call, already split into its columns. */
export type LedgerInsert = {
  userId: string
  model: string
  purpose: string
  kind: string
  scopeId?: string | null
  jobId?: string | null
  activity?: string | null
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedTokens: number
  cacheWriteTokens: number
  cacheWrite1hTokens: number
  reasoningTokens: number
  units?: Record<string, number> | null
  requests?: readonly RequestTokens[] | null
  inferenceGeo?: string | null
  speed?: string | null
  serviceTier?: string | null
  /** `own` writes the row at no credits, never handed to spend. */
  own?: boolean
}

export type PurchaseRow = {
  id: number
  userId: string
  kind: "purchase" | "refill"
  stripeId: string | null
  currency: string
  amountCents: number
  taxCents: number | null
  totalCents: number | null
  credits: number
  priceFrom: string
  status: "pending" | "paid" | "failed" | "abandoned"
  failure: string | null
  createdAt: string
  paidAt: string | null
}

const purchaseOf = (row: Row): PurchaseRow => ({
  id: num(row.id),
  userId: String(row.userId),
  kind: row.kind as PurchaseRow["kind"],
  stripeId: (row.stripeId as string | null) ?? null,
  currency: String(row.currency),
  amountCents: num(row.amountCents),
  taxCents: nullableNum(row.taxCents),
  totalCents: nullableNum(row.totalCents),
  credits: num(row.credits),
  priceFrom: String(iso(row.priceFrom)),
  status: row.status as PurchaseRow["status"],
  failure: (row.failure as string | null) ?? null,
  createdAt: String(iso(row.createdAt)),
  paidAt: iso(row.paidAt),
})

export type AutorefillRow = {
  userId: string
  enabled: boolean
  thresholdCredits: number
  amountCents: number
  currency: string
  monthlyMaxCents: number
  stripeCustomerId: string | null
  paymentMethodId: string | null
  paymentMethodLabel: string | null
  pending: boolean
  failedAt: string | null
}

const autorefillOf = (row: Row): AutorefillRow => ({
  userId: String(row.userId),
  enabled: Boolean(row.enabled),
  thresholdCredits: num(row.thresholdCredits),
  amountCents: num(row.amountCents),
  currency: String(row.currency),
  monthlyMaxCents: num(row.monthlyMaxCents),
  stripeCustomerId: (row.stripeCustomerId as string | null) ?? null,
  paymentMethodId: (row.paymentMethodId as string | null) ?? null,
  paymentMethodLabel: (row.paymentMethodLabel as string | null) ?? null,
  pending: Boolean(row.pending),
  failedAt: iso(row.failedAt),
})

export type GrantRow = {
  id: number
  userId: string
  amount: number
  reason: string
  adminEmail: string
  createdAt: string
}

export type OwnBackendRow = {
  userId: string
  baseUrl: string
  /** Sealed; open it only at the moment of a call. */
  keyCiphertext: string | null
  keyLast4: string | null
  models: string[]
  toolChoice: "required" | "auto"
  tokenLimit: number | null
  order: "credits_then_own" | "own_then_credits" | "credits_only" | "own_only"
  limitNotifiedFor: string | null
}

/** The pool as an admin screen draws it. */
export type PoolStatus = {
  period: PoolPeriod
  /** The budget in force, or undefined where none was ever set, which is nothing at all. */
  budgetUsd?: number
  budgets: { budgetUsd: number; effectiveFrom: string; adminEmail: string }[]
  use: PoolUse
  /** How many users were handed free credits this month. */
  users: number
  /** What users spent of their free credits this month, in dollars. */
  freeSpentUsd: number
  /** What bought credits paid for this month, in dollars. */
  boughtSpentUsd: number
  /** The provider's figure for the month, where a cost check wrote one. */
  providerUsd?: number
  ledgerUsd?: number
  checkedAt?: string
  /** Credits the admin granted (or took back) this month. */
  grantedByAdmin: number
  allotment: number
  perDollar: number
}

/** Every query this package makes, bound to one executor and one set of names. */
export const createStore = (db: Executor, names: CreditNames = {}) => {
  const { t, usage } = namesOf(names)

  const one = async <ROW>(sql: string, params: unknown[] = []) =>
    (await db.query<ROW>(sql, params))[0]

  const pricesWithKinds = async (where = "", params: unknown[] = []) => {
    const rows = await db.query<Row>(
      `SELECT p.*, coalesce((SELECT json_agg(json_build_object(
          'kind', k.kind, 'unit', k.unit, 'usdPerMillion', k."usdPerMillion",
          'derived', k.derived) ORDER BY k.kind)
        FROM ${t("model_price_kinds")} k WHERE k."priceId" = p.id), '[]'::json) AS kinds
       FROM ${t("model_prices")} p ${where}
       ORDER BY p.model, p."effectiveFrom" DESC`,
      params,
    )
    return rows.map((row): ModelPrice & { id: number } => ({
      id: num(row.id),
      model: String(row.model),
      effectiveFrom: String(iso(row.effectiveFrom)),
      kinds: (row.kinds as KindPrice[]).map((kind) => ({
        ...kind,
        usdPerMillion: num(kind.usdPerMillion),
      })),
      longPromptUnits: nullableNum(row.longPromptUnits),
      longPromptFactor: nullableNum(row.longPromptFactor),
      source: (row.source as string | null) ?? null,
      syncedAt: iso(row.syncedAt),
    }))
  }

  return {
    // --- balances, admission and spending ---------------------------------------------

    /**
     * Admits a user, handing out free credits from the pool if they had none. Given the call's
     * model and the kinds it will use, the database refuses (throws) a call its price cannot
     * charge before anything is handed out; ask `missingKinds` first to refuse in words.
     */
    admit: async (userId: string, call?: PricedCallAsk) =>
      balanceOf(
        (await one<Row>(`SELECT * FROM ${t("admit")}($1, $2, $3::text[])`, [
          userId,
          call?.model ?? null,
          call ? [...call.kinds] : null,
        ])) as Row,
      ),

    /** Whether admit would admit a user now, changing nothing; false for an unpriced call. */
    wouldAdmit: async (userId: string, call?: PricedCallAsk) =>
      Boolean(
        (
          await one<{ admit: boolean }>(
            `SELECT ${t("would_admit")}($1, $2, $3::text[]) AS admit`,
            [userId, call?.model ?? null, call ? [...call.kinds] : null],
          )
        )?.admit,
      ),

    /** The kinds of a call the model's price in force cannot charge; empty when it can. */
    missingKinds: async (call: PricedCallAsk) =>
      (
        (
          await one<{ missing: string[] | null }>(
            `SELECT ${t("missing_kinds")}($1, $2::text[]) AS missing`,
            [call.model, [...call.kinds]],
          )
        )?.missing ?? []
      ).map(String),

    /** Ledger rows written and never converted, oldest first: what `spendPending` retries. */
    pendingUsage: async (limit = 100) =>
      (
        await db.query<Row>(`SELECT * FROM ${t("pending_usage")}($1)`, [limit])
      ).map(usageOf),

    balance: async (userId: string) => {
      const row = await one<Row>(
        `SELECT * FROM ${t("balances")} WHERE "userId" = $1`,
        [userId],
      )
      return row ? balanceOf(row) : undefined
    },

    /** True for the one call that claimed telling the user they ran out this month. */
    claimOutNotice: async (userId: string) =>
      (await db.query(`SELECT * FROM ${t("claim_out_notice")}($1)`, [userId]))
        .length > 0,

    insertUsage: async (row: LedgerInsert) =>
      usageOf(
        (await one<Row>(
          `INSERT INTO ${usage} (
             "userId", model, purpose, kind, "scopeId", "jobId", activity,
             "inputTokens", "outputTokens", "totalTokens", "cachedTokens", "cacheWriteTokens",
             "cacheWrite1hTokens", "reasoningTokens", units, requests, "inferenceGeo", speed,
             "serviceTier", source, credits
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
           RETURNING *`,
          [
            row.userId,
            row.model,
            row.purpose,
            row.kind,
            row.scopeId ?? null,
            row.jobId ?? null,
            row.activity?.slice(0, 200) ?? null,
            row.inputTokens,
            row.outputTokens,
            row.totalTokens,
            row.cachedTokens,
            row.cacheWriteTokens,
            row.cacheWrite1hTokens,
            row.reasoningTokens,
            row.units ? JSON.stringify(row.units) : null,
            row.requests && row.requests.length > 0
              ? JSON.stringify(row.requests)
              : null,
            row.inferenceGeo ?? null,
            row.speed ?? null,
            row.serviceTier ?? null,
            row.own ? "own" : null,
            row.own ? 0 : null,
          ],
        )) as Row,
      ),

    spend: async (usageId: number) =>
      usageOf(
        (await one<Row>(`SELECT * FROM ${t("spend")}($1)`, [usageId])) as Row,
      ),

    usageFor: async (userId: string, limit = 50) =>
      (
        await db.query<Row>(
          `SELECT * FROM ${usage} WHERE "userId" = $1 ORDER BY "createdAt" DESC, id DESC LIMIT $2`,
          [userId, limit],
        )
      ).map(usageOf),

    // --- prices -------------------------------------------------------------------------

    prices: (model?: string) =>
      model
        ? pricesWithKinds(`WHERE p.model = $1`, [model])
        : pricesWithKinds(),

    /** The price a model is charged at now, or undefined for a model nobody priced. */
    priceNow: async (model: string) =>
      (
        await pricesWithKinds(
          `WHERE p.id = (SELECT (${t("price_at")}($1, now())).id)`,
          [model],
        )
      )[0],

    setModelPrice: async (price: {
      model: string
      kinds: readonly KindPrice[]
      longPromptUnits?: number | null
      longPromptFactor?: number | null
      source?: string
      syncedAt?: string | null
      effectiveFrom?: string
    }) => {
      const row = await one<Row>(
        `SELECT * FROM ${t("set_model_price")}($1, $2::jsonb, $3, $4, $5, $6, coalesce($7::timestamptz, now()))`,
        [
          price.model,
          JSON.stringify(price.kinds),
          price.longPromptUnits ?? null,
          price.longPromptFactor ?? null,
          price.source ?? "admin",
          price.syncedAt ?? null,
          price.effectiveFrom ?? null,
        ],
      )
      return num(row?.id)
    },

    rates: async (): Promise<DollarRate[]> =>
      (
        await db.query<Row>(
          `SELECT * FROM ${t("dollar_rates")} ORDER BY "effectiveFrom" DESC`,
        )
      ).map((row) => ({
        perDollar: num(row.perDollar),
        effectiveFrom: String(iso(row.effectiveFrom)),
      })),

    addRate: async (perDollar: number, effectiveFrom?: string) => {
      await db.query(
        `INSERT INTO ${t("dollar_rates")} ("perDollar", "effectiveFrom") VALUES ($1, coalesce($2::timestamptz, now()))`,
        [perDollar, effectiveFrom ?? null],
      )
    },

    factors: async (): Promise<PriceFactor[]> =>
      (
        await db.query<Row>(
          `SELECT * FROM ${t("price_factors")} ORDER BY "effectiveFrom" DESC`,
        )
      ).map((row) => ({
        model: (row.model as string | null) ?? null,
        dimension: String(row.dimension),
        value: String(row.value),
        factor: num(row.factor),
        effectiveFrom: String(iso(row.effectiveFrom)),
      })),

    addFactor: async (
      factor: Omit<PriceFactor, "effectiveFrom"> & { effectiveFrom?: string },
    ) => {
      await db.query(
        `INSERT INTO ${t("price_factors")} (model, dimension, value, factor, "effectiveFrom")
         VALUES ($1, $2, $3, $4, coalesce($5::timestamptz, now()))`,
        [
          factor.model ?? null,
          factor.dimension,
          factor.value,
          factor.factor,
          factor.effectiveFrom ?? null,
        ],
      )
    },

    // --- the allotment and the pool -----------------------------------------------------

    allotment: async () =>
      num(
        (await one<Row>(`SELECT allotment FROM ${t("settings")} WHERE id`))
          ?.allotment,
      ),

    setAllotment: async (allotment: number) => {
      await db.query(`UPDATE ${t("settings")} SET allotment = $1 WHERE id`, [
        allotment,
      ])
    },

    setPoolBudget: async (budgetUsd: number, adminEmail: string) => {
      await db.query(
        `INSERT INTO ${t("pool_budgets")} ("budgetUsd", "adminEmail") VALUES ($1, $2)`,
        [budgetUsd, adminEmail],
      )
    },

    poolStatus: async (now: Date = new Date()): Promise<PoolStatus> => {
      const period = poolPeriod(now)
      const [budgets, pool, users, spent, granted, allotment, ratio] =
        await Promise.all([
          db.query<Row>(
            `SELECT * FROM ${t("pool_budgets")} ORDER BY "effectiveFrom" DESC LIMIT 20`,
          ),
          db.query<Row>(
            `SELECT * FROM ${t("pool_periods")} WHERE "periodStart" = $1`,
            [period.start],
          ),
          db.query<Row>(
            `SELECT count(DISTINCT "userId") AS n FROM ${t("free_grants")} WHERE "periodStart" = $1`,
            [period.start],
          ),
          db.query<Row>(
            `SELECT coalesce(sum(usd), 0) AS usd, coalesce(sum("freeUsd"), 0) AS free
             FROM ${usage} WHERE "createdAt" >= $1 AND "createdAt" < $2`,
            [period.start, period.end],
          ),
          db.query<Row>(
            `SELECT coalesce(sum(amount), 0) AS n FROM ${t("grants")}
             WHERE "createdAt" >= $1 AND "createdAt" < $2`,
            [period.start, period.end],
          ),
          db.query<Row>(`SELECT allotment FROM ${t("settings")} WHERE id`),
          db.query<Row>(
            `SELECT "perDollar" FROM ${t("dollar_rates")} WHERE "effectiveFrom" <= now()
             ORDER BY "effectiveFrom" DESC LIMIT 1`,
          ),
        ])
      const history = budgets.map((row) => ({
        budgetUsd: num(row.budgetUsd),
        effectiveFrom: String(iso(row.effectiveFrom)),
        adminEmail: String(row.adminEmail),
      }))
      const current = history.find(
        (row) => new Date(row.effectiveFrom).getTime() <= now.getTime(),
      )
      const row = pool[0]
      const use: PoolUse = row
        ? {
            grantedCredits: num(row.grantedCredits),
            grantedUsd: num(row.grantedUsd),
            overdraftUsd: num(row.overdraftUsd),
            driftFactor: num(row.driftFactor) || 1,
          }
        : EMPTY_USE
      const usd = num(spent[0]?.usd)
      const freeUsd = num(spent[0]?.free)
      return {
        period,
        budgetUsd: current?.budgetUsd,
        budgets: history,
        use,
        users: num(users[0]?.n),
        freeSpentUsd: freeUsd,
        boughtSpentUsd: Math.max(0, usd - freeUsd),
        ...(row && row.providerCents !== null && row.providerCents !== undefined
          ? {
              providerUsd: num(row.providerCents) / 100,
              ledgerUsd: num(row.ledgerCents) / 100,
              checkedAt: iso(row.checkedAt) ?? undefined,
            }
          : {}),
        grantedByAdmin: num(granted[0]?.n),
        allotment: num(allotment[0]?.allotment),
        perDollar: num(ratio[0]?.perDollar),
      }
    },

    /** Writes the provider's figure for a month beside the ledger's, and the drift factor. */
    trueUpPool: async (
      periodStart: string,
      figures: {
        providerCents: number
        ledgerCents: number
        driftFactor: number
      },
    ) => {
      await db.query(
        `INSERT INTO ${t("pool_periods")} ("periodStart", "providerCents", "ledgerCents", "driftFactor", "checkedAt")
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT ("periodStart") DO UPDATE SET "providerCents" = excluded."providerCents",
           "ledgerCents" = excluded."ledgerCents", "driftFactor" = excluded."driftFactor",
           "checkedAt" = excluded."checkedAt"`,
        [
          periodStart,
          figures.providerCents,
          figures.ledgerCents,
          Math.max(1, figures.driftFactor),
        ],
      )
    },

    /** True for the one call that claimed telling the admin of a pool level this month. */
    claimPoolNotice: async (
      periodStart: string,
      notice: "low" | "empty" | "over",
    ) => {
      const column = {
        low: '"notifiedLowAt"',
        empty: '"notifiedEmptyAt"',
        over: '"notifiedOverAt"',
      }[notice]
      await db.query(
        `INSERT INTO ${t("pool_periods")} ("periodStart") VALUES ($1) ON CONFLICT DO NOTHING`,
        [periodStart],
      )
      return (
        (
          await db.query(
            `UPDATE ${t("pool_periods")} SET ${column} = now()
             WHERE "periodStart" = $1 AND ${column} IS NULL RETURNING "periodStart"`,
            [periodStart],
          )
        ).length > 0
      )
    },

    // --- grants ---------------------------------------------------------------------------

    grant: async (
      userId: string,
      amount: number,
      reason: string,
      adminEmail: string,
    ) =>
      balanceOf(
        (await one<Row>(`SELECT * FROM ${t("grant")}($1, $2, $3, $4)`, [
          userId,
          amount,
          reason,
          adminEmail,
        ])) as Row,
      ),

    grants: async (options: { userId?: string; limit?: number } = {}) =>
      (
        await db.query<Row>(
          `SELECT * FROM ${t("grants")} WHERE ($1::text IS NULL OR "userId"::text = $1)
           ORDER BY "createdAt" DESC, id DESC LIMIT $2`,
          [options.userId ?? null, options.limit ?? 50],
        )
      ).map((row): GrantRow => ({
        id: num(row.id),
        userId: String(row.userId),
        amount: num(row.amount),
        reason: String(row.reason),
        adminEmail: String(row.adminEmail),
        createdAt: String(iso(row.createdAt)),
      })),

    // --- a user's own model ---------------------------------------------------------------

    ownBackend: async (userId: string): Promise<OwnBackendRow | undefined> => {
      const row = await one<Row>(
        `SELECT * FROM ${t("own_backends")} WHERE "userId" = $1`,
        [userId],
      )
      if (!row) return undefined
      return {
        userId: String(row.userId),
        baseUrl: String(row.baseUrl),
        keyCiphertext: (row.keyCiphertext as string | null) ?? null,
        keyLast4: (row.keyLast4 as string | null) ?? null,
        models: String(row.models ?? "")
          .split(",")
          .map((model) => model.trim())
          .filter(Boolean),
        toolChoice: row.toolChoice as OwnBackendRow["toolChoice"],
        tokenLimit: nullableNum(row.tokenLimit),
        order: row.order as OwnBackendRow["order"],
        limitNotifiedFor: iso(row.limitNotifiedFor),
      }
    },

    /** Saves a back end; the key arrives sealed and is never read back by any user role. */
    saveOwnBackend: async (
      backend: Omit<OwnBackendRow, "limitNotifiedFor" | "models"> & {
        models: readonly string[]
      },
    ) => {
      await db.query(
        `INSERT INTO ${t("own_backends")}
           ("userId", "baseUrl", "keyCiphertext", "keyLast4", models, "toolChoice", "tokenLimit", "order")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT ("userId") DO UPDATE SET "baseUrl" = excluded."baseUrl",
           "keyCiphertext" = excluded."keyCiphertext", "keyLast4" = excluded."keyLast4",
           models = excluded.models, "toolChoice" = excluded."toolChoice",
           "tokenLimit" = excluded."tokenLimit", "order" = excluded."order"`,
        [
          backend.userId,
          backend.baseUrl,
          backend.keyCiphertext,
          backend.keyLast4,
          backend.models.join(","),
          backend.toolChoice,
          backend.tokenLimit,
          backend.order,
        ],
      )
    },

    deleteOwnBackend: async (userId: string) => {
      await db.query(`DELETE FROM ${t("own_backends")} WHERE "userId" = $1`, [
        userId,
      ])
    },

    /** The provider's tokens spent on a user's own key this calendar month. */
    ownSpent: async (userId: string, now: Date = new Date()) => {
      const period = poolPeriod(now)
      return num(
        (
          await one<Row>(
            `SELECT coalesce(sum("totalTokens"), 0) AS n FROM ${usage}
             WHERE "userId" = $1 AND source = 'own' AND "createdAt" >= $2`,
            [userId, period.start],
          )
        )?.n,
      )
    },

    /** True for the one call that claimed telling the user their key reached its limit. */
    claimOwnLimitNotice: async (userId: string, now: Date = new Date()) =>
      (
        await db.query(
          `UPDATE ${t("own_backends")} SET "limitNotifiedFor" = $2
           WHERE "userId" = $1 AND "limitNotifiedFor" IS DISTINCT FROM $2 RETURNING "userId"`,
          [userId, poolPeriod(now).start],
        )
      ).length > 0,

    // --- buying -------------------------------------------------------------------------

    salePriceNow: async (currency: string) => {
      const row = await one<Row>(
        `SELECT * FROM ${t("sale_price_at")}($1, now()) WHERE currency IS NOT NULL`,
        [currency],
      )
      return row
        ? {
            currency: String(row.currency),
            centsPerMillion: num(row.centsPerMillion),
            effectiveFrom: String(iso(row.effectiveFrom)),
          }
        : undefined
    },

    salePrices: async () =>
      (
        await db.query<Row>(
          `SELECT * FROM ${t("sale_prices")} ORDER BY "effectiveFrom" DESC`,
        )
      ).map((row) => ({
        currency: String(row.currency),
        centsPerMillion: num(row.centsPerMillion),
        effectiveFrom: String(iso(row.effectiveFrom)),
      })),

    addSalePrice: async (currency: string, centsPerMillion: number) => {
      await db.query(
        `INSERT INTO ${t("sale_prices")} (currency, "centsPerMillion") VALUES ($1, $2)`,
        [currency, centsPerMillion],
      )
    },

    purchaseOpen: async (
      userId: string,
      currency: string,
      amountCents: number,
    ) =>
      purchaseOf(
        (await one<Row>(`SELECT * FROM ${t("purchase_open")}($1, $2, $3)`, [
          userId,
          currency,
          amountCents,
        ])) as Row,
      ),

    /** The refill claimed, or undefined when none is due. */
    refillClaim: async (userId: string) => {
      const row = await one<Row>(`SELECT * FROM ${t("refill_claim")}($1)`, [
        userId,
      ])
      return row ? purchaseOf(row) : undefined
    },

    /** True when this call was the one that credited the purchase. */
    credit: async (credit: {
      eventId: string
      eventType: string
      purchaseId: number
      userId: string
      credits: number
      stripeId?: string | null
      taxCents?: number | null
      totalCents?: number | null
    }) =>
      (
        await db.query(
          `SELECT * FROM ${t("credit")}($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            credit.eventId,
            credit.eventType,
            credit.purchaseId,
            credit.userId,
            credit.credits,
            credit.stripeId ?? null,
            credit.taxCents ?? null,
            credit.totalCents ?? null,
          ],
        )
      ).length > 0,

    /** The settings row when this call turned auto-refill off, so the user is told once. */
    refillFailed: async (
      purchaseId: number,
      stripeId: string | null,
      reason: string,
    ) => {
      const row = await one<Row>(
        `SELECT * FROM ${t("refill_failed")}($1, $2, $3)`,
        [purchaseId, stripeId, reason],
      )
      return row ? autorefillOf(row) : undefined
    },

    setPurchaseStripe: async (
      id: number,
      fields: {
        stripeId?: string | null
        taxCents?: number | null
        totalCents?: number | null
      },
    ) => {
      await db.query(
        `UPDATE ${t("purchases")} SET "stripeId" = coalesce($2, "stripeId"),
           "taxCents" = coalesce($3, "taxCents"), "totalCents" = coalesce($4, "totalCents")
         WHERE id = $1`,
        [
          id,
          fields.stripeId ?? null,
          fields.taxCents ?? null,
          fields.totalCents ?? null,
        ],
      )
    },

    purchases: async (userId: string, limit = 50) =>
      (
        await db.query<Row>(
          `SELECT * FROM ${t("purchases")} WHERE "userId" = $1
           ORDER BY "createdAt" DESC, id DESC LIMIT $2`,
          [userId, limit],
        )
      ).map(purchaseOf),

    autorefill: async (userId: string) => {
      const row = await one<Row>(
        `SELECT * FROM ${t("autorefill")} WHERE "userId" = $1`,
        [userId],
      )
      return row ? autorefillOf(row) : undefined
    },

    saveCustomer: async (userId: string, customerId: string) => {
      await db.query(
        `INSERT INTO ${t("autorefill")} ("userId", "stripeCustomerId") VALUES ($1, $2)
         ON CONFLICT ("userId") DO UPDATE SET "stripeCustomerId" = excluded."stripeCustomerId"`,
        [userId, customerId],
      )
    },

    saveCard: async (
      userId: string,
      customerId: string,
      paymentMethodId: string,
      label: string | null,
    ) => {
      await db.query(
        `INSERT INTO ${t("autorefill")}
           ("userId", "stripeCustomerId", "paymentMethodId", "paymentMethodLabel", "failedAt")
         VALUES ($1, $2, $3, $4, NULL)
         ON CONFLICT ("userId") DO UPDATE SET "stripeCustomerId" = excluded."stripeCustomerId",
           "paymentMethodId" = excluded."paymentMethodId",
           "paymentMethodLabel" = excluded."paymentMethodLabel", "failedAt" = NULL`,
        [userId, customerId, paymentMethodId, label],
      )
    },

    saveAutorefill: async (
      userId: string,
      settings: {
        enabled: boolean
        thresholdCredits: number
        amountCents: number
        currency: string
        monthlyMaxCents: number
      },
    ) => {
      // Turning it on clears a failure; leaving it off keeps the record of one.
      await db.query(
        `INSERT INTO ${t("autorefill")}
           ("userId", enabled, "thresholdCredits", "amountCents", currency, "monthlyMaxCents")
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT ("userId") DO UPDATE SET enabled = excluded.enabled,
           "thresholdCredits" = excluded."thresholdCredits", "amountCents" = excluded."amountCents",
           currency = excluded.currency, "monthlyMaxCents" = excluded."monthlyMaxCents",
           "failedAt" = CASE WHEN excluded.enabled THEN NULL ELSE ${t("autorefill")}."failedAt" END`,
        [
          userId,
          settings.enabled,
          settings.thresholdCredits,
          settings.amountCents,
          settings.currency,
          settings.monthlyMaxCents,
        ],
      )
    },

    // --- price proposals ------------------------------------------------------------------

    pendingProposals: async () =>
      (
        await db.query<Row>(
          `SELECT * FROM ${t("price_proposals")} WHERE status = 'pending' ORDER BY model`,
        )
      ).map((row) => ({
        id: num(row.id),
        model: String(row.model),
        kinds: (row.kinds as KindPrice[]).map((kind) => ({
          ...kind,
          usdPerMillion: num(kind.usdPerMillion),
        })),
        longPromptUnits: nullableNum(row.longPromptUnits),
        longPromptFactor: nullableNum(row.longPromptFactor),
        factors: row.factors as {
          dimension: string
          value: string
          factor: number
        }[],
        sources: row.sources as string[],
        problems: row.problems as string[],
        proposedAt: String(iso(row.proposedAt)),
      })),

    /** A new proposal for a model, replacing any still pending. */
    propose: async (proposal: {
      model: string
      kinds: readonly KindPrice[]
      longPromptUnits?: number | null
      longPromptFactor?: number | null
      factors?: readonly { dimension: string; value: string; factor: number }[]
      sources: readonly string[]
      problems: readonly string[]
    }) => {
      await db.query(
        `WITH replaced AS (
           UPDATE ${t("price_proposals")} SET status = 'replaced', "decidedAt" = now()
           WHERE model = $1 AND status = 'pending' RETURNING id
         )
         INSERT INTO ${t("price_proposals")}
           (model, kinds, "longPromptUnits", "longPromptFactor", factors, sources, problems)
         SELECT $1, $2::jsonb, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb
         FROM (SELECT count(*) FROM replaced) r`,
        [
          proposal.model,
          JSON.stringify(proposal.kinds),
          proposal.longPromptUnits ?? null,
          proposal.longPromptFactor ?? null,
          JSON.stringify(proposal.factors ?? []),
          JSON.stringify(proposal.sources),
          JSON.stringify(proposal.problems),
        ],
      )
    },

    /** Applies a pending proposal from now; false when it was no longer pending. */
    decideProposal: async (id: number, apply: boolean) =>
      apply
        ? (await db.query(`SELECT * FROM ${t("apply_proposal")}($1)`, [id]))
            .length > 0
        : (
            await db.query(
              `UPDATE ${t("price_proposals")} SET status = 'dismissed', "decidedAt" = now()
               WHERE id = $1 AND status = 'pending' RETURNING id`,
              [id],
            )
          ).length > 0,

    /** Marks a price as confirmed by a sync, now. */
    confirmPrice: async (priceId: number) => {
      await db.query(
        `UPDATE ${t("model_prices")} SET "syncedAt" = now() WHERE id = $1`,
        [priceId],
      )
    },
  }
}

export type CreditStore = ReturnType<typeof createStore>
