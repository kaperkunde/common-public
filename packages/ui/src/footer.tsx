import Link from "next/link"
import type { ReactNode } from "react"

import { cn } from "./cn"

/** Who runs the site, as `OPERATOR` in @kaperkunde/next-kit has it. */
export type Operator = {
  name: string
  url: string
  country: string
  kvk?: string
}

export type FooterLink = {
  href: string
  label: ReactNode
  /**
   * Opens in a new tab. By default an http(s) address does and anything
   * else (a page here, a mailto:) does not.
   */
  newTab?: boolean
}

const linkClassName = "transition-colors hover:text-foreground"

function FooterAnchor({
  link,
  className,
}: {
  link: FooterLink
  className?: string
}) {
  const external = /^[a-z][a-z0-9+.-]*:/i.test(link.href)
  const newTab = link.newTab ?? /^https?:/i.test(link.href)

  if (!external && !newTab) {
    return (
      <Link href={link.href} className={className}>
        {link.label}
      </Link>
    )
  }

  return (
    <a
      href={link.href}
      className={className}
      {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {link.label}
    </a>
  )
}

/**
 * The operator line every site carries: "Made with care in the Netherlands
 * by Kaperkunde", the name a link to the operator's site, and the KVK number
 * after it when `kvk` is set.
 */
function OperatorCredit({
  operator,
  words = "Made with care",
  kvk = false,
  className,
  linkClassName: operatorLinkClassName = linkClassName,
}: {
  operator: Operator
  /** What comes before "in <country> by": "Made with love", "Built with care". */
  words?: string
  /** Adds " · KVK <number>". */
  kvk?: boolean
  className?: string
  linkClassName?: string
}) {
  return (
    <p data-slot="operator-credit" className={className}>
      {words} in {operator.country} by{" "}
      <a
        href={operator.url}
        target="_blank"
        rel="noopener noreferrer"
        className={operatorLinkClassName}
      >
        {operator.name}
      </a>
      {kvk && operator.kvk ? <>{` · KVK ${operator.kvk}`}</> : null}
    </p>
  )
}

/** The footer's links, as a navigation landmark named "Footer". */
function FooterLinks({
  links,
  className,
  linkClassName: footerLinkClassName = linkClassName,
}: {
  links: readonly FooterLink[]
  className?: string
  linkClassName?: string
}) {
  return (
    <nav
      aria-label="Footer"
      className={cn("flex flex-wrap gap-x-4 gap-y-2", className)}
    >
      {links.map((link) => (
        <FooterAnchor
          key={link.href}
          link={link}
          className={footerLinkClassName}
        />
      ))}
    </nav>
  )
}

/**
 * The page's foot: the operator line at the left and the links at the right,
 * one above the other on a phone, inside the page gutter. Anything passed as
 * children (a line about the site) goes above them. A site whose footer is
 * laid out otherwise builds it from OperatorCredit and FooterLinks.
 */
function SiteFooter({
  links,
  credit,
  className,
  children,
}: {
  links: readonly FooterLink[]
  /** The operator line, usually an <OperatorCredit>. */
  credit?: ReactNode
  className?: string
  children?: ReactNode
}) {
  return (
    <footer
      data-slot="site-footer"
      className={cn("mt-auto w-full px-gutter pb-safe", className)}
    >
      {children}
      <div className="flex flex-col items-center justify-between gap-3 border-t py-5 text-xs text-muted-foreground sm:flex-row">
        {credit}
        <FooterLinks links={links} />
      </div>
    </footer>
  )
}

export { OperatorCredit, FooterLinks, SiteFooter }
