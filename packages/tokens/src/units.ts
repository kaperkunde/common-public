import type {
  AppUnit,
  Cents,
  Currency,
  Micros,
  Purchase,
  SalePrice,
} from "./types"

/** Micro-dollars per dollar: the contract's money unit. */
export const MICROS_PER_DOLLAR = 1_000_000

/**
 * How many of an app's display unit `micros` is. With `perDollar` 1,000,000
 * (an app whose unit is 1,000,000 per dollar) one unit is one micro-dollar.
 * Rounded toward zero so a balance is never overstated.
 */
export function unitsOf(
  micros: Micros,
  unit: Pick<AppUnit, "perDollar"> | number,
): number {
  const perDollar = typeof unit === "number" ? unit : unit.perDollar
  return Math.trunc((micros * perDollar) / MICROS_PER_DOLLAR)
}

/** The other way: how many micros `units` of the app's unit are. */
export function microsOf(
  units: number,
  unit: Pick<AppUnit, "perDollar"> | number,
): Micros {
  const perDollar = typeof unit === "number" ? unit : unit.perDollar
  return Math.round((units * MICROS_PER_DOLLAR) / perDollar)
}

/** Dollars as a float, for display only (never for balances). */
export const microsToUsd = (micros: Micros): number =>
  micros / MICROS_PER_DOLLAR

const SUFFIXES = [
  { at: 1e12, suffix: "T" },
  { at: 1e9, suffix: "B" },
  { at: 1e6, suffix: "M" },
  { at: 1e3, suffix: "k" },
] as const

/**
 * "84k", "1.2M", "950": a short number for a pill. One decimal below 10 of a
 * suffix ("1.2M"), none above ("12M"); always truncated, so "999,999" is "999k"
 * and a balance is never shown larger than it is. Negative numbers keep their sign.
 */
export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return "0"
  const sign = value < 0 ? "-" : ""
  const abs = Math.abs(Math.trunc(value))
  const step = SUFFIXES.find(({ at }) => abs >= at)
  if (!step) return `${sign}${abs}`
  const scaled = abs / step.at
  const rounded =
    scaled < 10 ? Math.floor(scaled * 10) / 10 : Math.floor(scaled)
  return `${sign}${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}${step.suffix}`
}

export type FormatUnitsOptions = {
  /** "84k credits" instead of "84,000 credits". */
  compact?: boolean
  /** Leave the unit's name off: "84,000". */
  bare?: boolean
  locale?: string
}

/** "8,000,000 credits", "1 credit", "84k tokens": micros in the app's own unit. */
export function formatUnits(
  micros: Micros,
  unit: AppUnit,
  options: FormatUnitsOptions = {},
): string {
  const n = unitsOf(micros, unit)
  const number = options.compact
    ? formatCompact(n)
    : new Intl.NumberFormat(options.locale ?? "en").format(n)
  if (options.bare) return number
  return `${number} ${Math.abs(n) === 1 ? unit.one : unit.many}`
}

/** "€10.00", "$4.50": integer cents in a currency. */
export function formatMoney(
  cents: Cents,
  currency: Currency | string,
  locale = "en",
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100)
}

/**
 * What a purchase of `amountCents` credits, in micros, at a sale price:
 * `floor(cents × 1e6 / centsPerDollar)`, the center's own rule. The center
 * fixes it when the purchase is opened and answers it as `creditMicros`; this
 * is for showing "€10 buys 10,000,000 tokens" before asking.
 */
export function creditFor(
  amountCents: Cents,
  price: Pick<SalePrice, "centsPerDollar">,
): Micros {
  return Math.floor((amountCents * MICROS_PER_DOLLAR) / price.centsPerDollar)
}

/**
 * What a refund of `creditMicros` of a paid purchase gives back, in cents: the center's own rule,
 * `floor(totalCents × (refundedCredit + this) / creditMicros) − refundedCents`, tax included, so
 * parts add up to the whole. For showing "€4.99 back" before asking; the center's answer
 * (`Refund.amountCents`) is the truth.
 */
export function refundCentsFor(
  purchase: Pick<
    Purchase,
    | "amountCents"
    | "totalCents"
    | "creditMicros"
    | "refundedCreditMicros"
    | "refundedCents"
  >,
  creditMicros: Micros,
): Cents {
  if (!(purchase.creditMicros > 0) || !(creditMicros > 0)) return 0
  const paid = purchase.totalCents ?? purchase.amountCents
  const before = purchase.refundedCreditMicros ?? 0
  const sofar = purchase.refundedCents ?? 0
  // BigInt: cents × micros passes 2^53 for a large purchase.
  const whole =
    (BigInt(paid) * BigInt(before + creditMicros)) /
    BigInt(purchase.creditMicros)
  return Math.max(0, Number(whole) - sofar)
}
