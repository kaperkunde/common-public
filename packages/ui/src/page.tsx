import Link from "next/link"
import type { ReactNode } from "react"

import { cn } from "./cn"
import { ChevronLeft } from "./icons"

/**
 * The page's frame: a header, the main column inside the gutter (notch
 * included), and a footer pinned to the bottom of a short page.
 */
function PageShell({
  header,
  footer,
  width = "max-w-6xl",
  className,
  children,
}: {
  header?: ReactNode
  footer?: ReactNode
  /** The main column's max-width class. */
  width?: string
  className?: string
  children: ReactNode
}) {
  return (
    <div data-slot="page-shell" className="flex min-h-dvh flex-col">
      {header}
      <main className={cn("mx-auto w-full flex-1 px-gutter", width, className)}>
        {children}
      </main>
      {footer}
    </div>
  )
}

/**
 * A page's column of sections, 32px apart: `wide` takes what the layout
 * gives (lists, a dashboard), `narrow` stops at 820px (one thing's page,
 * settings).
 */
function PageColumn({
  width = "wide",
  className,
  children,
}: {
  width?: "wide" | "narrow"
  className?: string
  children: ReactNode
}) {
  return (
    <div
      data-slot="page-column"
      className={cn(
        "mx-auto flex w-full flex-col gap-8",
        width === "narrow" && "max-w-[820px]",
        className,
      )}
    >
      {children}
    </div>
  )
}

/**
 * The top of a page: a link back to where it sits (on a page under
 * another), an optional icon, a small line above the title (`kicker`), the
 * title with a grey line under it, and the page's own actions at the right
 * (under it on a phone), level with the middle of the title block, or with
 * its foot from 640px when `actionsAlign="end"`. The kicker, the title and
 * the description each take a class of their own, added to theirs.
 */
function PageHeader({
  title,
  description,
  kicker,
  action,
  back,
  icon,
  actionsAlign = "center",
  className,
  kickerClassName,
  titleClassName,
  descriptionClassName,
}: {
  title: ReactNode
  description?: ReactNode
  kicker?: ReactNode
  action?: ReactNode
  back?: { href: string; label: ReactNode }
  icon?: ReactNode
  /** Where the actions sit beside the title block: its middle, or (from 640px) its foot. */
  actionsAlign?: "center" | "end"
  className?: string
  kickerClassName?: string
  titleClassName?: string
  descriptionClassName?: string
}) {
  return (
    <header
      data-slot="page-header"
      className={cn("flex flex-col gap-5", className)}
    >
      {back ? (
        <Link
          href={back.href}
          className="-ml-1 inline-flex items-center gap-0.5 self-start text-sm text-primary hover:text-accent-foreground"
        >
          <ChevronLeft className="size-4" />
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 flex-1 basis-64 items-center gap-4">
          {icon}
          <div className="flex min-w-0 flex-col gap-1">
            {kicker ? (
              <div
                className={cn(
                  "text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase",
                  kickerClassName,
                )}
              >
                {kicker}
              </div>
            ) : null}
            <h1
              className={cn(
                "text-[28px] leading-tight font-bold tracking-[-0.02em] break-words sm:text-[30px]",
                titleClassName,
              )}
            >
              {title}
            </h1>
            {description ? (
              <div
                className={cn(
                  "max-w-2xl text-sm leading-relaxed text-muted-foreground",
                  descriptionClassName,
                )}
              >
                {description}
              </div>
            ) : null}
          </div>
        </div>
        {action ? (
          <div
            className={cn(
              "flex flex-wrap items-center gap-2",
              actionsAlign === "end" && "sm:self-end",
            )}
          >
            {action}
          </div>
        ) : null}
      </div>
    </header>
  )
}

export { PageShell, PageColumn, PageHeader }
