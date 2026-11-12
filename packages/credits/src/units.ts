/**
 * The credit unit an app names, and counts said in it. Nothing here knows what an app calls
 * its credits: every text helper takes the unit as a parameter.
 */

/** What an app calls one credit and many: `{ one: "credit", many: "credits" }`. */
export type CreditUnit = { one: string; many: string }

/** The unit used where an app names none. */
export const DEFAULT_UNIT: CreditUnit = { one: "credit", many: "credits" }

/** A count as a reader counts it: `1,234`. */
export const countText = (count: number) =>
  Math.round(Number(count) || 0).toLocaleString("en-US")

/** "1 credit", "1,234 credits", "-5,000 credits". */
export const creditsText = (count: number, unit: CreditUnit = DEFAULT_UNIT) =>
  `${countText(count)} ${Math.abs(Math.round(Number(count) || 0)) === 1 ? unit.one : unit.many}`

/** A count as it reads at a glance: 400, 1.2k, 12k, 1.2M. */
export const shortCount = (count: number) => {
  const value = Math.max(Math.round(Number(count) || 0), 0)
  if (value < 1000) return String(value)
  const [suffix, size] = value < 1_000_000 ? ["k", 1000] : ["M", 1_000_000]
  const scaled = value / size
  return `${Number(scaled.toFixed(scaled < 10 ? 1 : 0)).toString()}${suffix}`
}

/** A day, in UTC so the server and every test say the same thing: "30 November 2026". */
export const dayText = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })

/** The last day something expiring at an instant is good for: the day before that instant. */
export const lastDayText = (expiresAt: string) =>
  dayText(new Date(new Date(expiresAt).getTime() - 1).toISOString())
