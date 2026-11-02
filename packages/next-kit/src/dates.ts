/**
 * The one way an app writes a date for people to read, in two styles:
 * `long` ("23 September 2026") for dates someone acts on, `short`
 * ("23 Sept 2026") for lists and tables; either can add the time. The time
 * zone is the reader's in a browser; on a server pass `timeZone`.
 */
export type DateStyle = "short" | "long"

export type FormatDateOptions = {
  style?: DateStyle
  /** Add the time of day; "seconds" for operator views that need them. */
  time?: boolean | "seconds"
  /** Defaults to the runtime's zone: the reader's in a browser. */
  timeZone?: string
  /** Defaults to en-GB, the house wording. */
  locale?: string
}

export function toDate(
  value: Date | string | number | null | undefined,
): Date | null {
  if (value === null || value === undefined || value === "") return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatDate(
  value: Date | string | number | null | undefined,
  {
    style = "long",
    time = false,
    timeZone,
    locale = "en-GB",
  }: FormatDateOptions = {},
): string | null {
  const date = toDate(value)
  if (!date) return null
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: style === "long" ? "long" : "short",
    year: "numeric",
    ...(time
      ? {
          hour: "2-digit",
          minute: "2-digit",
          ...(time === "seconds" ? { second: "2-digit" } : {}),
        }
      : {}),
    ...(timeZone ? { timeZone } : {}),
  }).format(date)
}

/** "just now", "5 minutes ago", "3 days ago", or the date past a month. */
export function timeAgo(
  value: Date | string | number,
  now: Date = new Date(),
  locale = "en-GB",
): string {
  const date = toDate(value)
  if (!date) return ""
  const seconds = Math.round((now.getTime() - date.getTime()) / 1000)
  if (seconds < 45) return "just now"
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" })
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return rtf.format(-minutes, "minute")
  const hours = Math.round(minutes / 60)
  if (hours < 24) return rtf.format(-hours, "hour")
  const days = Math.round(hours / 24)
  if (days < 30) return rtf.format(-days, "day")
  return formatDate(date, { style: "short", locale }) ?? ""
}
