import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import Link from "next/link"
import type { ComponentProps } from "react"

import { cn } from "./cn"

/**
 * One primary action per view (`default`, the primary colour, filled);
 * everything else is quieter: filled grey (`secondary`), outlined
 * (`primary-outline` in the primary colour, `outline` in the border colour),
 * or plain text (`ghost` in the primary colour, `plain` in grey,
 * `destructive` in red, `link`). `destructive-soft` is red on a red tint.
 *
 * Height, padding, type and corner per size are theme tokens
 * (`--spacing-control-*`, `--text-control-*`, `--radius-control-*`), and so
 * are the weights (`--font-weight-control`, `--font-weight-control-primary`
 * for the filled primary button) and the border's width
 * (`--control-border-width`, 1px), so each site keeps its own proportions.
 * `xl` is the large call to action on a landing page.
 *
 * Every variant has a border, transparent unless it draws one, so a button
 * keeps its size whichever it is; pass `border-transparent` to draw an
 * outlined variant without its line (`cn` lets it win).
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 cursor-pointer items-center justify-center border-[length:var(--control-border-width,1px)] border-transparent bg-clip-padding font-control whitespace-nowrap shadow-control transition-colors select-none focus-ring disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary font-control-primary text-primary-foreground hover:bg-primary/85",
        "primary-outline":
          "border-primary text-primary hover:bg-primary/10 active:bg-primary/20 aria-expanded:bg-primary/10",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary-hover hover:text-secondary-hover-foreground",
        outline:
          "border-border bg-transparent hover:bg-foreground/5 active:bg-foreground/10 aria-expanded:bg-foreground/5",
        ghost: "text-primary shadow-none hover:bg-primary/10",
        plain:
          "text-muted-foreground shadow-none hover:bg-foreground/5 hover:text-foreground",
        destructive:
          "text-destructive shadow-none hover:bg-destructive/10 focus-visible:ring-destructive/30",
        "destructive-soft":
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20",
        link: "h-auto px-0 text-primary underline-offset-4 shadow-none hover:underline",
      },
      size: {
        default:
          "h-control-md gap-1.5 rounded-control-md px-control-md-x text-control-md",
        xs: "h-control-xs gap-1 rounded-control-xs px-control-xs-x text-control-xs [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-control-sm gap-1.5 rounded-control-sm px-control-sm-x text-control-sm [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-control-lg gap-2 rounded-control-lg px-control-lg-x text-control-lg",
        xl: "h-control-xl gap-2 rounded-control-xl px-control-xl-x text-control-xl",
        icon: "size-control-md rounded-control-md",
        "icon-xs":
          "size-control-xs rounded-control-xs [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-control-sm rounded-control-sm",
        "icon-lg": "size-control-lg rounded-control-lg",
        "icon-xl": "size-control-xl rounded-control-xl",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

type ButtonVariants = VariantProps<typeof buttonVariants>

function Button({
  className,
  variant = "default",
  size = "default",
  render,
  nativeButton,
  ...props
}: ButtonPrimitive.Props & ButtonVariants) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      render={render}
      // A button rendered as something else (a link) is not a native
      // <button>; saying so keeps Base UI from warning about it.
      nativeButton={nativeButton ?? render === undefined}
      {...props}
    />
  )
}

/** A navigation link that looks like a button and stays a link. */
function ButtonLink({
  className,
  variant = "default",
  size = "default",
  ...props
}: ComponentProps<typeof Link> & ButtonVariants) {
  return (
    <Link
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
}

export { Button, ButtonLink, buttonVariants, type ButtonVariants }
