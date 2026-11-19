"use client"

import { useState, type FormEvent } from "react"

import type { CheckoutInput } from "../browser-api"
import type { AppUnit, CheckoutSession, Currency } from "../types"
import { creditFor, formatMoney, formatUnits } from "../units"
import {
  refreshTokens,
  useAppInfo,
  useLabels,
  useLocale,
  useSalePrices,
  useTokenApi,
} from "./hooks"
import { fill, type LabelOverrides } from "./labels"
import {
  Field,
  Notice,
  Panel,
  Segmented,
  part,
  stillNeeded,
  useAction,
  type Styling,
} from "./ui"

export type BuyTokensProps = Styling & {
  /** The packs on offer, in cents of the chosen currency. Default 5, 10, 25, 50. */
  amounts?: number[]
  /** Offer a free amount as well. Default true. */
  allowOther?: boolean
  /** Currencies on offer (those the center has a price for). Default: all of them. */
  currencies?: Currency[]
  defaultCurrency?: Currency
  /** A path on the app to come back to after paying (default `/`). */
  returnPath?: string
  /** Offer "save my card for auto-refill". Default true. */
  offerSaveCard?: boolean
  /** The app's unit, to say what an amount buys; read from the center if not given. */
  unit?: AppUnit
  /** Start the checkout yourself; default posts to the app's mounted route. */
  onCheckout?: (input: CheckoutInput) => Promise<Pick<CheckoutSession, "url">>
  /** Where to send the browser; default `location.assign`. */
  onRedirect?: (url: string) => void
  labels?: LabelOverrides
  basePath?: string
}

const DEFAULT_AMOUNTS = [500, 1000, 2500, 5000]

/** Choose an amount and a currency, start Stripe Checkout through the app's route, and go there. */
export function BuyTokens(props: BuyTokensProps) {
  const labels = useLabels(props.labels)
  const locale = useLocale()
  const api = useTokenApi(props.basePath)
  const styling: Styling = props
  const prices = useSalePrices({ basePath: props.basePath })
  const app = useAppInfo({
    basePath: props.basePath,
    skip: props.unit !== undefined,
  })
  const unit = props.unit ?? app.data?.unit
  const available = (prices.data?.prices ?? []).filter(
    (p) => !props.currencies || props.currencies.includes(p.currency),
  )
  const [currencyChoice, setCurrency] = useState<Currency | null>(
    props.defaultCurrency ?? null,
  )
  const currency = available.find((p) => p.currency === currencyChoice)
    ? currencyChoice
    : (available[0]?.currency ?? null)
  const price = available.find((p) => p.currency === currency)
  // The app's packs and bounds come from the center (SalePrices.options); `amounts`
  // narrows or overrides the packs, but under packsOnly only a pack can be bought.
  const options = prices.data?.options
  const packsOnly = options?.packsOnly === true
  const offered =
    props.amounts ??
    (options?.packsCents.length ? options.packsCents : DEFAULT_AMOUNTS)
  const amounts = packsOnly
    ? offered.filter((a) => options!.packsCents.includes(a))
    : offered
  const allowOther = props.allowOther !== false && !packsOnly
  const [chosen, setChosen] = useState<number | "other" | null>(
    amounts[1] ?? amounts[0] ?? null,
  )
  const [other, setOther] = useState("")
  const [saveCard, setSaveCard] = useState(false)
  const action = useAction(labels)
  const [problem, setProblem] = useState<string | null>(null)

  const otherCents = Math.round(Number(other.replace(",", ".")) * 100)
  const cents =
    chosen === "other" ? (Number.isFinite(otherCents) ? otherCents : 0) : chosen
  const needed = stillNeeded(labels, [
    { label: labels.amount, filled: cents !== null && cents > 0 },
  ])
  const minimum = Math.max(price?.minimumCents ?? 0, options?.minimumCents ?? 0)
  const maximum = options?.maximumCents ?? Infinity

  // Disabled only when the center says it cannot take payments, and then the reason is on
  // screen beside it (the notice above); an unfilled field is still answered by the press.
  const paymentsOff = Boolean(prices.data && !prices.data.paymentsAvailable)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (paymentsOff) return
    setProblem(null)
    if (needed) return setProblem(needed)
    if (!currency || !price) return setProblem(labels.paymentsUnavailable)
    if (cents! > maximum)
      return setProblem(
        fill(labels.maximum, { money: formatMoney(maximum, currency, locale) }),
      )
    if (cents! < minimum)
      return setProblem(
        fill(labels.minimum, { money: formatMoney(minimum, currency, locale) }),
      )
    const input: CheckoutInput = {
      currency,
      amountCents: cents!,
      ...(saveCard ? { saveCard: true } : {}),
      ...(props.returnPath ? { returnPath: props.returnPath } : {}),
      ...(locale ? { locale } : {}),
    }
    const session = await action.run(() =>
      props.onCheckout
        ? props.onCheckout(input)
        : api.checkout(input, crypto.randomUUID()),
    )
    if (session) {
      refreshTokens()
      if (props.onRedirect) props.onRedirect(session.url)
      else window.location.assign(session.url)
    }
  }

  return (
    <Panel title={labels.buyTitle} styling={styling}>
      {paymentsOff ? (
        <Notice kind="info" styling={styling}>
          {labels.paymentsUnavailable}
        </Notice>
      ) : null}
      {prices.error ? (
        <Notice styling={styling}>{labels.unavailable}</Notice>
      ) : null}
      <form className={part(styling, "form")} onSubmit={submit} noValidate>
        {available.length > 1 && currency ? (
          <Segmented<Currency>
            label={labels.currency}
            value={currency}
            options={available.map((p) => ({
              value: p.currency,
              label: p.currency.toUpperCase(),
            }))}
            onChange={setCurrency}
            styling={styling}
          />
        ) : null}
        <Segmented<number | "other">
          label={labels.amount}
          value={chosen}
          options={[
            ...amounts.map((a) => ({
              value: a as number | "other",
              label: formatMoney(a, currency ?? "eur", locale),
            })),
            ...(!allowOther
              ? []
              : [{ value: "other" as const, label: labels.otherAmount }]),
          ]}
          onChange={setChosen}
          styling={styling}
        />
        {chosen === "other" ? (
          <Field label={labels.otherAmount} required styling={styling}>
            {(p) => (
              <input
                {...p}
                className={part(styling, "input")}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={other}
                onChange={(e) => setOther(e.target.value)}
              />
            )}
          </Field>
        ) : null}
        {price && cents && cents > 0 && unit ? (
          <p className="tk-muted" aria-live="polite">
            {fill(labels.buys, {
              money: formatMoney(cents, price.currency, locale),
              tokens: formatUnits(Math.max(0, creditFor(cents, price)), unit, {
                locale,
              }),
            })}{" "}
            {labels.tax[price.taxBehavior]}
          </p>
        ) : null}
        {props.offerSaveCard === false ? null : (
          <label className={part(styling, "check")}>
            <input
              type="checkbox"
              checked={saveCard}
              onChange={(e) => setSaveCard(e.target.checked)}
            />{" "}
            {labels.saveCard}
          </label>
        )}
        {problem ? <Notice styling={styling}>{problem}</Notice> : null}
        {action.error ? (
          <Notice styling={styling}>{action.error}</Notice>
        ) : null}
        <div className={part(styling, "actions")}>
          <button
            type="submit"
            className={part(styling, "button", "tk-button--primary")}
            aria-busy={action.pending}
            disabled={action.pending || paymentsOff}
            title={paymentsOff ? labels.paymentsUnavailable : undefined}
          >
            {action.pending
              ? labels.buying
              : cents && cents > 0 && currency
                ? fill(labels.buyButton, {
                    amount: formatMoney(cents, currency, locale),
                  })
                : labels.buyButtonBare}
          </button>
        </div>
      </form>
    </Panel>
  )
}
