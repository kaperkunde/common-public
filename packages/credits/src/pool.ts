/**
 * The free pool, as arithmetic and words.
 *
 * The admin sets a budget in US dollars a calendar month (UTC), and every free credit is handed
 * out of it: `{{prefix}}admit` grants a user who has run out what is left of their allotment for
 * the month, or what is left of the pool when that is less, and takes its dollars out as it does.
 * Free credits expire at the end of the month that granted them. What a call overdraws is real
 * spend nobody granted, and comes out of the pool too. A cost check may write what the provider
 * said the month cost beside the ledger, and the pool counts every dollar at that ratio where the
 * provider bills more -- never less. The database decides, row-locked; this is the same rule,
 * pure, for the screens.
 */

import { DEFAULT_UNIT, dayText, type CreditUnit } from "./units"

const ONE_DAY_MS = 24 * 60 * 60 * 1000

/** A calendar month (UTC), as its first instant and the first instant of the next. */
export type PoolPeriod = { start: string; end: string }

/** The calendar month (UTC) a moment falls in: the pool's period, and the own key's. */
export const poolPeriod = (now: Date = new Date()): PoolPeriod => {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
  return {
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
  }
}

/** What has come out of one month's pool so far (`{{prefix}}pool_periods`). */
export type PoolUse = {
  grantedCredits: number
  grantedUsd: number
  overdraftUsd: number
  /** The provider's figure over the ledger's; one, or more. */
  driftFactor: number
}

/** A month nothing has come out of yet. */
export const EMPTY_USE: PoolUse = {
  grantedCredits: 0,
  grantedUsd: 0,
  overdraftUsd: 0,
  driftFactor: 1,
}

/** The drift factor as the pool reads it: never below one, so the pool only ever tightens. */
export const effectiveDrift = (factor: number | null | undefined) =>
  typeof factor === "number" && Number.isFinite(factor) && factor > 1
    ? factor
    : 1

/** What the month's grants and overdrafts come to against the budget, at the drift factor. */
export const poolCommittedUsd = (use: PoolUse) =>
  (use.grantedUsd + use.overdraftUsd) * effectiveDrift(use.driftFactor)

/** What is left in the pool, in dollars; below zero once a budget was lowered past it. */
export const poolLeftUsd = (budgetUsd: number, use: PoolUse) =>
  budgetUsd - poolCommittedUsd(use)

/**
 * How many free credits a refill would hand one user now -- what `{{prefix}}pool_could_give`
 * answers: what is left of their allotment this month, or what the pool can still pay for at
 * the ratio in force, whichever is less, and never below nothing.
 */
export const grantFor = (input: {
  allotment: number
  /** Free credits this user has been handed this month already. */
  takenThisMonth: number
  budgetUsd: number
  use: PoolUse
  perDollar: number
}) => {
  const room = input.allotment - input.takenThisMonth
  if (room <= 0 || !(input.perDollar > 0)) return 0
  const left = poolLeftUsd(input.budgetUsd, input.use)
  if (left <= 0) return 0
  return Math.max(
    0,
    Math.min(
      room,
      Math.floor(
        (left * input.perDollar) / effectiveDrift(input.use.driftFactor),
      ),
    ),
  )
}

/** The provider's figure over the ledger's, as the pool counts it: one where either says nothing. */
export const driftFactorOf = (
  providerCents: number | null | undefined,
  ledgerCents: number | null | undefined,
) =>
  typeof providerCents === "number" &&
  typeof ledgerCents === "number" &&
  ledgerCents > 0
    ? Math.max(1, providerCents / ledgerCents)
    : 1

/** How many users' whole allotments a month's budget pays for, at the ratio in force. */
export const allotmentsCovered = (
  budgetUsd: number,
  allotment: number,
  perDollar: number,
) =>
  allotment > 0 && perDollar > 0
    ? Math.floor((budgetUsd * perDollar) / allotment)
    : 0

/** Where the pool stands: anything left, four-fifths or more gone, or nothing left. */
export type PoolLevel = "none" | "ok" | "low" | "empty"

/** The share of the budget that counts as low: past it, the admin is told once a month. */
export const LOW_SHARE = 0.8

export const poolLevel = (budgetUsd: number, use: PoolUse): PoolLevel => {
  if (budgetUsd <= 0) return "none"
  const committed = poolCommittedUsd(use)
  if (committed >= budgetUsd) return "empty"
  if (committed >= budgetUsd * LOW_SHARE) return "low"
  return "ok"
}

/**
 * When the pool runs out at the pace it has gone so far this month, or undefined where it lasts
 * the month (or nothing has gone yet, so there is no pace to go by). A straight line: what has
 * come out, over the time since the month began, carried on.
 */
export const poolForecast = (
  budgetUsd: number,
  use: PoolUse,
  period: PoolPeriod,
  now: Date = new Date(),
): string | undefined => {
  const committed = poolCommittedUsd(use)
  if (budgetUsd <= 0 || committed <= 0) return undefined
  const start = new Date(period.start).getTime()
  const end = new Date(period.end).getTime()
  if (committed >= budgetUsd) return now.toISOString()
  const elapsed = Math.max(now.getTime() - start, 60 * 60 * 1000)
  const runsOut = start + (elapsed * budgetUsd) / committed
  return runsOut < end ? new Date(runsOut).toISOString() : undefined
}

/**
 * Whether the provider's whole bill for the deployment's key this month has passed what the
 * budget and bought credits between them pay for. Shown and told, never a brake.
 */
export const overBudget = (input: {
  providerUsd: number | null | undefined
  budgetUsd: number
  boughtUsd: number
}) =>
  typeof input.providerUsd === "number" &&
  input.providerUsd > input.budgetUsd + input.boughtUsd

/** "$12.50", "$0.004": dollars as the admin reads them, small amounts kept readable. */
export const dollarsText = (usd: number) => {
  const value = Math.abs(usd)
  const digits = value > 0 && value < 0.01 ? 4 : 2
  const text = value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
  return `${usd < 0 ? "-" : ""}$${text}`
}

/** The month a period is, "November 2026". */
export const monthText = (period: PoolPeriod) =>
  new Date(period.start).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })

/** What the admin screen says when no budget is set. */
export const noBudgetText = (unit: CreditUnit = DEFAULT_UNIT) =>
  `No free-${unit.one} budget set: users get no free ${unit.many}.`

/** The pool in a line, for the admin. */
export const poolLevelText = (
  budgetUsd: number | undefined,
  use: PoolUse,
  unit: CreditUnit = DEFAULT_UNIT,
) => {
  if (budgetUsd === undefined) return noBudgetText(unit)
  const left = poolLeftUsd(budgetUsd, use)
  switch (poolLevel(budgetUsd, use)) {
    case "none":
      return `The budget is nothing: users get no free ${unit.many}.`
    case "empty":
      return `The pool is empty: users who run out get no free ${unit.many} until next month, or until you raise the budget.`
    case "low":
      return `${dollarsText(left)} left: four-fifths of this month's pool is gone.`
    default:
      return `${dollarsText(left)} left this month.`
  }
}

/** The forecast in words, for the admin. */
export const forecastText = (
  budgetUsd: number,
  use: PoolUse,
  period: PoolPeriod,
  now: Date = new Date(),
) => {
  if (budgetUsd <= 0) return undefined
  if (poolCommittedUsd(use) <= 0) return "Nothing handed out yet this month."
  const runsOut = poolForecast(budgetUsd, use, period, now)
  if (!runsOut) return "At this pace it lasts the month."
  if (poolLevel(budgetUsd, use) === "empty") return undefined
  return `At this pace it runs out around ${dayText(runsOut)}.`
}

/** What the admin is told when the pool reaches a level, once a month each. */
export const poolNoticeText = (
  level: "low" | "empty",
  period: PoolPeriod,
  budgetUsd: number,
  unit: CreditUnit = DEFAULT_UNIT,
) =>
  level === "empty"
    ? `The free-${unit.one} pool for ${monthText(period)} (${dollarsText(budgetUsd)}) is empty. Users who run out get no free ${unit.many} until next month, or until you raise the budget.`
    : `Four-fifths of the free-${unit.one} pool for ${monthText(period)} (${dollarsText(budgetUsd)}) is gone.`

/** What the admin is told when the provider's whole bill passes the budget and what was bought. */
export const overBudgetText = (
  period: PoolPeriod,
  providerUsd: number,
  budgetUsd: number,
  boughtUsd: number,
  unit: CreditUnit = DEFAULT_UNIT,
) =>
  `The provider's bill for this deployment's key in ${monthText(period)} is ${dollarsText(providerUsd)}, more than the free-${unit.one} budget (${dollarsText(budgetUsd)}) and what bought ${unit.many} paid for (${dollarsText(boughtUsd)}) together. Nothing was stopped; this is for you to look at.`

/** How long until something, for the drift check's lag: "3 hours ago". */
export const agoText = (iso: string, now: Date = new Date()) => {
  const ms = now.getTime() - new Date(iso).getTime()
  if (ms < 60 * 60 * 1000) return "within the hour"
  if (ms < ONE_DAY_MS) {
    const hours = Math.floor(ms / (60 * 60 * 1000))
    return `${hours} ${hours === 1 ? "hour" : "hours"} ago`
  }
  const days = Math.floor(ms / ONE_DAY_MS)
  return `${days} ${days === 1 ? "day" : "days"} ago`
}
