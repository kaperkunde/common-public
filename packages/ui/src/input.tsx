import type { ComponentProps } from "react"

import { cn } from "./cn"

/**
 * The class every field shares: the theme's `--spacing-field` tall, on the
 * field colour, the ring colour around it when focused, red when invalid.
 */
const fieldClassName =
  "h-field w-full min-w-0 rounded-lg border border-input bg-field px-field-x py-1 text-base transition-colors placeholder:text-muted-foreground/70 focus-ring-field disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive in-data-asked:invalid:border-destructive md:text-sm"

function Input({ className, type, ...props }: ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(fieldClassName, className)}
      {...props}
    />
  )
}

function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(fieldClassName, "h-auto min-h-20 py-2", className)}
      {...props}
    />
  )
}

function Select({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      data-slot="select"
      className={cn(fieldClassName, "cursor-pointer bg-secondary", className)}
      {...props}
    />
  )
}

function Checkbox({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      type="checkbox"
      data-slot="checkbox"
      className={cn("size-4 cursor-pointer accent-primary", className)}
      {...props}
    />
  )
}

export { Input, Textarea, Select, Checkbox, fieldClassName }
