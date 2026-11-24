"use client"

import { useRef, useState } from "react"

import { TokenCenterError, isTokenError } from "../errors"
import type { AppUnit, Purchase, PurchasesPage, Refund } from "../types"
import { formatMoney, formatUnits, refundCentsFor } from "../units"
import {
  refreshTokens,
  useAppInfo,
  useLabels,
  useLocale,
  usePurchases,
  useTokenApi,
} from "./hooks"
import { fill, type Labels, type LabelOverrides } from "./labels"
import { Notice, Panel, dateText, messageOf, part, type Styling } from "./ui"

export type PurchaseListProps = Styling & {
  /** Purchases the caller already holds; otherwise loaded from the routes. */
  page?: PurchasesPage
  limit?: number
  unit?: AppUnit
  labels?: LabelOverrides
  basePath?: string
  /** After a refund was made (settled or pending): the app may refresh its own state. */
  onRefunded?: (refund: Refund) => void
}

/** What the user is told for a refund the center refused, in words. Exported for custom screens. */
export function refundProblem(
  error: unknown,
  labels: Labels,
  unit: AppUnit,
  locale?: string,
): string {
  if (error instanceof TokenCenterError) {
    const left = error.refundableCreditMicros
    if (isTokenError(error, "refund_not_available") && error.action === "wait")
      return labels.refundWait
    if (
      isTokenError(error, "refund_not_available", "refund_amount_invalid") &&
      left !== undefined
    )
      return left > 0
        ? fill(labels.refundLess, {
            tokens: formatUnits(left, unit, { locale }),
          })
        : labels.nothingToRefund
    if (isTokenError(error, "refund_refused_by_processor"))
      return labels.refundRefused
  }
  return messageOf(error, labels)
}

/**
 * The user's paid purchases, each with what of it is still unspent and refundable. A refund
 * asks first and says the money back; confirming refunds all of that purchase's unspent
 * credit to the card it was paid with. A key per confirmation makes a retry the same refund.
 */
export function PurchaseList(props: PurchaseListProps) {
  const labels = useLabels(props.labels)
  const locale = useLocale()
  const styling: Styling = props
  const api = useTokenApi(props.basePath)
  const loaded = usePurchases(
    { limit: props.limit ?? 20 },
    { basePath: props.basePath, skip: props.page !== undefined },
  )
  const app = useAppInfo({
    basePath: props.basePath,
    skip: props.unit !== undefined,
  })
  const unit = props.unit ??
    app.data?.unit ?? { one: "token", many: "tokens", perDollar: 1_000_000 }
  const page = props.page ?? loaded.data

  const [confirming, setConfirming] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  // One key per confirmation: pressing again after a failure retries the same refund.
  const key = useRef<string | null>(null)

  const units = (n: number) => formatUnits(n, unit, { locale })
  const money = (cents: number, currency: string) =>
    formatMoney(cents, currency, locale)

  const refund = async (purchase: Purchase) => {
    if (pending) return
    key.current ??= crypto.randomUUID()
    setPending(true)
    setProblem(null)
    try {
      const made = await api.refund(purchase.id, {}, key.current)
      key.current = null
      setConfirming(null)
      setDone(
        fill(
          made.status === "pending" ? labels.refundStarted : labels.refundDone,
          {
            money: money(made.amountCents, made.currency),
          },
        ),
      )
      props.onRefunded?.(made)
      refreshTokens()
      await loaded.refresh()
    } catch (error) {
      setProblem(refundProblem(error, labels, unit, locale))
      // What is refundable may have moved: a refusal that says so is no retry of the same ask.
      if (error instanceof TokenCenterError && error.status < 500) {
        key.current = null
        await loaded.refresh()
      }
    } finally {
      setPending(false)
    }
  }

  const purchases = page?.purchases.filter((p) => p.status === "paid") ?? []

  return (
    <Panel title={labels.purchasesTitle} styling={styling}>
      {done ? (
        <Notice kind="ok" styling={styling}>
          {done}
        </Notice>
      ) : null}
      {!page ? (
        loaded.error ? (
          <Notice styling={styling}>{labels.unavailable}</Notice>
        ) : (
          <p className="tk-muted">{labels.loading}</p>
        )
      ) : purchases.length === 0 ? (
        <p className="tk-muted">{labels.purchasesEmpty}</p>
      ) : (
        <ul className={part(styling, "list")}>
          {purchases.map((p) => {
            const left = p.refundableCreditMicros ?? 0
            const back = p.refundableCents ?? refundCentsFor(p, left)
            const open = confirming === p.id
            return (
              <li key={p.id} className={part(styling, "row")}>
                <span className="tk-row__main">
                  <span className="tk-row__title">
                    {p.kind === "refill" ? labels.refill : labels.purchase}
                  </span>
                  <span className="tk-row__meta">
                    {dateText(p.paidAt ?? p.createdAt, locale)} ·{" "}
                    {money(p.totalCents ?? p.amountCents, p.currency)}
                    {p.refundedCents
                      ? ` · ${fill(labels.refundedSoFar, { money: money(p.refundedCents, p.currency) })}`
                      : ""}
                  </span>
                  {p.refundableCreditMicros === undefined ? null : (
                    <span className="tk-row__meta">
                      {left > 0
                        ? fill(labels.refundable, {
                            tokens: units(left),
                            money: money(back, p.currency),
                          })
                        : labels.nothingToRefund}
                    </span>
                  )}
                  {open ? (
                    <span className={part(styling, "confirm")}>
                      <span role="alertdialog" aria-label={labels.refund}>
                        {fill(labels.refundConfirm, {
                          tokens: units(left),
                          money: money(back, p.currency),
                        })}
                      </span>
                      {problem ? (
                        <Notice styling={styling}>{problem}</Notice>
                      ) : null}
                      <span className={part(styling, "actions")}>
                        <button
                          type="button"
                          className={part(
                            styling,
                            "button",
                            "tk-button--danger",
                          )}
                          aria-busy={pending}
                          onClick={() => void refund(p)}
                        >
                          {pending
                            ? labels.refunding
                            : fill(labels.refundConfirmButton, {
                                money: money(back, p.currency),
                              })}
                        </button>
                        <button
                          type="button"
                          className={part(
                            styling,
                            "button",
                            "tk-button--quiet",
                          )}
                          onClick={() => {
                            key.current = null
                            setProblem(null)
                            setConfirming(null)
                          }}
                        >
                          {labels.refundCancel}
                        </button>
                      </span>
                    </span>
                  ) : null}
                </span>
                <span className="tk-row__amount">
                  {left > 0 && !open ? (
                    <button
                      type="button"
                      className={part(styling, "button", "tk-button--quiet")}
                      onClick={() => {
                        key.current = null
                        setDone(null)
                        setProblem(null)
                        setConfirming(p.id)
                      }}
                    >
                      {labels.refundButton}
                    </button>
                  ) : null}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}
