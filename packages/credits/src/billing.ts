/**
 * Buying credits, as arithmetic and words.
 *
 * The admin sets what a million credits cost per currency, as a history. A user pays at least
 * the minimum; what an amount buys is worked out from the price in force when they asked,
 * rounded down, and written on the purchase. The database decides (`{{prefix}}purchase_open`,
 * `{{prefix}}refill_claim`); this is the same rule, pure, for the screens.
 */

import { freeNow, type CreditBalance } from "./balance"
import { DEFAULT_UNIT, type CreditUnit } from "./units"

/**
 * Currencies Stripe does not count in hundredths: zero-decimal (an amount is whole yen) and
 * three-decimal (thousandths). Everything here counts in cents -- what an amount is typed as,
 * how it is said, what Stripe is sent as `unit_amount` -- so neither kind is sold in. ISK is
 * here too: Stripe takes it as two-decimal but only in whole krónur.
 */
export const UNSUPPORTED_CURRENCIES: readonly string[] = [
  // zero-decimal
  "bif",
  "clp",
  "djf",
  "gnf",
  "isk",
  "jpy",
  "kmf",
  "krw",
  "mga",
  "pyg",
  "rwf",
  "ugx",
  "vnd",
  "vuv",
  "xaf",
  "xof",
  "xpf",
  // three-decimal
  "bhd",
  "jod",
  "kwd",
  "omr",
  "tnd",
]

/**
 * A currency credits may be sold in: three lower-case letters as Stripe names it, counted in
 * hundredths (cents). `{{prefix}}two_decimal_currency` is the same rule in the database.
 */
export const isCurrency = (raw: unknown): raw is string =>
  typeof raw === "string" &&
  /^[a-z]{3}$/.test(raw) &&
  !UNSUPPORTED_CURRENCIES.includes(raw)

/** Whether tax is inside a currency's price or added on top at checkout. */
export type TaxBehavior = "inclusive" | "exclusive"

/** The currencies an app sells in, and how each is taxed. */
export type Currencies = Readonly<Record<string, TaxBehavior>>

/** The smallest purchase, in cents, unless an app says otherwise (and its migration agrees). */
export const MIN_PURCHASE_CENTS = 500

/** The largest at once: a typing mistake long before it is a purchase. */
export const MAX_PURCHASE_CENTS = 100000

export type SalePrice = {
  currency: string
  /** The price of a million credits, in cents. */
  centsPerMillion: number
  effectiveFrom: string
}

/** The sale price in force for a currency at a moment: the newest that had begun. */
export const salePriceInForce = (
  prices: readonly SalePrice[],
  currency: string,
  at: Date = new Date(),
) =>
  prices
    .filter(
      (price) =>
        price.currency === currency &&
        new Date(price.effectiveFrom).getTime() <= at.getTime(),
    )
    .reduce<SalePrice | undefined>(
      (newest, price) =>
        !newest ||
        new Date(price.effectiveFrom).getTime() >
          new Date(newest.effectiveFrom).getTime()
          ? price
          : newest,
      undefined,
    )

/** What an amount buys at a price, rounded down: `{{prefix}}credits_for`. */
export const creditsFor = (amountCents: number, centsPerMillion: number) =>
  centsPerMillion > 0
    ? Math.floor((amountCents * 1000000) / centsPerMillion)
    : 0

/** An amount as typed, in cents: "5", "5.50", "5,50", "€ 12"; undefined if not money at all. */
export const parseAmount = (raw: unknown) => {
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw >= 0 ? Math.round(raw * 100) : undefined
  }
  if (typeof raw !== "string") return undefined
  const text = raw
    .trim()
    .replace(/^[€$£]\s*/, "")
    .replace(",", ".")
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return undefined
  return Math.round(Number(text) * 100)
}

/** Money as a reader reads it: "€5.00", "$12.50". */
export const moneyText = (cents: number, currency: string) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100)

/** What is wrong with an amount, in words, or undefined when it is fine. */
export const amountProblem = (
  cents: number | undefined,
  currency: string,
  limits: { minCents?: number; maxCents?: number } = {},
) => {
  const min = limits.minCents ?? MIN_PURCHASE_CENTS
  const max = limits.maxCents ?? MAX_PURCHASE_CENTS
  if (cents === undefined || !Number.isSafeInteger(cents)) {
    return "An amount is a number, like 5 or 12.50."
  }
  if (cents < min) return `The smallest amount is ${moneyText(min, currency)}.`
  if (cents > max) {
    return `The largest amount at once is ${moneyText(max, currency)}.`
  }
  return undefined
}

/** How the tax on a price is said beside it. */
export const taxText = (behavior: TaxBehavior) =>
  behavior === "inclusive"
    ? "Tax included"
    : "Tax, where it applies, is added at checkout"

/** The start of the calendar month (UTC) a moment is in, which the monthly maximum counts from. */
export const monthStart = (now: Date = new Date()) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()

export type AutorefillSettings = {
  enabled: boolean
  hasCard: boolean
  /** A refill already claimed and not yet credited or failed. */
  pending: boolean
  thresholdCredits: number
  amountCents: number
  monthlyMaxCents: number
}

export type RefillDecision =
  | { charge: true }
  | {
      charge: false
      reason:
        | "off"
        | "no card"
        | "pending"
        | "free left"
        | "above threshold"
        | "monthly maximum"
    }

/**
 * Whether a spend has left a user needing a refill -- `{{prefix}}refill_claim`'s rule: on, with
 * a card, nothing in flight; the free credits gone or expired; the bought ones below the
 * threshold; and one more refill keeping this month within the maximum.
 */
export const refillDecision = (
  settings: AutorefillSettings,
  balance: CreditBalance,
  spentThisMonthCents: number,
  now: Date = new Date(),
): RefillDecision => {
  if (!settings.enabled) return { charge: false, reason: "off" }
  if (!settings.hasCard) return { charge: false, reason: "no card" }
  if (settings.pending) return { charge: false, reason: "pending" }
  if (freeNow(balance, now) > 0) return { charge: false, reason: "free left" }
  if (balance.purchased >= settings.thresholdCredits)
    return { charge: false, reason: "above threshold" }
  if (spentThisMonthCents + settings.amountCents > settings.monthlyMaxCents) {
    return { charge: false, reason: "monthly maximum" }
  }
  return { charge: true }
}

/** What is wrong with a set of auto-refill settings, in words, or undefined. */
export const autorefillProblem = (
  settings: {
    currency: string
    thresholdCredits: number | undefined
    amountCents: number | undefined
    monthlyMaxCents: number | undefined
  },
  unit: CreditUnit = DEFAULT_UNIT,
  limits: { minCents?: number; maxCents?: number } = {},
) => {
  const { thresholdCredits, amountCents, monthlyMaxCents } = settings
  // Zero would never be crossed: what is bought never goes below it.
  if (
    thresholdCredits === undefined ||
    !Number.isSafeInteger(thresholdCredits) ||
    thresholdCredits < 1
  ) {
    return `The threshold is a whole number of ${unit.many}, one or more.`
  }
  const amount = amountProblem(amountCents, settings.currency, limits)
  if (amount) return `Each refill: ${amount}`
  if (monthlyMaxCents === undefined || !Number.isSafeInteger(monthlyMaxCents)) {
    return "The monthly maximum is an amount of money, like 20."
  }
  if (monthlyMaxCents < (amountCents ?? 0)) {
    return "The monthly maximum has to cover at least one refill."
  }
  return undefined
}

/** How long a Checkout Session stays open: a purchase still pending past it was never paid. */
export const CHECKOUT_OPEN_MS = 24 * 60 * 60 * 1000

/** A purchase's state, as its line in the billing history says it. */
export const purchaseStatusText = (
  purchase: {
    status: string
    failure?: string | null
    kind?: string
    createdAt?: string
  },
  now: Date = new Date(),
) => {
  switch (purchase.status) {
    case "paid":
      return "paid"
    case "pending":
      return purchase.kind === "purchase" &&
        purchase.createdAt &&
        now.getTime() - new Date(purchase.createdAt).getTime() >
          CHECKOUT_OPEN_MS
        ? "not completed"
        : "waiting for Stripe"
    case "failed":
      return purchase.failure ? `failed: ${purchase.failure}` : "failed"
    case "abandoned":
      return "not charged"
    default:
      return purchase.status
  }
}

/**
 * Why a refill could not be charged, as a kind of our own: the user is told in the package's
 * words, never in Stripe's (which name processors, codes and internals). `stripeFailure` keeps
 * Stripe's own words for the logs.
 */
export type RefillFailure =
  | "declined"
  | "insufficient_funds"
  | "expired_card"
  | "authentication_required"
  | "no_card"
  | "error"

/** Each failure in words a user reads, beside the purchase and in the notice. */
export const REFILL_FAILURE_TEXT: Readonly<Record<RefillFailure, string>> = {
  declined: "the card was declined",
  insufficient_funds: "the card has insufficient funds",
  expired_card: "the card has expired",
  authentication_required:
    "the bank asked to confirm the payment, which needs you there",
  no_card: "there is no saved card to charge",
  error: "the payment could not be made",
}

/** What a user is told when a refill could not be charged. Once, since it turns itself off. */
export const refillFailedMessage = (
  amountCents: number,
  currency: string,
  failure: RefillFailure,
  unit: CreditUnit = DEFAULT_UNIT,
) =>
  `The automatic refill of ${moneyText(amountCents, currency)} could not be charged (${REFILL_FAILURE_TEXT[failure] ?? REFILL_FAILURE_TEXT.error}), ` +
  `so auto-refill is now off and nothing more will be charged. Your ${unit.many} are unaffected. ` +
  "Save a card that works and turn auto-refill on again."
