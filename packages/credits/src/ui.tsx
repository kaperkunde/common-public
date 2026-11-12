"use client"

/**
 * The screens credits need, on `@kaperkunde/ui`: a user's card (balance, when free credits
 * expire, buying, auto-refill, history) and the admin's panels (model prices, credits per
 * dollar, the free pool and the allotment, grants). Each takes its data and callbacks as props
 * and fetches nothing; a callback answers an error in words, or nothing when it went through.
 */

import { useState, type FormEvent, type ReactNode } from "react"

import { Badge } from "@kaperkunde/ui/badge"
import { Button } from "@kaperkunde/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@kaperkunde/ui/card"
import { FormStatus } from "@kaperkunde/ui/form-status"
import { Input, Select } from "@kaperkunde/ui/input"
import { Field } from "@kaperkunde/ui/label"
import { List, ListRow, RowValue } from "@kaperkunde/ui/list"
import { SwitchRow } from "@kaperkunde/ui/switch"

import { balanceText, freeCreditsText, type CreditBalance } from "./balance"
import {
  amountProblem,
  autorefillProblem,
  creditsFor,
  moneyText,
  parseAmount,
  purchaseStatusText,
  salePriceInForce,
  taxText,
  type Currencies,
  type SalePrice,
} from "./billing"
import { grantLine, grantProblem, signedCreditsText } from "./grants"
import {
  allotmentsCovered,
  dollarsText,
  forecastText,
  poolLeftUsd,
  poolLevelText,
} from "./pool"
import {
  priceText,
  rateInForce,
  type DollarRate,
  type ModelPrice,
} from "./pricing"
import type { AutorefillRow, GrantRow, PoolStatus, PurchaseRow } from "./store"
import {
  DEFAULT_UNIT,
  countText,
  creditsText,
  dayText,
  type CreditUnit,
} from "./units"

/** A callback's answer: an error in words, or nothing when it went through. */
type Outcome = Promise<string | undefined | void>

const useSubmit = () => {
  const [error, setError] = useState<string>()
  const [message, setMessage] = useState<string>()
  const [busy, setBusy] = useState(false)
  const run = async (work: () => Outcome, done?: string) => {
    setBusy(true)
    setError(undefined)
    setMessage(undefined)
    try {
      const failed = await work()
      if (failed) setError(failed)
      else if (done) setMessage(done)
    } catch (thrown) {
      setError((thrown as Error).message || "That did not go through.")
    } finally {
      setBusy(false)
    }
  }
  return { error, message, busy, run, setError }
}

const prevent = (submit: () => void) => (event: FormEvent) => {
  event.preventDefault()
  submit()
}

/** One line of a user's history: a purchase, a refill or a grant. */
export type HistoryEntry =
  | { type: "purchase"; purchase: PurchaseRow }
  | {
      type: "grant"
      grant: Pick<GrantRow, "id" | "amount" | "reason" | "createdAt">
    }

const entryAt = (entry: HistoryEntry) =>
  entry.type === "purchase" ? entry.purchase.createdAt : entry.grant.createdAt

/** A user's credits: the balance, buying, auto-refill and the history. */
export function CreditsCard({
  unit = DEFAULT_UNIT,
  balance,
  currencies,
  salePrices,
  history = [],
  autorefill,
  stripeEnabled,
  onBuy,
  onSaveAutorefill,
  onSaveCard,
  title,
  now = new Date(),
}: {
  unit?: CreditUnit
  balance?: CreditBalance
  currencies: Currencies
  salePrices: readonly SalePrice[]
  history?: readonly HistoryEntry[]
  autorefill?: AutorefillRow
  /** Whether anything is sold here at all. */
  stripeEnabled: boolean
  /** Starts a purchase; the app sends the user to the URL it answers. */
  onBuy: (input: {
    currency: string
    amountCents: number
    saveCard: boolean
  }) => Outcome
  onSaveAutorefill: (settings: {
    enabled: boolean
    thresholdCredits: number
    amountCents: number
    currency: string
    monthlyMaxCents: number
  }) => Outcome
  /** Starts saving a card for auto-refill. */
  onSaveCard: (currency: string) => Outcome
  title?: ReactNode
  now?: Date
}) {
  const codes = Object.keys(currencies)
  const [currency, setCurrency] = useState(
    autorefill?.currency ?? codes[0] ?? "eur",
  )
  const [amount, setAmount] = useState("5")
  const [saveCard, setSaveCard] = useState(false)
  const buying = useSubmit()
  const cents = parseAmount(amount)
  const price = salePriceInForce(salePrices, currency, now)
  const buys =
    cents !== undefined && price
      ? creditsFor(cents, price.centsPerMillion)
      : undefined

  const [refill, setRefill] = useState({
    enabled: autorefill?.enabled ?? false,
    threshold: String(autorefill?.thresholdCredits ?? 100000),
    amount: String((autorefill?.amountCents ?? 500) / 100),
    max: String((autorefill?.monthlyMaxCents ?? 2000) / 100),
  })
  const refilling = useSubmit()

  const buy = () =>
    buying.run(async () => {
      const problem = amountProblem(cents, currency)
      if (problem) return problem
      return onBuy({ currency, amountCents: cents as number, saveCard })
    })

  const saveRefill = () =>
    refilling.run(async () => {
      const settings = {
        enabled: refill.enabled,
        thresholdCredits: Number(refill.threshold.replace(/[\s,_]/g, "")),
        amountCents: parseAmount(refill.amount) as number,
        currency,
        monthlyMaxCents: parseAmount(refill.max) as number,
      }
      const problem = autorefillProblem(settings, unit)
      if (problem) return problem
      return onSaveAutorefill(settings)
    }, "Saved.")

  const sorted = [...history].sort((a, b) =>
    entryAt(b).localeCompare(entryAt(a)),
  )

  return (
    <Card data-slot="credits-card">
      <CardHeader>
        <CardTitle>{title ?? `Your ${unit.many}`}</CardTitle>
        <CardDescription>
          {balance ? balanceText(balance, unit, now) : `No ${unit.many} yet.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <p className="text-sm text-muted-foreground">
          {freeCreditsText(balance, unit, now)}
        </p>

        {stripeEnabled ? (
          <form
            onSubmit={prevent(buy)}
            className="flex flex-col gap-3"
            aria-label={`Buy ${unit.many}`}
          >
            <h3 className="font-medium">Buy {unit.many}</h3>
            <div className="flex flex-wrap gap-3">
              <Field
                label="Amount"
                htmlFor="credits-amount"
                hint={taxText(currencies[currency] ?? "inclusive")}
              >
                <Input
                  id="credits-amount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </Field>
              {codes.length > 1 ? (
                <Field label="Currency" htmlFor="credits-currency">
                  <Select
                    id="credits-currency"
                    value={currency}
                    onChange={(event) => setCurrency(event.target.value)}
                  >
                    {codes.map((code) => (
                      <option key={code} value={code}>
                        {code.toUpperCase()}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
            </div>
            <p className="text-sm">
              {buys !== undefined && cents !== undefined
                ? `${moneyText(cents, currency)} buys ${creditsText(buys, unit)}. Bought ${unit.many} never expire.`
                : price
                  ? "Type an amount, like 5 or 12.50."
                  : `${unit.many[0]?.toUpperCase()}${unit.many.slice(1)} have no price in ${currency.toUpperCase()} yet.`}
            </p>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={saveCard}
                onChange={(event) => setSaveCard(event.target.checked)}
              />
              Save the card for automatic refills
            </label>
            <div>
              <Button type="submit" disabled={buying.busy || !price}>
                Buy
              </Button>
            </div>
            <FormStatus error={buying.error} message={buying.message} />
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">
            {unit.many[0]?.toUpperCase()}
            {unit.many.slice(1)} cannot be bought here yet.
          </p>
        )}

        {stripeEnabled ? (
          <form
            onSubmit={prevent(saveRefill)}
            className="flex flex-col gap-3"
            aria-label="Auto-refill"
          >
            <h3 className="font-medium">Auto-refill</h3>
            <List>
              <SwitchRow
                id="credits-autorefill"
                label="Refill automatically"
                description={
                  autorefill?.paymentMethodLabel
                    ? `Charged to ${autorefill.paymentMethodLabel}, once your free ${unit.many} are gone.`
                    : "Save a card first."
                }
                checked={refill.enabled}
                onChange={(event) =>
                  setRefill({ ...refill, enabled: event.target.checked })
                }
              />
            </List>
            {autorefill?.failedAt ? (
              <p className="text-sm text-destructive">
                The last refill could not be charged on{" "}
                {dayText(autorefill.failedAt)}, so auto-refill turned itself
                off.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-3">
              <Field label={`Below (${unit.many})`} htmlFor="credits-threshold">
                <Input
                  id="credits-threshold"
                  inputMode="numeric"
                  value={refill.threshold}
                  onChange={(event) =>
                    setRefill({ ...refill, threshold: event.target.value })
                  }
                />
              </Field>
              <Field label="Buy" htmlFor="credits-refill-amount">
                <Input
                  id="credits-refill-amount"
                  inputMode="decimal"
                  value={refill.amount}
                  onChange={(event) =>
                    setRefill({ ...refill, amount: event.target.value })
                  }
                />
              </Field>
              <Field label="At most a month" htmlFor="credits-refill-max">
                <Input
                  id="credits-refill-max"
                  inputMode="decimal"
                  value={refill.max}
                  onChange={(event) =>
                    setRefill({ ...refill, max: event.target.value })
                  }
                />
              </Field>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={refilling.busy}>
                Save
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => refilling.run(() => onSaveCard(currency))}
              >
                {autorefill?.paymentMethodLabel
                  ? "Use another card"
                  : "Save a card"}
              </Button>
            </div>
            <FormStatus error={refilling.error} message={refilling.message} />
          </form>
        ) : null}

        <section className="flex flex-col gap-2" aria-label="History">
          <h3 className="font-medium">History</h3>
          {sorted.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing bought or granted yet.
            </p>
          ) : (
            <List>
              {sorted.map((entry) =>
                entry.type === "purchase" ? (
                  <ListRow key={`p${entry.purchase.id}`}>
                    <span>
                      {entry.purchase.kind === "refill"
                        ? "Auto-refill"
                        : "Bought"}{" "}
                      {creditsText(entry.purchase.credits, unit)} ·{" "}
                      {purchaseStatusText(entry.purchase, now)}
                    </span>
                    <RowValue>
                      {moneyText(
                        entry.purchase.totalCents ?? entry.purchase.amountCents,
                        entry.purchase.currency,
                      )}{" "}
                      · {dayText(entry.purchase.createdAt)}
                    </RowValue>
                  </ListRow>
                ) : (
                  <ListRow key={`g${entry.grant.id}`}>
                    <span>
                      {grantLine(entry.grant.amount, entry.grant.reason)}
                    </span>
                    <RowValue>
                      {signedCreditsText(entry.grant.amount, unit)} ·{" "}
                      {dayText(entry.grant.createdAt)}
                    </RowValue>
                  </ListRow>
                ),
              )}
            </List>
          )}
        </section>
      </CardContent>
    </Card>
  )
}

/** The kinds the price form asks for, in order; an app may add its own (`tts_chars`). */
export const PRICE_FORM_KINDS: readonly {
  kind: string
  label: string
  unit: string
  optional?: boolean
}[] = [
  { kind: "input", label: "Input", unit: "token" },
  { kind: "output", label: "Output", unit: "token" },
  { kind: "cache_read", label: "Cache reads", unit: "token", optional: true },
  {
    kind: "cache_write",
    label: "Cache writes (5 min)",
    unit: "token",
    optional: true,
  },
  {
    kind: "cache_write_1h",
    label: "Cache writes (1 h)",
    unit: "token",
    optional: true,
  },
]

/** The admin's model prices: each model offered, its price in force, and a form to set one. */
export function ModelPricesPanel({
  models,
  prices,
  perDollar,
  unit = DEFAULT_UNIT,
  kinds = PRICE_FORM_KINDS,
  onSetPrice,
  now = new Date(),
}: {
  /** The models the app offers, priced or not. */
  models: readonly string[]
  prices: readonly ModelPrice[]
  perDollar?: number
  unit?: CreditUnit
  kinds?: typeof PRICE_FORM_KINDS
  onSetPrice: (price: {
    model: string
    kinds: { kind: string; unit: string; usdPerMillion: number }[]
  }) => Outcome
  now?: Date
}) {
  const [editing, setEditing] = useState<string>()
  const [values, setValues] = useState<Record<string, string>>({})
  const submit = useSubmit()
  const inForce = (model: string) =>
    prices
      .filter(
        (price) =>
          price.model === model && new Date(price.effectiveFrom) <= now,
      )
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]

  const save = (model: string) =>
    submit.run(async () => {
      const set = kinds.flatMap((kind) => {
        const raw = values[kind.kind]?.trim()
        if (!raw) return []
        return [
          { kind: kind.kind, unit: kind.unit, usdPerMillion: Number(raw) },
        ]
      })
      const missing = kinds.find(
        (kind) => !kind.optional && !set.some((one) => one.kind === kind.kind),
      )
      if (missing) return `${missing.label} needs a price.`
      if (
        set.some(
          (one) => !Number.isFinite(one.usdPerMillion) || one.usdPerMillion < 0,
        )
      ) {
        return "A price is a number of dollars, zero or more."
      }
      const failed = await onSetPrice({ model, kinds: set })
      if (!failed) setEditing(undefined)
      return failed
    }, "Price set from now.")

  return (
    <Card data-slot="model-prices">
      <CardHeader>
        <CardTitle>Models and prices</CardTitle>
        <CardDescription>
          US dollars per million units. A model with no price is never used. A
          new price applies from now; calls already made keep theirs.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <List>
          {models.map((model) => {
            const price = inForce(model)
            return (
              <ListRow key={model}>
                <span className="flex flex-col gap-0.5">
                  <span className="font-medium">{model}</span>
                  <span className="text-xs text-muted-foreground">
                    {price ? priceText(price) : "Not priced: never used."}
                    {price && perDollar
                      ? ` · ${creditsText(Math.round(((price.kinds.find((k) => k.kind === "output")?.usdPerMillion ?? 0) * perDollar) / 1e6), unit)} an output token`
                      : ""}
                  </span>
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEditing(model)
                    setValues(
                      Object.fromEntries(
                        (price?.kinds ?? []).map((kind) => [
                          kind.kind,
                          String(kind.usdPerMillion),
                        ]),
                      ),
                    )
                  }}
                >
                  Set price
                </Button>
              </ListRow>
            )
          })}
        </List>
        {editing ? (
          <form
            onSubmit={prevent(() => save(editing))}
            className="flex flex-col gap-3"
            aria-label={`Price of ${editing}`}
          >
            <h3 className="font-medium">{editing}</h3>
            <div className="flex flex-wrap gap-3">
              {kinds.map((kind) => (
                <Field
                  key={kind.kind}
                  label={kind.label}
                  htmlFor={`price-${kind.kind}`}
                  hint={
                    kind.optional
                      ? "Empty: the usual multiple of input"
                      : undefined
                  }
                  required={!kind.optional}
                >
                  <Input
                    id={`price-${kind.kind}`}
                    inputMode="decimal"
                    value={values[kind.kind] ?? ""}
                    onChange={(event) =>
                      setValues({ ...values, [kind.kind]: event.target.value })
                    }
                  />
                </Field>
              ))}
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={submit.busy}>
                Save
              </Button>
              <Button
                type="button"
                variant="plain"
                onClick={() => setEditing(undefined)}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : null}
        <FormStatus error={submit.error} message={submit.message} />
      </CardContent>
    </Card>
  )
}

/** The one ratio: credits per US dollar, with its history. */
export function RatioPanel({
  rates,
  unit = DEFAULT_UNIT,
  onSetRatio,
  now = new Date(),
}: {
  rates: readonly DollarRate[]
  unit?: CreditUnit
  onSetRatio: (perDollar: number) => Outcome
  now?: Date
}) {
  const current = rateInForce(rates, now)
  const [value, setValue] = useState(String(current?.perDollar ?? ""))
  const submit = useSubmit()
  return (
    <Card data-slot="credit-ratio">
      <CardHeader>
        <CardTitle>{`${unit.many[0]?.toUpperCase()}${unit.many.slice(1)} per dollar`}</CardTitle>
        <CardDescription>
          {current
            ? `${creditsText(current.perDollar, unit)} to the dollar, since ${dayText(current.effectiveFrom)}.`
            : `Not set: nothing can be charged until it is.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={prevent(() =>
            submit.run(async () => {
              const perDollar = Number(value.replace(/[\s,_]/g, ""))
              if (!(perDollar > 0)) return "A ratio is a number above zero."
              return onSetRatio(perDollar)
            }, "Set from now."),
          )}
        >
          <Field label={`${unit.many} per dollar`} htmlFor="credit-ratio">
            <Input
              id="credit-ratio"
              inputMode="numeric"
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          </Field>
          <Button type="submit" disabled={submit.busy}>
            Save
          </Button>
        </form>
        <FormStatus error={submit.error} message={submit.message} />
      </CardContent>
    </Card>
  )
}

/** The free pool: the month's budget and where it stands, and the allotment per user. */
export function FreePoolPanel({
  status,
  unit = DEFAULT_UNIT,
  onSetBudget,
  onSetAllotment,
  providerName = "The provider",
  now = new Date(),
}: {
  status: PoolStatus
  unit?: CreditUnit
  onSetBudget: (budgetUsd: number) => Outcome
  onSetAllotment: (allotment: number) => Outcome
  providerName?: string
  now?: Date
}) {
  const [budget, setBudget] = useState(String(status.budgetUsd ?? ""))
  const [allotment, setAllotment] = useState(String(status.allotment))
  const submit = useSubmit()
  const left =
    status.budgetUsd !== undefined
      ? poolLeftUsd(status.budgetUsd, status.use)
      : undefined
  const forecast =
    status.budgetUsd !== undefined
      ? forecastText(status.budgetUsd, status.use, status.period, now)
      : undefined
  return (
    <Card data-slot="free-pool">
      <CardHeader>
        <CardTitle>{`Free ${unit.many}`}</CardTitle>
        <CardDescription>
          {poolLevelText(status.budgetUsd, status.use, unit)}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <List>
          <ListRow>
            <span>Handed out this month</span>
            <RowValue>
              {creditsText(status.use.grantedCredits, unit)} (
              {dollarsText(status.use.grantedUsd)}) to {countText(status.users)}{" "}
              {status.users === 1 ? "user" : "users"}
            </RowValue>
          </ListRow>
          <ListRow>
            <span>Overdrawn</span>
            <RowValue>{dollarsText(status.use.overdraftUsd)}</RowValue>
          </ListRow>
          <ListRow>
            <span>Spent of free and of bought</span>
            <RowValue>
              {dollarsText(status.freeSpentUsd)} ·{" "}
              {dollarsText(status.boughtSpentUsd)}
            </RowValue>
          </ListRow>
          {status.providerUsd !== undefined ? (
            <ListRow>
              <span>{providerName}&apos;s figure for the month</span>
              <RowValue>
                {dollarsText(status.providerUsd)}
                {status.use.driftFactor > 1 ? (
                  <Badge className="ml-2">{`×${status.use.driftFactor.toFixed(3)}`}</Badge>
                ) : null}
              </RowValue>
            </ListRow>
          ) : null}
          {left !== undefined ? (
            <ListRow>
              <span>Left</span>
              <RowValue>{dollarsText(left)}</RowValue>
            </ListRow>
          ) : null}
          <ListRow>
            <span>Granted by an admin this month</span>
            <RowValue>
              {signedCreditsText(status.grantedByAdmin, unit)}
            </RowValue>
          </ListRow>
        </List>
        {forecast ? (
          <p className="text-sm text-muted-foreground">{forecast}</p>
        ) : null}
        {status.budgetUsd !== undefined && status.perDollar > 0 ? (
          <p className="text-sm text-muted-foreground">
            The budget covers{" "}
            {countText(
              allotmentsCovered(
                status.budgetUsd,
                status.allotment,
                status.perDollar,
              ),
            )}{" "}
            full allotments.
          </p>
        ) : null}
        <form
          className="flex flex-wrap items-end gap-3"
          aria-label="Budget and allotment"
          onSubmit={prevent(() =>
            submit.run(async () => {
              const usd = Number(budget)
              const most = Number(allotment.replace(/[\s,_]/g, ""))
              if (!(usd >= 0) || budget.trim() === "")
                return "A budget is a number of dollars, zero or more."
              if (!Number.isSafeInteger(most) || most < 0)
                return `An allotment is a whole number of ${unit.many}.`
              if (usd !== status.budgetUsd) {
                const failed = await onSetBudget(usd)
                if (failed) return failed
              }
              if (most !== status.allotment) return onSetAllotment(most)
            }, "Saved."),
          )}
        >
          <Field label="Budget a month (US dollars)" htmlFor="pool-budget">
            <Input
              id="pool-budget"
              inputMode="decimal"
              value={budget}
              onChange={(event) => setBudget(event.target.value)}
            />
          </Field>
          <Field
            label={`Most per user a month (${unit.many})`}
            htmlFor="pool-allotment"
          >
            <Input
              id="pool-allotment"
              inputMode="numeric"
              value={allotment}
              onChange={(event) => setAllotment(event.target.value)}
            />
          </Field>
          <Button type="submit" disabled={submit.busy}>
            Save
          </Button>
        </form>
        <FormStatus error={submit.error} message={submit.message} />
      </CardContent>
    </Card>
  )
}

/** The admin granting credits, or taking some back, and the latest grants. */
export function GrantsPanel({
  grants,
  unit = DEFAULT_UNIT,
  nameOf = (userId) => userId,
  onGrant,
}: {
  grants: readonly GrantRow[]
  unit?: CreditUnit
  /** How a user is named in the list. */
  nameOf?: (userId: string) => string
  /** `who` as typed: a name or an address, the app's to look up. */
  onGrant: (grant: { who: string; amount: string; reason: string }) => Outcome
}) {
  const [form, setForm] = useState({ who: "", amount: "", reason: "" })
  const submit = useSubmit()
  return (
    <Card data-slot="credit-grants">
      <CardHeader>
        <CardTitle>{`Grant ${unit.many}`}</CardTitle>
        <CardDescription>
          Added to what the user bought, so they never expire. Below zero takes
          some back, never past nothing.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form
          className="flex flex-col gap-3"
          aria-label={`Grant ${unit.many}`}
          onSubmit={prevent(() =>
            submit.run(async () => {
              const problem = grantProblem(form, unit)
              if (problem) return problem
              const failed = await onGrant(form)
              if (!failed) setForm({ who: "", amount: "", reason: "" })
              return failed
            }, "Granted."),
          )}
        >
          <div className="flex flex-wrap gap-3">
            <Field
              label="Who"
              htmlFor="grant-who"
              hint="A name or an email address"
              required
            >
              <Input
                id="grant-who"
                value={form.who}
                onChange={(event) =>
                  setForm({ ...form, who: event.target.value })
                }
              />
            </Field>
            <Field label="Amount" htmlFor="grant-amount" required>
              <Input
                id="grant-amount"
                inputMode="numeric"
                value={form.amount}
                onChange={(event) =>
                  setForm({ ...form, amount: event.target.value })
                }
              />
            </Field>
          </div>
          <Field
            label="Reason"
            htmlFor="grant-reason"
            hint="The user reads it beside the grant"
            required
          >
            <Input
              id="grant-reason"
              value={form.reason}
              onChange={(event) =>
                setForm({ ...form, reason: event.target.value })
              }
            />
          </Field>
          <div>
            <Button type="submit" disabled={submit.busy}>
              Grant
            </Button>
          </div>
          <FormStatus error={submit.error} message={submit.message} />
        </form>
        {grants.length > 0 ? (
          <List>
            {grants.map((grant) => (
              <ListRow key={grant.id}>
                <span className="flex flex-col gap-0.5">
                  <span>
                    {nameOf(grant.userId)}:{" "}
                    {grantLine(grant.amount, grant.reason)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {grant.adminEmail} · {dayText(grant.createdAt)}
                  </span>
                </span>
                <RowValue>{signedCreditsText(grant.amount, unit)}</RowValue>
              </ListRow>
            ))}
          </List>
        ) : null}
      </CardContent>
    </Card>
  )
}
