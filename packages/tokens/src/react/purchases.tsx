"use client"

import { useEffect, useRef, useState } from "react"

import { TokenCenterError, isTokenError } from "../errors"
import type { AppUnit, Purchase, PurchasesPage, Refund } from "../types"
import {
  formatMoney,
  formatUnits,
  microsOf,
  presentmentCentsFor,
  refundCentsFor,
} from "../units"
import {
  refreshTokens,
  useAppInfo,
  useLabels,
  useLocale,
  usePurchases,
  useTokenApi,
} from "./hooks"
import { fill, type Labels, type LabelOverrides } from "./labels"
import {
  Field,
  Notice,
  Panel,
  dateText,
  messageOf,
  part,
  type Styling,
} from "./ui"

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

const WAIT_SECONDS = 3

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
      return fill(labels.refundWait, {
        seconds: error.detail.retryAfterSeconds ?? WAIT_SECONDS,
      })
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
  const [mode, setMode] = useState<"all" | "part">("all")
  const [amount, setAmount] = useState("")
  const retry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(retry.current), [])
  // One key per confirmation: pressing again after a failure retries the same refund.
  const key = useRef<string | null>(null)

  const units = (n: number) => formatUnits(n, unit, { locale })
  const money = (cents: number, currency: string) =>
    formatMoney(cents, currency, locale)

  /** What the person asked for, in micros: all of it, or the typed amount; null when it is not one. */
  const askedFor = (purchase: Purchase): number | null => {
    const left = purchase.refundableCreditMicros ?? 0
    if (mode === "all") return left
    const typed = Number(amount.trim().replace(",", "."))
    const micros = microsOf(typed, unit)
    return Number.isFinite(typed) && typed > 0 && micros > 0 && micros <= left
      ? micros
      : null
  }

  const refund = async (purchase: Purchase, retried = false) => {
    if (pending) return
    clearTimeout(retry.current)
    const micros = askedFor(purchase)
    if (micros === null) {
      setProblem(
        fill(labels.refundAmountBad, {
          max: formatUnits(purchase.refundableCreditMicros ?? 0, unit, {
            locale,
            bare: true,
          }),
        }),
      )
      return
    }
    // A fresh key per confirmation; kept for a retry of the very same ask.
    key.current ??= crypto.randomUUID()
    setPending(true)
    setProblem(null)
    try {
      const made = await api.refund(
        purchase.id,
        mode === "all" ? {} : { creditMicros: micros },
        key.current,
      )
      key.current = null
      setConfirming(null)
      const own =
        made.presentmentAmountCents !== undefined && made.presentmentCurrency
      const pendingRefund = made.status === "pending"
      setDone(
        fill(
          own
            ? pendingRefund
              ? labels.refundStartedApprox
              : labels.refundDoneApprox
            : pendingRefund
              ? labels.refundStarted
              : labels.refundDone,
          {
            money: own
              ? money(made.presentmentAmountCents!, made.presentmentCurrency!)
              : money(made.amountCents, made.currency),
          },
        ),
      )
      props.onRefunded?.(made)
      refreshTokens()
      await loaded.refresh()
    } catch (error) {
      setProblem(refundProblem(error, labels, unit, locale))
      if (error instanceof TokenCenterError && error.status < 500) {
        const wait =
          isTokenError(error, "refund_not_available") && error.action === "wait"
        if (wait && !retried) {
          // A call of the user's is running: ask again once, after the center's hint.
          retry.current = setTimeout(
            () => void refund(purchase, true),
            (error.detail.retryAfterSeconds ?? WAIT_SECONDS) * 1000,
          )
        } else {
          key.current = null
          await loaded.refresh()
        }
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
            const open = confirming === p.id
            const asked = open ? (askedFor(p) ?? 0) : left
            const back =
              mode === "all" || !open
                ? (p.refundableCents ?? refundCentsFor(p, left))
                : refundCentsFor(p, asked)
            // The buyer's own currency, approximate, when they paid in one; else the purchase's.
            const own =
              mode === "all" || !open
                ? p.presentmentCurrency &&
                  p.refundablePresentmentCents !== undefined
                  ? {
                      cents: p.refundablePresentmentCents,
                      currency: p.presentmentCurrency,
                    }
                  : null
                : presentmentCentsFor(p, back)
            const backText = own
              ? money(own.cents, own.currency)
              : money(back, p.currency)
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
                        ? fill(
                            own ? labels.refundableApprox : labels.refundable,
                            { tokens: units(left), money: backText },
                          )
                        : labels.nothingToRefund}
                    </span>
                  )}
                  {open ? (
                    <span className={part(styling, "confirm")}>
                      <span
                        className={part(styling, "segmented")}
                        role="group"
                        aria-label={labels.refundHow}
                      >
                        {(["all", "part"] as const).map((m) => (
                          <button
                            key={m}
                            type="button"
                            className={part(styling, "segment")}
                            aria-pressed={mode === m}
                            onClick={() => {
                              key.current = null
                              setProblem(null)
                              setMode(m)
                            }}
                          >
                            {m === "all" ? labels.refundAll : labels.refundPart}
                          </button>
                        ))}
                      </span>
                      {mode === "part" ? (
                        <Field
                          label={fill(labels.refundAmount, {
                            unit: unit.many,
                          })}
                          required
                          styling={styling}
                        >
                          {(f) => (
                            <input
                              {...f}
                              className={part(styling, "input")}
                              type="text"
                              inputMode="decimal"
                              autoComplete="off"
                              value={amount}
                              onChange={(e) => {
                                key.current = null
                                setAmount(e.target.value)
                              }}
                            />
                          )}
                        </Field>
                      ) : null}
                      <span role="alertdialog" aria-label={labels.refund}>
                        {fill(
                          own
                            ? labels.refundConfirmApprox
                            : labels.refundConfirm,
                          { tokens: units(asked), money: backText },
                        )}
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
                            : fill(
                                own
                                  ? labels.refundConfirmButtonApprox
                                  : labels.refundConfirmButton,
                                { money: backText },
                              )}
                        </button>
                        <button
                          type="button"
                          className={part(
                            styling,
                            "button",
                            "tk-button--quiet",
                          )}
                          onClick={() => {
                            clearTimeout(retry.current)
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
                        setMode("all")
                        setAmount("")
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
