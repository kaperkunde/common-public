"use client"

import { useSyncExternalStore, type ReactNode } from "react"

import { formatDate, toDate, type FormatDateOptions } from "./dates"

const subscribe = () => () => {}

/**
 * A date in the reader's own time zone. The server renders it in UTC (it
 * cannot know the reader's zone) and the browser swaps in local time straight
 * after hydration, so the markup matches on first render and nobody reads a
 * date in the container's zone.
 */
export function LocalDate({
  value,
  style,
  time,
  locale,
  fallback = null,
  className,
}: {
  value: Date | string | null | undefined
  style?: FormatDateOptions["style"]
  time?: FormatDateOptions["time"]
  locale?: string
  /** Shown when there is no valid date. */
  fallback?: ReactNode
  className?: string
}) {
  const inBrowser = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  )
  const date = toDate(value)
  if (!date) return <>{fallback}</>
  return (
    <time dateTime={date.toISOString()} className={className}>
      {formatDate(date, {
        style,
        time,
        locale,
        timeZone: inBrowser ? undefined : "UTC",
      })}
    </time>
  )
}
