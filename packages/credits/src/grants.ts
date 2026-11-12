/**
 * The admin granting a user credits, or taking some back: who a grant is for as the admin typed
 * it, the amount, what it leaves, and how the user is told. `{{prefix}}grant` decides, row-locked;
 * this is the same rule for a screen to say before anything is sent. Pure.
 */

import { DEFAULT_UNIT, countText, creditsText, type CreditUnit } from "./units"

/** How many of the latest grants an admin screen lists. */
export const GRANT_LIST_LIMIT = 50

/** Who a grant is for: an address to look up, or a display name. */
export type GrantWho = { email: string } | { name: string }

const normalizeEmail = (value: string) => value.trim().toLowerCase()
const isEmailAddress = (value: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)

/**
 * Who the admin meant: an address when it reads as one, otherwise a display name, and nothing
 * for an empty field. A name may hold an "@" of its own, so it is only an address when it is
 * shaped like one.
 */
export const whoOf = (text: string): GrantWho | undefined => {
  const trimmed = text.trim()
  if (trimmed === "") return undefined
  const email = normalizeEmail(trimmed)
  return isEmailAddress(email) ? { email } : { name: trimmed }
}

/** Whoever could not be found, as a refusal names them. */
export const whoText = (who: GrantWho) => ("email" in who ? who.email : who.name)

/**
 * An amount as typed: a whole number above or below zero, thousands separated however the admin
 * likes ("1,200", "1 200", "-5_000"), a typographic minus taken for one. Undefined for zero, a
 * fraction, or anything that is not a number.
 */
export const parseGrantAmount = (input: string | number): number | undefined => {
  const text =
    typeof input === "number"
      ? String(input)
      : input
          .trim()
          .replace(/[\s,_]/g, "")
          .replace(/^[−–]/, "-")
  if (!/^[+-]?\d+$/.test(text)) return undefined
  const amount = Number(text)
  return Number.isSafeInteger(amount) && amount !== 0 ? amount : undefined
}

/**
 * What a user's bought credits come to after a grant, or undefined for a correction that would
 * take them below nothing -- which the database refuses rather than clipping.
 */
export const grantAfter = (purchased: number, amount: number) => {
  const after = purchased + amount
  return after < 0 ? undefined : after
}

/** Whether a grant takes credits back rather than giving them. */
export const isCorrection = (amount: number) => amount < 0

/** The line a user reads in their history: "Granted by the admin: a playtest". */
export const grantLine = (amount: number, reason: string) =>
  `${isCorrection(amount) ? "Corrected" : "Granted"} by the admin: ${reason.trim()}`

/** The amount with its sign: "+1,200 credits", "-5,000 credits". */
export const signedCreditsText = (amount: number, unit: CreditUnit = DEFAULT_UNIT) =>
  amount > 0 ? `+${creditsText(amount, unit)}` : creditsText(amount, unit)

/** What the form would send, or the first thing in the way of it, in words. */
export const grantProblem = (
  form: { who: string; amount: string; reason: string },
  unit: CreditUnit = DEFAULT_UNIT,
) => {
  if (!whoOf(form.who)) {
    return "Say who it is for: a display name or an email address."
  }
  if (parseGrantAmount(form.amount) === undefined) {
    return `An amount is a whole number of ${unit.many}, above zero to grant or below it to correct.`
  }
  if (form.reason.trim() === "") {
    return "A grant needs a reason, which the user reads beside it."
  }
  return undefined
}

/** A balance found, in a line: "Ash has 1,200 bought credits and 300 free." */
export const balanceLine = (
  name: string,
  balance: { free: number; purchased: number },
  unit: CreditUnit = DEFAULT_UNIT,
) =>
  `${name} has ${countText(balance.purchased)} bought ${balance.purchased === 1 ? unit.one : unit.many} and ${countText(balance.free)} free.`
