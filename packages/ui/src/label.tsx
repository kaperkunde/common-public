import type { ComponentProps, ReactNode } from "react"

import { cn } from "./cn"

type Required = {
  /**
   * Marks the field as one the form cannot do without, before anything is
   * pressed: `true` shows "(needed)", a string shows that instead. Drawn by
   * CSS, so the label's text (what `useRequiredFields` names) stays the
   * field's name alone.
   */
  required?: boolean | string
}

function Label({
  className,
  required,
  ...props
}: ComponentProps<"label"> & Required) {
  const mark =
    typeof required === "string" ? required : required ? "(needed)" : undefined

  return (
    <label
      data-slot="label"
      data-required-mark={mark}
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        mark &&
          "after:font-normal after:text-muted-foreground after:content-[attr(data-required-mark)]",
        className,
      )}
      {...props}
    />
  )
}

/**
 * A label above its control, a grey hint under it, and the field's own error
 * in place of the hint once there is one (`<id>-hint`, `<id>-error`, for the
 * control's `aria-describedby`). `labelClassName` and `hintClassName` are
 * added to the label's and the hint's own classes.
 */
function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  className,
  labelClassName,
  hintClassName,
  children,
}: Required & {
  label: ReactNode
  htmlFor: string
  hint?: ReactNode
  error?: ReactNode
  className?: string
  labelClassName?: string
  hintClassName?: string
  children: ReactNode
}) {
  return (
    <div data-slot="field" className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor} required={required} className={labelClassName}>
        {label}
      </Label>
      {children}
      {hint && !error ? (
        <div
          id={`${htmlFor}-hint`}
          className={cn("text-xs text-muted-foreground", hintClassName)}
        >
          {hint}
        </div>
      ) : null}
      {error ? (
        <div
          id={`${htmlFor}-error`}
          role="alert"
          className="text-xs font-medium text-destructive"
        >
          {error}
        </div>
      ) : null}
    </div>
  )
}

export { Label, Field }
