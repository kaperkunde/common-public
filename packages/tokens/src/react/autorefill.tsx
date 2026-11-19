"use client"

import { useEffect, useState, type FormEvent } from "react"

import type {
  AppUnit,
  AutoRefill as AutoRefillState,
  AutoRefillInput,
  Currency,
} from "../types"
import { formatMoney, microsOf, unitsOf } from "../units"
import {
  refreshTokens,
  useAppInfo,
  useAutoRefill,
  useLabels,
  useLocale,
  useTokenApi,
} from "./hooks"
import { type LabelOverrides } from "./labels"
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

export type AutoRefillProps = Styling & {
  /** Current settings; loaded when not given. */
  value?: AutoRefillState
  unit?: AppUnit
  /** Save yourself; default `PUT`s to the app's route. */
  onSave?: (input: AutoRefillInput) => Promise<unknown>
  /** Open the card form; default asks the app's route for a Stripe setup session and goes there. */
  onAddCard?: () => Promise<unknown>
  onRemoveCard?: () => Promise<unknown>
  /** A path on the app to come back to after saving a card. */
  returnPath?: string
  onRedirect?: (url: string) => void
  currencies?: Currency[]
  labels?: LabelOverrides
  basePath?: string
}

const major = (cents: number) => (cents / 100).toString()
const toCents = (text: string) =>
  Math.round(Number(text.replace(",", ".")) * 100)

/** Auto-refill: a switch, the threshold, the amount, the monthly maximum, and the card on file. */
export function AutoRefill(props: AutoRefillProps) {
  const labels = useLabels(props.labels)
  const locale = useLocale()
  const api = useTokenApi(props.basePath)
  const styling: Styling = props
  const loaded = useAutoRefill({
    basePath: props.basePath,
    skip: props.value !== undefined,
  })
  const app = useAppInfo({
    basePath: props.basePath,
    skip: props.unit !== undefined,
  })
  const value = props.value ?? loaded.data
  const unit = props.unit ??
    app.data?.unit ?? { one: "token", many: "tokens", perDollar: 1_000_000 }

  const [enabled, setEnabled] = useState(false)
  const [threshold, setThreshold] = useState("")
  const [amount, setAmount] = useState("")
  const [currency, setCurrency] = useState<Currency>("eur")
  const [monthly, setMonthly] = useState("")
  const [seeded, setSeeded] = useState<AutoRefillState | undefined>()
  const [problem, setProblem] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const save = useAction(labels)
  const card = useAction(labels)

  useEffect(() => {
    if (!value || value === seeded) return
    setSeeded(value)
    setEnabled(value.enabled)
    setThreshold(String(unitsOf(value.thresholdMicros, unit)))
    setAmount(major(value.amountCents))
    setCurrency(value.currency)
    setMonthly(major(value.monthlyMaxCents))
  }, [value, seeded, unit])

  if (!value)
    return (
      <Panel title={labels.autoRefillTitle} styling={styling}>
        {loaded.error ? (
          <Notice styling={styling}>{labels.unavailable}</Notice>
        ) : (
          <p className="tk-muted">{labels.loading}</p>
        )}
      </Panel>
    )

  async function submit(event: FormEvent) {
    event.preventDefault()
    setDone(false)
    setProblem(null)
    const need = stillNeeded(labels, [
      {
        label: labels.threshold,
        filled: threshold.trim() !== "" && Number(threshold) >= 0,
      },
      { label: labels.refillAmount, filled: toCents(amount) > 0 },
      { label: labels.monthlyMax, filled: toCents(monthly) > 0 },
    ])
    if (need) return setProblem(need)
    if (enabled && !value!.card) return setProblem(labels.needCardFirst)
    const input: AutoRefillInput = {
      enabled,
      thresholdMicros: microsOf(Number(threshold), unit),
      amountCents: toCents(amount),
      currency,
      monthlyMaxCents: toCents(monthly),
    }
    const out = await save.run(() =>
      props.onSave ? props.onSave(input) : api.setAutoRefill(input),
    )
    if (out !== undefined) {
      setDone(true)
      loaded.refresh()
      refreshTokens()
    }
  }

  async function addCard() {
    await card.run(async () => {
      if (props.onAddCard) return void (await props.onAddCard())
      const session = await api.setupCard({
        currency,
        ...(props.returnPath ? { returnPath: props.returnPath } : {}),
      })
      if (props.onRedirect) props.onRedirect(session.url)
      else window.location.assign(session.url)
    })
  }

  async function removeCard() {
    const out = await card.run(async () => {
      await (props.onRemoveCard ? props.onRemoveCard() : api.removeCard())
      return true
    })
    if (out) {
      loaded.refresh()
      refreshTokens()
    }
  }

  const currencies = props.currencies ?? (["eur", "usd"] as Currency[])
  return (
    <Panel title={labels.autoRefillTitle} styling={styling}>
      <p className="tk-muted">{labels.autoRefillHelp}</p>
      {value.failedAt && !value.enabled ? (
        <Notice styling={styling}>{labels.autoRefillFailed}</Notice>
      ) : null}
      <form className={part(styling, "form")} onSubmit={submit} noValidate>
        <label className={part(styling, "switch")}>
          <input
            type="checkbox"
            role="switch"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />{" "}
          {labels.autoRefillOn}
        </label>
        <Field label={labels.threshold} required styling={styling}>
          {(p) => (
            <input
              {...p}
              className={part(styling, "input")}
              type="number"
              inputMode="numeric"
              min="0"
              step="1"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
            />
          )}
        </Field>
        {currencies.length > 1 ? (
          <Segmented<Currency>
            label={labels.currency}
            value={currency}
            options={currencies.map((c) => ({
              value: c,
              label: c.toUpperCase(),
            }))}
            onChange={setCurrency}
            styling={styling}
          />
        ) : null}
        <Field
          label={`${labels.refillAmount} (${currency.toUpperCase()})`}
          required
          styling={styling}
        >
          {(p) => (
            <input
              {...p}
              className={part(styling, "input")}
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          )}
        </Field>
        <Field
          label={`${labels.monthlyMax} (${currency.toUpperCase()})`}
          required
          styling={styling}
        >
          {(p) => (
            <input
              {...p}
              className={part(styling, "input")}
              type="text"
              inputMode="decimal"
              value={monthly}
              onChange={(e) => setMonthly(e.target.value)}
            />
          )}
        </Field>
        <div className={part(styling, "field")}>
          <span className={part(styling, "label")}>{labels.card}</span>
          <p className="tk-card">
            {value.card ? value.card.label : labels.noCard}
          </p>
          <div className={part(styling, "actions")}>
            <button
              type="button"
              className={part(styling, "button")}
              onClick={addCard}
              aria-busy={card.pending}
            >
              {value.card ? labels.replaceCard : labels.addCard}
            </button>
            {value.card ? (
              <button
                type="button"
                className={part(styling, "button", "tk-button--quiet")}
                onClick={removeCard}
                aria-busy={card.pending}
              >
                {labels.removeCard}
              </button>
            ) : null}
          </div>
          {card.error ? <Notice styling={styling}>{card.error}</Notice> : null}
        </div>
        {value.card ? (
          <p className="tk-muted">
            {formatMoney(toCents(amount) || 0, currency, locale)} /{" "}
            {formatMoney(toCents(monthly) || 0, currency, locale)}
          </p>
        ) : null}
        {problem ? <Notice styling={styling}>{problem}</Notice> : null}
        {save.error ? <Notice styling={styling}>{save.error}</Notice> : null}
        {done ? (
          <Notice kind="ok" styling={styling}>
            {labels.saved}
          </Notice>
        ) : null}
        <div className={part(styling, "actions")}>
          <button
            type="submit"
            className={part(styling, "button", "tk-button--primary")}
            aria-busy={save.pending}
            disabled={save.pending}
          >
            {save.pending ? labels.saving : labels.save}
          </button>
        </div>
      </form>
    </Panel>
  )
}
