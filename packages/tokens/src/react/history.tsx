"use client"

import type { AppUnit, HistoryEntry, HistoryPage } from "../types"
import { formatMoney, formatUnits } from "../units"
import { useAppInfo, useHistory, useLabels, useLocale } from "./hooks"
import { type Labels, type LabelOverrides } from "./labels"
import { Notice, Panel, dateText, part, type Styling } from "./ui"

export type PurchaseHistoryProps = Styling & {
  page?: HistoryPage
  limit?: number
  unit?: AppUnit
  labels?: LabelOverrides
  basePath?: string
}

type Line = { key: string; title: string; meta: string; amount: string }

/** One history entry as the lines a row shows. Exported for tests and custom lists. */
export function historyLine(
  entry: HistoryEntry,
  unit: AppUnit,
  labels: Labels,
  locale?: string,
): Line {
  const when = dateText(entry.at, locale)
  const units = (n: number) => formatUnits(n, unit, { locale, bare: true })
  switch (entry.type) {
    case "purchase": {
      const p = entry.purchase
      const status =
        p.status === "paid"
          ? ""
          : ` · ${p.status === "open" ? labels.statusOpen : p.status === "failed" ? labels.statusFailed : labels.statusExpired}`
      return {
        key: `purchase:${p.id}`,
        title: p.kind === "refill" ? labels.refill : labels.purchase,
        meta: `${when} · ${formatMoney(p.amountCents, p.currency, locale)}${status}`,
        amount: p.status === "paid" ? `+${units(p.creditMicros)}` : "—",
      }
    }
    case "grant":
      return {
        key: `grant:${entry.lot.id}`,
        title: entry.lot.kind === "airdrop" ? labels.airdrop : labels.grant,
        meta: when,
        amount: `+${units(entry.lot.grantedMicros)}`,
      }
    case "expiry":
      return {
        key: `expiry:${entry.lotId}:${entry.at}`,
        title: labels.expiredLot,
        meta: when,
        amount: `−${units(entry.expiredMicros)}`,
      }
    case "adjustment":
      return {
        key: `adjustment:${entry.at}:${entry.reason}`,
        title: labels.adjustment,
        meta: `${when} · ${entry.reason}`,
        amount: `${entry.micros >= 0 ? "+" : "−"}${units(Math.abs(entry.micros))}`,
      }
  }
}

/** Purchases, drops and grants, expiries and adjustments, newest first. */
export function PurchaseHistory(props: PurchaseHistoryProps) {
  const labels = useLabels(props.labels)
  const locale = useLocale()
  const styling: Styling = props
  const loaded = useHistory(
    { limit: props.limit ?? 50 },
    { basePath: props.basePath, skip: props.page !== undefined },
  )
  const app = useAppInfo({
    basePath: props.basePath,
    skip: props.unit !== undefined,
  })
  const unit = props.unit ??
    app.data?.unit ?? { one: "token", many: "tokens", perDollar: 1_000_000 }
  const page = props.page ?? loaded.data

  return (
    <Panel title={labels.historyTitle} styling={styling}>
      {!page ? (
        loaded.error ? (
          <Notice styling={styling}>{labels.unavailable}</Notice>
        ) : (
          <p className="tk-muted">{labels.loading}</p>
        )
      ) : page.entries.length === 0 ? (
        <p className="tk-muted">{labels.historyEmpty}</p>
      ) : (
        <ul className={part(styling, "list")}>
          {page.entries.map((entry) => {
            const line = historyLine(entry, unit, labels, locale)
            return (
              <li key={line.key} className={part(styling, "row")}>
                <span className="tk-row__main">
                  <span className="tk-row__title">{line.title}</span>
                  <span className="tk-row__meta">{line.meta}</span>
                </span>
                <span className="tk-row__amount">{line.amount}</span>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

/** The same list under the name the center's docs use. */
export const HistoryList = PurchaseHistory
