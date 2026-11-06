import Link from "next/link"
import { Fragment, type ReactNode } from "react"

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

/** The pieces of the operator line, for a `template` function. */
export type OperatorCreditParts = {
  /** The operator's name, a link to its site. */
  operator: ReactNode
  name: string
  country: string
  /** The KVK number, when the operator has one. */
  kvk?: string
}

/**
 * The operator line every site carries: "Made with care in the Netherlands
 * by Kaperkunde", the name a link to the operator's site, and the KVK number
 * after it when `kvk` is set.
 *
 * `template` words it otherwise, in the order a site wants: a string with
 * `{operator}` (the name as a link), `{name}`, `{country}` and `{kvk}` in it
 * ("Run by {operator} in {country} · KVK {kvk}"), or a function given those
 * parts that returns the line (to add a link after it, say). `words` and
 * `kvk` are then not read; `{kvk}` is empty for an operator without one.
 */
function OperatorCredit({
  operator,
  words = "Made with care",
  kvk = false,
  template,
  className,
  linkClassName: operatorLinkClassName = linkClassName,
}: {
  operator: Operator
  /** What comes before "in <country> by": "Made with love", "Built with care". */
  words?: string
  /** Adds " · KVK <number>". */
  kvk?: boolean
  /** The whole line, worded and ordered by the site. */
  template?: string | ((parts: OperatorCreditParts) => ReactNode)
  className?: string
  linkClassName?: string
}) {
  const link = (
    <a
      href={operator.url}
      target="_blank"
      rel="noopener noreferrer"
      className={operatorLinkClassName}
    >
      {operator.name}
    </a>
  )

  if (template !== undefined) {
    const parts: OperatorCreditParts = {
      operator: link,
      name: operator.name,
      country: operator.country,
      kvk: operator.kvk,
    }
    return (
      <p data-slot="operator-credit" className={className}>
        {typeof template === "function"
          ? template(parts)
          : fillTemplate(template, parts)}
      </p>
    )
  }

  return (
    <p data-slot="operator-credit" className={className}>
      {words} in {operator.country} by {link}
      {kvk && operator.kvk ? <>{` · KVK ${operator.kvk}`}</> : null}
    </p>
  )
}

/** `{operator}`, `{name}`, `{country}` and `{kvk}` in a template, filled in. */
function fillTemplate(template: string, parts: OperatorCreditParts) {
  return template
    .split(/(\{(?:operator|name|country|kvk)\})/)
    .map((piece, index) => {
      switch (piece) {
        case "{operator}":
          return <Fragment key={index}>{parts.operator}</Fragment>
        case "{name}":
          return parts.name
        case "{country}":
          return parts.country
        case "{kvk}":
          return parts.kvk ?? ""
        default:
          return piece
      }
    })
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
