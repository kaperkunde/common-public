"use client"

import type { Balance } from "../types"
import { formatCompact, formatUnits, unitsOf } from "../units"
import { useBalance, useLabels, useLocale } from "./hooks"
import { fill, type LabelOverrides } from "./labels"
import { Notice, Panel, dateText, part, cx, type Styling } from "./ui"

export type TokenBalanceProps = Styling & {
  /** `pill`: one short line for a header ("84k credits"). `full`: the breakdown. */
  variant?: "pill" | "full"
  /** A balance you already hold; otherwise it is loaded and polled. */
  balance?: Balance
  /** Poll interval in ms for the loaded balance. Default 30 s. */
  refreshMs?: number
  /** Where the pill goes when pressed (the page that buys). */
  href?: string
  /** Shown beside the full balance: a link or button to buy. */
  action?: React.ReactNode
  labels?: LabelOverrides
  /** Where the app mounted its routes, if not `/api/tokens`. */
  basePath?: string
}

/**
 * The balance: a compact pill for the header or the full breakdown. Colours
 * come from `--tk-*`; the unit's name from the app's registration.
 */
export function TokenBalance(props: TokenBalanceProps) {
  const labels = useLabels(props.labels)
  const locale = useLocale()
  const loaded = useBalance({
    basePath: props.basePath,
    refreshMs: props.refreshMs,
    skip: props.balance !== undefined,
  })
  const balance = props.balance ?? loaded.data
  const variant = props.variant ?? "pill"
  const styling: Styling = props

  if (variant === "pill") {
    const content = balance ? (
      <>
        <span className="tk-balance__amount">
          {formatCompact(unitsOf(balance.availableMicros, balance.unit))}
        </span>{" "}
        <span className="tk-balance__unit tk-hide-narrow">
          {balance.unit.many}
        </span>
      </>
    ) : loaded.error ? (
      <span title={labels.balanceUnknown}>—</span>
    ) : (
      <span aria-label={labels.loading}>…</span>
    )
    const empty = balance !== undefined && balance.availableMicros <= 0
    const classes = cx(
      part(
        styling,
        "balance",
        "tk-balance--pill",
        empty && "tk-balance--empty",
        styling.className,
      ),
    )
    const title = balance
      ? formatUnits(balance.availableMicros, balance.unit, { locale })
      : undefined
    return props.href ? (
      <a className={classes} href={props.href} title={title}>
        {content}
      </a>
    ) : (
      <span className={classes} role="status" title={title}>
        {content}
      </span>
    )
  }

  return (
    <Panel title={labels.balance} styling={styling}>
      {!balance ? (
        loaded.error ? (
          <Notice styling={styling}>{labels.unavailable}</Notice>
        ) : (
          <p className="tk-muted">{labels.loading}</p>
        )
      ) : (
        <>
          <p
            className={part(styling, "balance", "tk-balance--full")}
            role="status"
          >
            <span className="tk-balance__amount">
              {formatUnits(balance.availableMicros, balance.unit, {
                locale,
                bare: true,
              })}
            </span>{" "}
            <span className="tk-balance__unit">{balance.unit.many}</span>
          </p>
          {balance.availableMicros <= 0 ? (
            <p className="tk-muted">{labels.empty}</p>
          ) : null}
          <dl className={part(styling, "breakdown")}>
            <div>
              <dt>{labels.purchased}</dt>
              <dd>
                {formatUnits(balance.purchasedMicros, balance.unit, {
                  locale,
                  bare: true,
                })}
              </dd>
            </div>
            {balance.grantsMicros > 0 ? (
              <div>
                <dt>{labels.fromGrants}</dt>
                <dd>
                  {formatUnits(balance.grantsMicros, balance.unit, {
                    locale,
                    bare: true,
                  })}
                </dd>
              </div>
            ) : null}
          </dl>
          {balance.nextExpiry ? (
            <p className="tk-muted">
              {fill(labels.expiring, {
                amount: formatUnits(balance.nextExpiry.micros, balance.unit, {
                  locale,
                }),
                date: dateText(balance.nextExpiry.at, locale),
              })}
            </p>
          ) : null}
          {balance.purchasedMicros < 0 ? (
            <p className="tk-muted">
              {fill(labels.shortfall, {
                amount: formatUnits(-balance.purchasedMicros, balance.unit, {
                  locale,
                }),
              })}
            </p>
          ) : null}
          {props.action ? (
            <div className={part(styling, "actions")}>{props.action}</div>
          ) : null}
        </>
      )}
    </Panel>
  )
}
