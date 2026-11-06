import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * tailwind-merge, told about the package's own theme names. Without this it
 * reads `text-control-md` as a colour (and drops it beside `text-primary`) and
 * does not know `h-control` is a height, so an app's `h-12` would not replace
 * it.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      spacing: [
        "control-xs",
        "control-sm",
        "control-md",
        "control-lg",
        "control-xl",
        "control-xs-x",
        "control-sm-x",
        "control-md-x",
        "control-lg-x",
        "control-xl-x",
        "field",
        "field-x",
        "card",
        "card-sm",
        "badge-x",
      ],
      text: [
        "control-xs",
        "control-sm",
        "control-md",
        "control-lg",
        "control-xl",
        "card-title",
        "card-description",
        "badge",
      ],
      "font-weight": ["control", "control-primary", "badge", "segment"],
      radius: [
        "control-xs",
        "control-sm",
        "control-md",
        "control-lg",
        "control-xl",
        "badge",
        "card",
        "menu",
        "dialog",
      ],
      shadow: ["control", "card", "popover", "dialog"],
    },
  },
})

/** Class names joined, later Tailwind classes winning over earlier ones. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
