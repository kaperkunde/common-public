/**
 * A user's credits, as arithmetic and words.
 *
 * Free credits are handed out of the admin's monthly pool when a user has nothing left, and
 * expire at the end of the month that granted them (an overdraft with them); bought or granted
 * credits never expire. The database decides (`{{prefix}}admit`, `{{prefix}}spend`), row-locked;
 * this is the same rule, pure, for the screens.
 */

import { countText, lastDayText, type CreditUnit, DEFAULT_UNIT } from "./units"

export type CreditBalance = {
  /** What is left of the free credits; below zero only by an overdraft. */
  free: number
  /** Bought or granted, never expiring, never below zero. */
  purchased: number
  /** When the free credits held expire: the end of the month that granted them. */
  freeExpiresAt?: string | null
}

/** What is left of the free side now: nothing once it has expired, an overdraft included. */
export const freeNow = (balance: CreditBalance, now: Date = new Date()) =>
  balance.freeExpiresAt &&
  new Date(balance.freeExpiresAt).getTime() <= now.getTime()
    ? 0
    : Number(balance.free)

/** Free and bought together. */
export const creditsLeft = (balance: CreditBalance, now: Date = new Date()) =>
  freeNow(balance, now) + Number(balance.purchased)

/** Whether a call may start on this balance: anything left is enough. */
export const admitted = (balance: CreditBalance, now: Date = new Date()) =>
  creditsLeft(balance, now) > 0

export type DebitSplit = {
  fromFree: number
  fromPurchased: number
  /** What there was nothing left to pay with: an overdraft on the free side. */
  short: number
  /** What the ledger row says it came out of. */
  source: "free" | "purchased"
  after: CreditBalance
}

/**
 * What `{{prefix}}spend` takes from a balance: free first, since it expires, then bought; only
 * when both are gone does free go below zero, by exactly what was missing.
 */
export const debitSplit = (balance: CreditBalance, cost: number): DebitSplit => {
  const fromFree = Math.min(Math.max(balance.free, 0), cost)
  const fromPurchased = Math.min(balance.purchased, cost - fromFree)
  const short = cost - fromFree - fromPurchased
  return {
    fromFree,
    fromPurchased,
    short,
    source: fromPurchased > 0 ? "purchased" : "free",
    after: {
      ...balance,
      free: balance.free - fromFree - short,
      purchased: balance.purchased - fromPurchased,
    },
  }
}

const plural = (count: number, unit: CreditUnit) =>
  Math.abs(count) === 1 ? unit.one : unit.many

/**
 * The balance in a line: "800 free credits and 1,000 bought". An overdraft is said as one,
 * with what becomes of it; free credits past their month are none.
 */
export const balanceText = (
  balance: CreditBalance,
  unit: CreditUnit = DEFAULT_UNIT,
  now: Date = new Date(),
) => {
  const free = freeNow(balance, now)
  const freeText =
    free < 0
      ? `No free ${unit.many} (${countText(-free)} overdrawn, forgiven at the end of the month)`
      : `${countText(free)} free ${plural(free, unit)}`
  return balance.purchased > 0
    ? `${freeText} and ${countText(balance.purchased)} bought`
    : freeText
}

/**
 * What becomes of the free side, in a line: when what is held expires, or that some may become
 * available. Never a date for free credits to come: whether there will be any is the admin's.
 */
export const freeCreditsText = (
  balance: CreditBalance | undefined,
  unit: CreditUnit = DEFAULT_UNIT,
  now: Date = new Date(),
) => {
  if (balance && freeNow(balance, now) > 0 && balance.freeExpiresAt) {
    return `Your free ${unit.many} expire at the end of ${lastDayText(balance.freeExpiresAt)}; unused ones do not roll over.`
  }
  if (balance && !admitted(balance, now)) {
    return `You have run out of ${unit.many}. Some free ${unit.many} may become available; buying ${unit.many} carries on now.`
  }
  return `When you run out, some free ${unit.many} may become available; they expire at the end of the month they are handed out in.`
}

/** What a user is told when a call is refused for want of credits. It names no date. */
export const outOfCreditsMessage = (unit: CreditUnit = DEFAULT_UNIT) =>
  `You have used all of your ${unit.many}. Some free ${unit.many} may become available; ` +
  `you can also buy ${unit.many}, or use a model of your own.`
