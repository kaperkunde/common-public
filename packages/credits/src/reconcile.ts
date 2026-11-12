/**
 * Checking the ledger against what the provider says the deployment's calls really cost.
 *
 * A provider's cost report (read by the app with its own admin key; the shape is the
 * provider's) is turned into `ProviderCost`s per stretch and model, by price kind. The ledger's
 * rows are priced the same way at the prices in force when each call was made (`ledgerCosts`),
 * the two sides set beside each other (`reconcile`, written to `{{prefix}}cost_reconciliations`),
 * and a model whose trailing day drifts past a threshold is named (`driftAlerts`). The month's
 * figures feed the free pool's drift factor (`driftFactorOf` in pool.ts). Nothing here changes a
 * price. Pure.
 */

import {
  priceInForce,
  pricedCall,
  type CallUsage,
  type KindFallback,
  type ModelPrice,
  type PriceFactor,
} from "./pricing"

/** US cents by price kind. */
export type ByKind = Record<string, number>

/** One stretch of one model, as a provider's report says it. */
export type ProviderCost = {
  periodStart: string
  periodEnd: string
  model: string
  cents: number
  byKind: ByKind
}

/** A report read: its stretches, and how far the provider had brought it up, where it says. */
export type ProviderReport = {
  report: string
  costs: ProviderCost[]
  /** Every stretch ending by then is complete; absent means the report is always complete. */
  refreshedAt?: string
}

/** A ledger row as the check reads it. */
export type LedgerRow = CallUsage & {
  model: string
  createdAt: string
  credits?: number | null
}

/** The ledger's side of one stretch and one model. */
export type LedgerCost = ProviderCost & { calls: number; credits: number }

/** The stretch a moment falls in: the hour, or the UTC day. */
export const periodOf = (at: string, width: "hour" | "day") => {
  const time = new Date(at)
  const start =
    width === "hour"
      ? Date.UTC(
          time.getUTCFullYear(),
          time.getUTCMonth(),
          time.getUTCDate(),
          time.getUTCHours(),
        )
      : Date.UTC(time.getUTCFullYear(), time.getUTCMonth(), time.getUTCDate())
  const end = start + (width === "hour" ? 3600 : 86400) * 1000
  return {
    periodStart: new Date(start).toISOString(),
    periodEnd: new Date(end).toISOString(),
  }
}

/** The ledger's rows priced at the prices in force when each was made, per stretch and model. */
export const ledgerCosts = (
  rows: readonly LedgerRow[],
  prices: readonly ModelPrice[],
  factors: readonly PriceFactor[],
  width: "hour" | "day",
  fallbacks?: readonly KindFallback[],
) => {
  const into = new Map<string, LedgerCost>()
  rows.forEach((row) => {
    const at = new Date(row.createdAt)
    const { periodStart, periodEnd } = periodOf(row.createdAt, width)
    const key = `${periodStart}|${row.model}`
    const cost = into.get(key) ?? {
      periodStart,
      periodEnd,
      model: row.model,
      cents: 0,
      byKind: {},
      calls: 0,
      credits: 0,
    }
    cost.calls += 1
    cost.credits += Number(row.credits ?? 0)
    const price = priceInForce(prices, row.model, at)
    if (price) {
      const usd = pricedCall(row, price, { factors, fallbacks, at })
      Object.entries(usd.byKind).forEach(([kind, dollars]) => {
        cost.byKind[kind] = (cost.byKind[kind] ?? 0) + dollars * 100
      })
      cost.cents += usd.total * 100
    }
    into.set(key, cost)
  })
  return Array.from(into.values())
}

/** Signed drift: how far the provider's figure is from the ledger's, over the larger of them. */
export const driftOf = (provider: number, ledger: number) => {
  const larger = Math.max(Math.abs(provider), Math.abs(ledger))
  return larger > 0 ? (provider - ledger) / larger : null
}

/** One stretch for one model, both sides, as `{{prefix}}cost_reconciliations` keeps it. */
export type Reconciliation = {
  periodStart: string
  periodEnd: string
  model: string
  report: string
  complete: boolean
  providerCents: number
  ledgerCents: number
  providerByKind: ByKind
  ledgerByKind: ByKind
  drift: number | null
  ledgerCalls: number
  ledgerCredits: number
}

/**
 * Both sides of every stretch either knows. `billed` says which of the ledger's models the
 * report would bill at all (another provider's never appear in it).
 */
export const reconcile = (
  report: ProviderReport,
  ledger: readonly LedgerCost[],
  billed: (model: string) => boolean = () => true,
) => {
  const keys = new Map<
    string,
    { periodStart: string; periodEnd: string; model: string }
  >()
  report.costs.forEach((cost) =>
    keys.set(`${cost.periodStart}|${cost.model}`, cost),
  )
  ledger
    .filter((cost) => billed(cost.model))
    .forEach((cost) => keys.set(`${cost.periodStart}|${cost.model}`, cost))
  return Array.from(keys.entries())
    .map(([key, at]): Reconciliation => {
      const provider = report.costs.find(
        (cost) => `${cost.periodStart}|${cost.model}` === key,
      )
      const ours = ledger.find(
        (cost) => `${cost.periodStart}|${cost.model}` === key,
      )
      const providerCents = provider?.cents ?? 0
      const ledgerCents = ours?.cents ?? 0
      return {
        periodStart: at.periodStart,
        periodEnd: at.periodEnd,
        model: at.model,
        report: report.report,
        complete:
          report.refreshedAt === undefined ||
          report.refreshedAt >= at.periodEnd,
        providerCents,
        ledgerCents,
        providerByKind: provider?.byKind ?? {},
        ledgerByKind: ours?.byKind ?? {},
        drift: driftOf(providerCents, ledgerCents),
        ledgerCalls: ours?.calls ?? 0,
        ledgerCredits: ours?.credits ?? 0,
      }
    })
    .sort(
      (a, b) =>
        a.periodStart.localeCompare(b.periodStart) ||
        a.model.localeCompare(b.model),
    )
}

/** How far apart the two may drift, over a day, before the admin is told. */
export const DRIFT_THRESHOLD = 0.01
/** Below this many cents on both sides over a day, drift is rounding. */
export const DRIFT_MIN_CENTS = 25

export type DriftAlert = {
  model: string
  from: string
  to: string
  providerCents: number
  ledgerCents: number
  drift: number
  /** The price kind furthest apart, where one is. */
  worstKind?: string
}

/** Each model whose complete stretches over the trailing day drift past the threshold. */
export const driftAlerts = (
  rows: readonly Reconciliation[],
  now: Date = new Date(),
) => {
  const since = new Date(now.getTime() - 24 * 3600 * 1000).toISOString()
  const byModel = new Map<string, Reconciliation[]>()
  rows
    .filter((row) => row.complete && row.periodStart >= since)
    .forEach((row) =>
      byModel.set(row.model, [...(byModel.get(row.model) ?? []), row]),
    )
  const alerts: DriftAlert[] = []
  byModel.forEach((stretches, model) => {
    const providerCents = stretches.reduce(
      (sum, row) => sum + row.providerCents,
      0,
    )
    const ledgerCents = stretches.reduce((sum, row) => sum + row.ledgerCents, 0)
    const drift = driftOf(providerCents, ledgerCents)
    if (drift === null || Math.abs(drift) <= DRIFT_THRESHOLD) return
    if (Math.max(providerCents, ledgerCents) < DRIFT_MIN_CENTS) return
    const kinds = new Set(
      stretches.flatMap((row) => [
        ...Object.keys(row.providerByKind),
        ...Object.keys(row.ledgerByKind),
      ]),
    )
    const apart = Array.from(kinds)
      .map((kind) => ({
        kind,
        gap: Math.abs(
          stretches.reduce(
            (sum, row) =>
              sum +
              (row.providerByKind[kind] ?? 0) -
              (row.ledgerByKind[kind] ?? 0),
            0,
          ),
        ),
      }))
      .sort((a, b) => b.gap - a.gap)[0]
    alerts.push({
      model,
      from: stretches[0]?.periodStart ?? since,
      to: stretches.at(-1)?.periodEnd ?? now.toISOString(),
      providerCents,
      ledgerCents,
      drift,
      ...(apart && apart.gap > 0 ? { worstKind: apart.kind } : {}),
    })
  })
  return alerts.sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift))
}

/** One alert in a sentence, for the admin. */
export const driftText = (alert: DriftAlert, provider = "The provider") => {
  const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`
  const percent = `${(alert.drift * 100).toFixed(1)}%`
  const way = alert.drift > 0 ? "more than" : "less than"
  return (
    `${alert.model}: ${provider} billed ${dollars(alert.providerCents)} over the last day, ${percent} ${way} the ${dollars(alert.ledgerCents)} the ledger's calls come to at the prices set` +
    `${alert.worstKind ? `, furthest apart on ${alert.worstKind}` : ""}.`
  )
}
