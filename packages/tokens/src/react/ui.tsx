"use client"

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react"

import { TokenCenterError, centerUnavailable } from "../errors"
import { fill, type Labels } from "./labels"

/** Class names every component accepts: `className` on the root, `classNames` per part. */
export type Styling = {
  className?: string
  classNames?: Partial<Record<string, string>>
}

export const cx = (...parts: (string | false | null | undefined)[]): string =>
  parts.filter(Boolean).join(" ")

/** The class for a part: its stable `tk-*` name plus the consumer's. */
export const part = (
  styling: Styling,
  name: string,
  ...extra: (string | false | null | undefined)[]
): string => cx(`tk-${name}`, ...extra, styling.classNames?.[name])

/** Anything thrown, as a sentence a user can read. */
export function messageOf(error: unknown, labels: Labels): string {
  if (error instanceof TokenCenterError)
    return error.code === "center_unavailable"
      ? labels.unavailable
      : error.message
  return labels.somethingWrong
}

export const asTokenError = (error: unknown): TokenCenterError =>
  error instanceof TokenCenterError ? error : centerUnavailable(error)

/** "Still needed: A, B." for the fields not yet filled in, or `null`. */
export function stillNeeded(
  labels: Labels,
  fields: { label: string; filled: boolean }[],
): string | null {
  const missing = fields.filter((f) => !f.filled).map((f) => f.label)
  return missing.length
    ? fill(labels.stillNeeded, { fields: missing.join(", ") })
    : null
}

/** One async action's state: pending, the error as words, and a way to clear it. */
export function useAction(labels: Labels) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const run = useCallback(
    async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
      setPending(true)
      setError(null)
      try {
        return await action()
      } catch (e) {
        if (alive.current) setError(messageOf(e, labels))
        return undefined
      } finally {
        if (alive.current) setPending(false)
      }
    },
    [labels],
  )
  return { pending, error, setError, run }
}

export function Notice({
  kind = "error",
  children,
  styling,
}: {
  kind?: "error" | "ok" | "info"
  children: ReactNode
  styling: Styling
}) {
  return (
    <p
      className={part(styling, "notice", `tk-notice--${kind}`)}
      role={kind === "error" ? "alert" : "status"}
    >
      {children}
    </p>
  )
}

/** A labelled field: the label, the control (given its id), a hint beneath, and "(needed)" when required. */
export function Field({
  label,
  hint,
  required,
  children,
  styling,
}: {
  label: string
  hint?: string
  required?: boolean
  children: (props: { id: string; "aria-describedby"?: string }) => ReactNode
  styling: Styling
}) {
  const id = useId()
  const hintId = `${id}-hint`
  return (
    <div className={part(styling, "field")}>
      <label className={part(styling, "label")} htmlFor={id}>
        {label}
        {required ? <span className="tk-needed"> (needed)</span> : null}
      </label>
      {children({ id, "aria-describedby": hint ? hintId : undefined })}
      {hint ? (
        <p className={part(styling, "hint")} id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  )
}

/** Two to four exclusive choices as one row of real buttons. */
export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  styling,
}: {
  label: string
  value: T | null
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  styling: Styling
}) {
  const id = useId()
  return (
    <div className={part(styling, "field")}>
      <span className={part(styling, "label")} id={id}>
        {label}
      </span>
      <div
        className={part(styling, "segmented")}
        role="group"
        aria-labelledby={id}
      >
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            className={part(styling, "segment")}
            aria-pressed={o.value === value}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function Panel({
  title,
  styling,
  children,
  as: Tag = "section",
}: {
  title?: string
  styling: Styling
  children: ReactNode
  as?: "section" | "div"
}) {
  const id = useId()
  return (
    <Tag
      className={part(styling, "panel", styling.className)}
      aria-labelledby={title ? id : undefined}
    >
      {title ? (
        <h2 className={part(styling, "title")} id={id}>
          {title}
        </h2>
      ) : null}
      {children}
    </Tag>
  )
}

export function dateText(iso: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
    new Date(iso),
  )
}

export function dateTimeText(iso: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso))
}
