import Link from "next/link"
import type { ReactNode } from "react"

import { cn } from "./cn"
import { tabsListClassName, tabsTriggerClassName } from "./tabs-styles"

/**
 * Tabs that are pages: the same look and the same tab semantics as Tabs
 * (role="tablist" / role="tab", so getByRole("tab") still finds them), but
 * each is a real link with its own URL, history entry and prefetch.
 */
function NavTabsList({
  label,
  className,
  children,
}: {
  /** The tab list's accessible name. */
  label?: string
  className?: string
  children: ReactNode
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      data-slot="tabs-list"
      className={cn(tabsListClassName, "h-control-md", className)}
    >
      {children}
    </div>
  )
}

function NavTabsTrigger({
  href,
  active,
  className,
  children,
}: {
  href: string
  active: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <Link
      href={href}
      role="tab"
      aria-selected={active}
      aria-current={active ? "page" : undefined}
      data-slot="tabs-trigger"
      data-active={active ? "" : undefined}
      className={cn(tabsTriggerClassName, className)}
    >
      {children}
    </Link>
  )
}

export { NavTabsList, NavTabsTrigger }
