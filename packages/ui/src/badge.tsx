import { cva, type VariantProps } from "class-variance-authority"
import type { ComponentProps } from "react"

import { cn } from "./cn"

/**
 * A short label beside a name: a state ("Read-only"), a hint ("Changes
 * data"). The tinted variants stay quiet; the `solid` ones stand out, and
 * `solid-warning` is for what needs the reader now ("Sign in again"). The
 * corner, side padding, type size and weight are the theme's
 * (`--radius-badge`, `--spacing-badge-x`, `--text-badge`,
 * `--font-weight-badge`: a pill in medium 12px on plek.je and pcp.gg), and so
 * is the destructive tint's strength (`--badge-destructive-tint`).
 */
const badgeVariants = cva(
  "inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 rounded-badge border border-transparent px-badge-x text-badge font-badge whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "bg-accent text-accent-foreground",
        secondary: "bg-muted text-muted-foreground",
        destructive:
          "bg-[color-mix(in_oklab,var(--destructive)_var(--badge-destructive-tint,15%),transparent)] text-destructive",
        warning: "bg-warning/15 text-warning",
        solid: "bg-primary text-primary-foreground",
        "solid-secondary": "bg-secondary text-secondary-foreground",
        "solid-warning": "bg-warning text-warning-foreground",
        outline: "border-border text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)

function Badge({
  className,
  variant,
  ...props
}: ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

/** A count beside a navigation item or a heading: what waits for you. */
function CountBadge({
  count,
  className,
  ...props
}: Omit<ComponentProps<"span">, "children"> & { count: number }) {
  if (count <= 0) {
    return null
  }

  return (
    <span
      data-slot="count-badge"
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-warning px-1.5 text-xs leading-none font-bold text-warning-foreground",
        className,
      )}
      {...props}
    >
      {count > 99 ? "99+" : count}
    </span>
  )
}

/** The dot before a status: the primary colour when fine, amber when it needs you. */
function StatusDot({
  tone = "ok",
  className,
}: {
  tone?: "ok" | "warning" | "error" | "off"
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      data-slot="status-dot"
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        tone === "ok" && "bg-primary",
        tone === "warning" && "bg-warning",
        tone === "error" && "bg-destructive",
        tone === "off" && "bg-muted-foreground/50",
        className,
      )}
    />
  )
}

export { Badge, badgeVariants, CountBadge, StatusDot }
