"use client"

import { useId, type ReactNode } from "react"

import { cn } from "./cn"

export type SegmentedOption<T extends string> = {
  value: T
  label: ReactNode
  /** Tints the chosen segment: `allow` in the success colour, `block` in red. */
  tone?: "allow" | "block"
}

/**
 * Two to four choices side by side, one chosen: native radio buttons in a
 * fieldset under a legend (read by assistive technology, not shown), so it
 * submits with a form and the arrow keys move between options as on any
 * radio group. Controlled with `value` and `onValueChange`, or left to the
 * form with `defaultValue`. Over four choices, use a Select.
 */
function SegmentedControl<T extends string>({
  name,
  legend,
  options,
  value,
  defaultValue,
  onValueChange,
  disabled,
  size = "default",
  className,
}: {
  /** The form field's name; a generated one when it is not submitted. */
  name?: string
  /** The group's accessible name. */
  legend: string
  options: ReadonlyArray<SegmentedOption<T>>
  /** The chosen option; one outside `options` (or "") leaves none chosen. */
  value?: T | ""
  defaultValue?: T
  onValueChange?: (value: T) => void
  disabled?: boolean
  size?: "default" | "sm"
  className?: string
}) {
  const id = useId()
  const groupName = name ?? id

  return (
    <fieldset
      data-slot="segmented-control"
      disabled={disabled}
      className={cn(
        "m-0 inline-flex min-w-0 flex-wrap gap-0.5 rounded-lg border-0 bg-muted p-0.5 disabled:opacity-60",
        className,
      )}
    >
      <legend className="sr-only">{legend}</legend>
      {options.map((option) => {
        const optionId = `${id}-${option.value}`

        return (
          <span key={option.value} className="relative flex">
            <input
              type="radio"
              id={optionId}
              name={groupName}
              value={option.value}
              // Laid over its label, invisible: a click lands on the radio
              // itself, as it would on a plain one (and a test's check()).
              className="peer absolute inset-0 z-10 m-0 size-full cursor-pointer appearance-none opacity-0 disabled:cursor-not-allowed"
              {...(value !== undefined
                ? { checked: value === option.value }
                : { defaultChecked: defaultValue === option.value })}
              onChange={() => onValueChange?.(option.value)}
            />
            <label
              htmlFor={optionId}
              className={cn(
                "flex cursor-pointer items-center gap-1.5 rounded-[calc(var(--radius)*7/9)] px-3 font-medium whitespace-nowrap text-segment-foreground transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:cursor-not-allowed hover:text-foreground",
                size === "sm" ? "min-h-7 text-xs" : "min-h-[30px] text-[13px]",
                option.tone === "allow"
                  ? "peer-checked:bg-segment-allow peer-checked:text-segment-allow-foreground"
                  : option.tone === "block"
                    ? "peer-checked:bg-segment-block peer-checked:text-segment-block-foreground"
                    : "peer-checked:bg-segment-active peer-checked:text-segment-active-foreground",
              )}
            >
              {option.label}
            </label>
          </span>
        )
      })}
    </fieldset>
  )
}

export { SegmentedControl }
