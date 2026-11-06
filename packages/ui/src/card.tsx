import type { ComponentProps } from "react"

import { cn } from "./cn"

/**
 * A panel on the page: content that is not a list of rows (a form, a block
 * of text, a code sample). Rows go in a List (`@kaperkunde/ui/list`).
 * Padding is the theme's `--spacing-card` (`size="sm"`: `--spacing-card-sm`),
 * the edge its `--card-shadow`. Who pads the sides is the theme's
 * `--card-slots`: 0 (PCP's), the card pads whatever it holds; 1 (shadcn's),
 * the card pads only top and bottom and its header, content and footer pad
 * their own sides, so anything else inside runs edge to edge. The space
 * between its parts is `--card-gap` (16px; `size="sm"`: `--card-gap-sm`,
 * 12px).
 *
 * `clip` cuts off whatever pokes out past its rounded corners (an image, a
 * table running edge to edge), as shadcn's card did. It is off by default:
 * it also cuts a focus ring or a menu reaching past the edge, and lets the
 * card grow narrower than its content in a flex row.
 */
function Card({
  className,
  size = "default",
  clip = false,
  ...props
}: ComponentProps<"div"> & { size?: "default" | "sm"; clip?: boolean }) {
  return (
    <div
      data-slot="card"
      data-size={size}
      className={cn(
        "group/card flex flex-col gap-[var(--card-gap,calc(var(--spacing)*4))] rounded-card bg-card px-(--card-px) py-(--card-pad) text-sm text-card-foreground shadow-card [--card-pad:var(--spacing-card)] [--card-px:calc(var(--card-pad)*(1_-_var(--card-slots,0)))] [--card-slot-px:calc(var(--card-pad)*var(--card-slots,0))] data-[size=sm]:gap-[var(--card-gap-sm,calc(var(--spacing)*3))] data-[size=sm]:[--card-pad:var(--spacing-card-sm)]",
        clip && "overflow-hidden",
        className,
      )}
      {...props}
    />
  )
}

/** The title and description, with an optional CardAction at their right. */
function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "grid auto-rows-min items-start gap-1 px-(--card-slot-px) has-data-[slot=card-action]:grid-cols-[1fr_auto]",
        className,
      )}
      {...props}
    />
  )
}

/**
 * The card's heading, an h2 unless `as` says otherwise. As a heading it
 * tracks as the theme's h1–h4 do (`--heading-tracking`), or as
 * `--card-title-tracking` where that is set; `as="div"` is no heading and
 * keeps the text's own spacing.
 */
function CardTitle({
  as: Tag = "h2",
  className,
  ...props
}: ComponentProps<"h2"> & { as?: "h2" | "h3" | "div" }) {
  return (
    <Tag
      data-slot="card-title"
      className={cn(
        "text-card-title leading-snug [font-weight:var(--heading-weight,600)]",
        className,
      )}
      {...props}
    />
  )
}

/** A grey line under the title, `--text-card-description` (13px) in size. */
function CardDescription({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn(
        "text-card-description leading-relaxed text-muted-foreground",
        className,
      )}
      {...props}
    />
  )
}

/** Something to do about the card, at the header's right. */
function CardAction({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className,
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("flex flex-col gap-4 px-(--card-slot-px)", className)}
      {...props}
    />
  )
}

/** A strip along the card's foot, edge to edge, on a muted ground. */
function CardFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "-mx-(--card-px) mt-auto -mb-(--card-pad) flex items-center rounded-b-card border-t bg-muted/50 p-(--card-pad)",
        className,
      )}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
  CardFooter,
}
