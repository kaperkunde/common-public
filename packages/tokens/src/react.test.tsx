/** @vitest-environment happy-dom */
import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import type { TokenApi } from "./browser-api"
import { TokenCenterError, centerUnavailable } from "./errors"
import {
  AutoRefill,
  BackendOrderSwitch,
  BuyTokens,
  OwnModelForm,
  PurchaseHistory,
  PurchaseList,
  TokenBalance,
  TokensProvider,
  UsageList,
  refreshTokens,
  cacheShare,
} from "./react"
import type {
  AutoRefill as AutoRefillState,
  Balance,
  CallRecord,
  OwnEndpoint,
  Purchase,
  Refund,
  SalePrices,
} from "./types"

const unit = { one: "credit", many: "credits", perDollar: 1_000_000 }
const balance: Balance = {
  userId: "u1",
  known: true,
  availableMicros: 84_000_000,
  purchasedMicros: 80_000_000,
  grantsMicros: 4_000_000,
  byProvider: {
    anthropic: 84_000_000,
    openai: 80_000_000,
    elevenlabs: 80_000_000,
  },
  lots: [],
  nextExpiry: { at: "2026-12-01T00:00:00.000Z", micros: 4_000_000 },
  unit,
  feeBps: 2000,
  autoRefill: null,
}
const prices: SalePrices = {
  paymentsAvailable: true,
  feeBps: 2000,
  options: {
    packsCents: [500, 1000, 2500, 5000],
    packsOnly: false,
    minimumCents: 500,
    maximumCents: 100000,
  },
  prices: [
    {
      currency: "eur",
      centsPerDollar: 100,
      taxBehavior: "inclusive",
      minimumCents: 500,
      effectiveFrom: "2026-01-01T00:00:00.000Z",
    },
    {
      currency: "usd",
      centsPerDollar: 100,
      taxBehavior: "exclusive",
      minimumCents: 500,
      effectiveFrom: "2026-01-01T00:00:00.000Z",
    },
  ],
}

let root: Root | undefined
let host: HTMLElement | undefined

beforeAll(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = host = undefined
})

async function mount(node: ReactNode) {
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(node))
  await settle()
  return host
}
const settle = async () => {
  for (let i = 0; i < 4; i++)
    await act(async () => {
      await Promise.resolve()
    })
}
const api = (over: Partial<TokenApi> = {}): TokenApi =>
  ({
    app: async () => ({
      id: "app",
      name: "App",
      unit,
      feeBps: 2000,
      lowBalanceMicros: 500_000,
      maxInFlightPerUser: 4,
      livemode: false,
      returnOrigins: [],
    }),
    balance: async () => balance,
    salePrices: async () => prices,
    ...over,
  }) as TokenApi
const press = async (el: Element | null | undefined) => {
  expect(el).toBeTruthy()
  await act(async () => (el as HTMLElement).click())
  await settle()
}
const type = async (
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) => {
  const proto =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}
const submit = async (form: Element | null) => {
  await act(async () =>
    form!.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    ),
  )
  await settle()
}
const byText = (root: ParentNode, selector: string, text: RegExp | string) =>
  [...root.querySelectorAll(selector)].find((e) =>
    typeof text === "string"
      ? e.textContent === text
      : text.test(e.textContent ?? ""),
  )

describe("TokenBalance", () => {
  it("draws a compact pill from a balance it holds, in the app's unit", async () => {
    const el = await mount(<TokenBalance balance={balance} />)
    const pill = el.querySelector(".tk-balance")!
    expect(pill.textContent).toContain("84M")
    expect(pill.textContent).toContain("credits")
    expect(pill.getAttribute("title")).toBe("84,000,000 credits")
    expect(pill.classList.contains("tk-balance--empty")).toBe(false)
  })

  it("loads its own balance through the provider's client, and says empty", async () => {
    const balanceFn = vi.fn(async () => ({
      ...balance,
      availableMicros: 0,
      purchasedMicros: 0,
      grantsMicros: 0,
    }))
    const el = await mount(
      <TokensProvider api={api({ balance: balanceFn })}>
        <TokenBalance className="mine" />
      </TokensProvider>,
    )
    expect(balanceFn).toHaveBeenCalledOnce()
    const pill = el.querySelector(".tk-balance")!
    expect(pill.className).toContain("mine")
    expect(pill.classList.contains("tk-balance--empty")).toBe(true)
  })

  it("loads again when something asks every balance to refresh", async () => {
    let available = 1_000_000
    const balanceFn = vi.fn(async () => ({
      ...balance,
      availableMicros: available,
    }))
    const el = await mount(
      <TokensProvider api={api({ balance: balanceFn })}>
        <TokenBalance />
      </TokensProvider>,
    )
    expect(el.textContent).toContain("1M")
    available = 2_000_000
    await act(async () => refreshTokens())
    await settle()
    expect(balanceFn).toHaveBeenCalledTimes(2)
    expect(el.textContent).toContain("2M")
  })

  it("is a link when given an href, and the full variant breaks it down", async () => {
    const el = await mount(<TokenBalance balance={balance} href="/ai/tokens" />)
    expect(el.querySelector("a.tk-balance")?.getAttribute("href")).toBe(
      "/ai/tokens",
    )
    await act(async () =>
      root!.render(<TokenBalance balance={balance} variant="full" />),
    )
    expect(el.textContent).toContain("84,000,000")
    expect(el.textContent).toContain("From drops and grants")
    expect(el.textContent).toMatch(/expire/)
  })
})

describe("BuyTokens", () => {
  it("starts the checkout with the chosen pack and goes to Stripe", async () => {
    const onCheckout = vi.fn(async (_input: unknown) => ({
      url: "https://stripe.test/pay",
    }))
    const onRedirect = vi.fn()
    const el = await mount(
      <TokensProvider api={api()}>
        <BuyTokens
          onCheckout={onCheckout}
          onRedirect={onRedirect}
          returnPath="/ai/tokens"
        />
      </TokensProvider>,
    )
    expect(el.textContent).toContain("buys 10,000,000 credits")
    await press(byText(el, "button", "€25.00"))
    await press(byText(el, "button", "USD"))
    await press(el.querySelector(".tk-check input"))
    await submit(el.querySelector("form"))
    expect(onCheckout).toHaveBeenCalledOnce()
    expect(onCheckout.mock.calls[0]![0]).toMatchObject({
      currency: "usd",
      amountCents: 2500,
      saveCard: true,
      returnPath: "/ai/tokens",
    })
    expect(onRedirect).toHaveBeenCalledWith("https://stripe.test/pay")
  })

  it("says what is missing, or the minimum, instead of disabling the button", async () => {
    const onCheckout = vi.fn(async () => ({ url: "x" }))
    const el = await mount(
      <TokensProvider api={api()}>
        <BuyTokens onCheckout={onCheckout} />
      </TokensProvider>,
    )
    const buy = el.querySelector<HTMLButtonElement>("button[type=submit]")!
    await press(byText(el, "button", "Other amount"))
    expect(buy.disabled).toBe(false)
    await submit(el.querySelector("form"))
    expect(el.querySelector("[role=alert]")?.textContent).toBe(
      "Still needed: Amount.",
    )
    await type(el.querySelector<HTMLInputElement>(".tk-input")!, "2")
    await submit(el.querySelector("form"))
    expect(el.querySelector("[role=alert]")?.textContent).toBe(
      "The smallest purchase is €5.00.",
    )
    expect(onCheckout).not.toHaveBeenCalled()
  })

  it("disables the buy button, with the reason shown, when payments are unavailable", async () => {
    const onCheckout = vi.fn(async () => ({ url: "x" }))
    const el = await mount(
      <TokensProvider
        api={api({
          salePrices: async () => ({ ...prices, paymentsAvailable: false }),
        })}
      >
        <BuyTokens onCheckout={onCheckout} />
      </TokensProvider>,
    )
    const buy = el.querySelector<HTMLButtonElement>("button[type=submit]")!
    expect(buy.disabled).toBe(true)
    expect(el.textContent).toContain("Buying is not available right now.")
    await submit(el.querySelector("form"))
    expect(onCheckout).not.toHaveBeenCalled()
  })

  it("offers the app's packs from the center, and only the packs when packsOnly", async () => {
    const own = (options: SalePrices["options"]) =>
      api({ salePrices: async () => ({ ...prices, options }) })
    let el = await mount(
      <TokensProvider
        api={own({
          packsCents: [700, 1500],
          packsOnly: true,
          minimumCents: 500,
          maximumCents: 5000,
        })}
      >
        <BuyTokens />
      </TokensProvider>,
    )
    const labelsOf = () =>
      [...el.querySelectorAll(".tk-segment")].map((e) => e.textContent)
    expect(labelsOf()).toEqual(expect.arrayContaining(["€7.00", "€15.00"]))
    expect(labelsOf()).not.toContain("Other amount")
    expect(labelsOf()).not.toContain("€10.00")
    act(() => root?.unmount())
    host?.remove()
    el = await mount(
      <TokensProvider
        api={own({
          packsCents: [700],
          packsOnly: false,
          minimumCents: 500,
          maximumCents: 5000,
        })}
      >
        <BuyTokens onCheckout={async () => ({ url: "x" })} />
      </TokensProvider>,
    )
    await press(byText(el, "button", "Other amount"))
    await type(el.querySelector<HTMLInputElement>(".tk-input")!, "60")
    await submit(el.querySelector("form"))
    expect(el.querySelector("[role=alert]")?.textContent).toBe(
      "The largest purchase is €50.00.",
    )
  })

  it("shows the center's error in words and does not redirect", async () => {
    const { TokenCenterError } = await import("./errors")
    const onRedirect = vi.fn()
    const el = await mount(
      <TokensProvider api={api()}>
        <BuyTokens
          onRedirect={onRedirect}
          onCheckout={async () => {
            throw new TokenCenterError({
              code: "payments_unavailable",
              message: "Payments are off.",
            })
          }}
        />
      </TokensProvider>,
    )
    await submit(el.querySelector("form"))
    expect(el.querySelector("[role=alert]")?.textContent).toBe(
      "Payments are off.",
    )
    expect(onRedirect).not.toHaveBeenCalled()
  })
})

describe("AutoRefill", () => {
  const state: AutoRefillState = {
    enabled: false,
    thresholdMicros: 1_000_000,
    amountCents: 1000,
    currency: "eur",
    monthlyMaxCents: 5000,
    card: null,
    pending: false,
    failedAt: null,
  }

  it("asks for a card before it can be on, and saves in the app's units and cents", async () => {
    const onSave = vi.fn(async () => ({}))
    const el = await mount(
      <AutoRefill value={state} unit={unit} onSave={onSave} />,
    )
    expect(el.textContent).toContain("No card saved")
    await press(el.querySelector("input[role=switch]"))
    await submit(el.querySelector("form"))
    expect(el.querySelector("[role=alert]")?.textContent).toBe(
      "Save a card first, then turn auto-refill on.",
    )
    expect(onSave).not.toHaveBeenCalled()

    await act(async () =>
      root!.render(
        <AutoRefill
          value={{ ...state, card: { label: "Visa ending 4242" } }}
          unit={unit}
          onSave={onSave}
        />,
      ),
    )
    await press(el.querySelector("input[role=switch]"))
    await submit(el.querySelector("form"))
    expect(onSave).toHaveBeenCalledWith({
      enabled: true,
      thresholdMicros: 1_000_000,
      amountCents: 1000,
      currency: "eur",
      monthlyMaxCents: 5000,
    })
    expect(el.textContent).toContain("Saved.")
  })

  it("names the fields still needed", async () => {
    const el = await mount(
      <AutoRefill value={state} unit={unit} onSave={async () => ({})} />,
    )
    await type(el.querySelectorAll<HTMLInputElement>(".tk-input")[1]!, "")
    await submit(el.querySelector("form"))
    expect(el.querySelector("[role=alert]")?.textContent).toBe(
      "Still needed: Refill amount.",
    )
  })
})

describe("UsageList", () => {
  const call = (over: Partial<CallRecord>): CallRecord =>
    ({
      callId: "c1",
      status: "charged",
      source: "tokens",
      model: "claude-sonnet-5-5",
      usage: {
        inputTokens: 10_000,
        outputTokens: 500,
        cacheReadTokens: 6_200,
        cacheWriteTokens: 0,
        cacheWrite1hTokens: 0,
        totalTokens: 10_500,
      },
      costMicros: 600,
      feeMicros: 120,
      chargedMicros: 720,
      createdAt: "2026-11-17T10:00:00.000Z",
      attribution: { purpose: "storyteller", activity: "Telling Ash" },
      ...over,
    }) as CallRecord

  it("lists calls with cost, cache share and what each was for, and pages on", async () => {
    const page = {
      calls: [
        call({}),
        call({
          callId: "c2",
          source: "own",
          attribution: { purpose: "player" },
        }),
      ],
      nextCursor: "2",
      totals: {
        count: 3,
        costMicros: 1,
        feeMicros: 1,
        chargedMicros: 1_500,
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 1,
        cacheWriteTokens: 0,
        totalTokens: 2,
      },
    }
    const more = vi.fn(async () => ({
      ...page,
      calls: [call({ callId: "c3", attribution: { activity: "Resolving" } })],
      nextCursor: null,
    }))
    const el = await mount(
      <TokensProvider api={api({ calls: more })}>
        <UsageList page={page} unit={unit} />
      </TokensProvider>,
    )
    const rows = el.querySelectorAll(".tk-row")
    expect(rows).toHaveLength(2)
    expect(rows[0]!.textContent).toContain("Telling Ash")
    expect(rows[0]!.textContent).toContain("62% cached")
    expect(rows[0]!.textContent).toContain("720")
    expect(rows[1]!.textContent).toContain("your own model")
    expect(el.textContent).toContain("3 calls")
    await press(byText(el, "button", "Show more"))
    expect(el.querySelectorAll(".tk-row")).toHaveLength(3)
    expect(byText(el, "button", "Show more")).toBeUndefined()
  })

  it("computes the cache share", () => {
    expect(
      cacheShare({
        usage: { inputTokens: 0, cacheReadTokens: 0 } as CallRecord["usage"],
      }),
    ).toBe(0)
    expect(
      cacheShare({
        usage: { inputTokens: 200, cacheReadTokens: 50 } as CallRecord["usage"],
      }),
    ).toBe(25)
  })
})

describe("PurchaseHistory", () => {
  it("says each kind of entry in the app's unit", async () => {
    const lot = {
      id: "l1",
      kind: "airdrop",
      provider: "anthropic",
      grantedMicros: 8_000_000,
      spentMicros: 0,
      remainingMicros: 8_000_000,
      expiresAt: null,
      reason: null,
      createdAt: "2026-11-01T00:00:00.000Z",
    } as const
    const el = await mount(
      <PurchaseHistory
        unit={unit}
        page={{
          nextCursor: null,
          entries: [
            {
              type: "purchase",
              at: "2026-11-02T00:00:00.000Z",
              purchase: {
                id: "p1",
                kind: "checkout",
                status: "paid",
                currency: "eur",
                amountCents: 1000,
                taxCents: 0,
                totalCents: 1000,
                creditMicros: 10_000_000,
                failure: null,
                createdAt: "2026-11-02T00:00:00.000Z",
                paidAt: "2026-11-02T00:00:00.000Z",
              },
            },
            { type: "grant", at: lot.createdAt, lot },
            {
              type: "expiry",
              at: "2026-12-01T00:00:00.000Z",
              lotId: "l1",
              expiredMicros: 500,
            },
          ],
        }}
      />,
    )
    const text = el.textContent!
    expect(text).toContain("+10,000,000")
    expect(text).toContain("€10.00")
    expect(text).toContain("Drop")
    expect(text).toContain("+8,000,000")
    expect(text).toContain("−500")
  })
})

const refund: Refund = {
  id: "ref_1",
  purchaseId: "p1",
  status: "succeeded",
  creditMicros: 4_000_000,
  amountCents: 400,
  currency: "eur",
  initiatedBy: "app",
  failure: null,
  createdAt: "2026-11-24T10:00:00.000Z",
  settledAt: "2026-11-24T10:00:01.000Z",
}

describe("PurchaseHistory refunds", () => {
  it("says a refund, shows a pending and a failed one, and skips an entry type it does not know", async () => {
    const el = await mount(
      <PurchaseHistory
        unit={unit}
        page={{
          nextCursor: null,
          entries: [
            { type: "refund", at: refund.createdAt, refund },
            {
              type: "refund",
              at: refund.createdAt,
              refund: { ...refund, id: "ref_2", status: "pending" },
            },
            {
              type: "refund",
              at: refund.createdAt,
              refund: { ...refund, id: "ref_3", status: "failed" },
            },
            { type: "chargeback", at: refund.createdAt } as never,
          ],
        }}
      />,
    )
    const rows = [...el.querySelectorAll("li")]
    expect(rows).toHaveLength(3)
    expect(rows[0]!.textContent).toContain("Refund")
    expect(rows[0]!.textContent).toContain("€4.00 back to your card")
    expect(rows[0]!.textContent).toContain("−4,000,000")
    expect(rows[1]!.textContent).toContain("pending")
    expect(rows[2]!.textContent).toContain("failed")
    expect(rows[2]!.textContent).toContain("—")
  })
})

describe("PurchaseList", () => {
  const purchase = (over: Partial<Purchase> = {}): Purchase => ({
    id: "p1",
    kind: "checkout",
    status: "paid",
    currency: "eur",
    amountCents: 1000,
    taxCents: 0,
    totalCents: 1000,
    creditMicros: 10_000_000,
    failure: null,
    createdAt: "2026-11-02T00:00:00.000Z",
    paidAt: "2026-11-02T00:00:00.000Z",
    refundableCreditMicros: 4_000_000,
    refundableCents: 400,
    refundedCreditMicros: 0,
    refundedCents: 0,
    ...over,
  })

  it("lists purchases with what can be refunded, and offers nothing where nothing is left", async () => {
    const el = await mount(
      <PurchaseList
        unit={unit}
        page={{
          nextCursor: null,
          purchases: [
            purchase(),
            purchase({
              id: "p0",
              refundableCreditMicros: 0,
              refundableCents: 0,
              refundedCents: 600,
            }),
          ],
        }}
      />,
    )
    const rows = [...el.querySelectorAll("li")]
    expect(rows[0]!.textContent).toContain(
      "4,000,000 credits can be refunded, €4.00 back to your card.",
    )
    expect(byText(rows[0]!, "button", "Refund…")).toBeTruthy()
    expect(rows[1]!.textContent).toContain("Nothing left to refund.")
    expect(rows[1]!.textContent).toContain("€6.00 already refunded.")
    expect(byText(rows[1]!, "button", "Refund…")).toBeUndefined()
  })

  it("asks first with the money back, and backs out without asking the center anything", async () => {
    const refundFn = vi.fn(async () => refund)
    const el = await mount(
      <TokensProvider api={api({ refund: refundFn } as Partial<TokenApi>)}>
        <PurchaseList
          unit={unit}
          page={{ nextCursor: null, purchases: [purchase()] }}
        />
      </TokensProvider>,
    )
    await press(byText(el, "button", "Refund…"))
    expect(el.textContent).toContain("get €4.00 back to the card you paid with")
    expect(refundFn).not.toHaveBeenCalled()
    // Keep my tokens backs out without asking the center anything.
    await press(byText(el, "button", "Keep my tokens"))
    expect(byText(el, "button", "Refund…")).toBeTruthy()
    expect(refundFn).not.toHaveBeenCalled()
  })

  it("sends the confirmed refund through the client with a key, and tells the pending from the settled", async () => {
    const refundFn = vi.fn(async () => ({
      ...refund,
      status: "pending" as const,
    }))
    const onRefunded = vi.fn()
    const el = await mount(
      <TokensProvider api={api({ refund: refundFn } as Partial<TokenApi>)}>
        <PurchaseList
          unit={unit}
          onRefunded={onRefunded}
          page={{ nextCursor: null, purchases: [purchase()] }}
        />
      </TokensProvider>,
    )
    await press(byText(el, "button", "Refund…"))
    await press(byText(el, "button", "Refund €4.00"))
    expect(refundFn).toHaveBeenCalledOnce()
    const [id, input, key] = refundFn.mock.calls[0] as unknown as [
      string,
      object,
      string,
    ]
    expect([id, input]).toEqual(["p1", {}])
    expect(key).toMatch(/\S{8,}/)
    expect(onRefunded).toHaveBeenCalledOnce()
    expect(el.textContent).toContain("Refund started")
  })

  it("says in words what was refused, and keeps the same key for a retry after a network failure", async () => {
    const keys: string[] = []
    let n = 0
    const refundFn = vi.fn(async (_id: string, _input: object, key: string) => {
      keys.push(key)
      if (++n === 1) throw centerUnavailable()
      if (n === 2)
        throw new TokenCenterError({
          code: "refund_amount_invalid",
          message: "x",
          refundableCreditMicros: 1_000_000,
        })
      return refund
    })
    const el = await mount(
      <TokensProvider api={api({ refund: refundFn } as Partial<TokenApi>)}>
        <PurchaseList
          unit={unit}
          page={{ nextCursor: null, purchases: [purchase()] }}
        />
      </TokensProvider>,
    )
    await press(byText(el, "button", "Refund…"))
    await press(byText(el, "button", "Refund €4.00"))
    expect(el.textContent).toContain("unavailable")
    await press(byText(el, "button", "Refund €4.00"))
    expect(keys[0]).toBe(keys[1])
    expect(el.textContent).toContain(
      "Only 1,000,000 credits can be refunded now.",
    )
    // A refusal is a fresh question: the next press is a new refund.
    await press(byText(el, "button", "Refund €4.00"))
    expect(keys[2]).not.toBe(keys[1])
    expect(el.textContent).toContain("Refunded")
  })
})

describe("PurchaseList partial refunds", () => {
  const p: Purchase = {
    id: "p1",
    kind: "checkout",
    status: "paid",
    currency: "eur",
    amountCents: 1000,
    taxCents: 0,
    totalCents: 1000,
    creditMicros: 10_000_000,
    failure: null,
    createdAt: "2026-11-02T00:00:00.000Z",
    paidAt: "2026-11-02T00:00:00.000Z",
    refundableCreditMicros: 8_000_000,
    refundableCents: 800,
    refundedCreditMicros: 0,
    refundedCents: 0,
  }
  const mountList = (refundFn: unknown) =>
    mount(
      <TokensProvider api={api({ refund: refundFn } as Partial<TokenApi>)}>
        <PurchaseList unit={unit} page={{ nextCursor: null, purchases: [p] }} />
      </TokensProvider>,
    )

  it("refunds a typed amount, showing the money back first, with a fresh key each confirmation", async () => {
    const refundFn = vi.fn(async (..._a: unknown[]) => refund)
    const el = await mountList(refundFn)
    await press(byText(el, "button", "Refund…"))
    await press(byText(el, "button", "An amount"))
    await type(
      el.querySelector("input[type=text]") as HTMLInputElement,
      "2500000",
    )
    expect(el.textContent).toContain("get €2.50 back")
    await press(byText(el, "button", "Refund €2.50"))
    expect(refundFn.mock.calls[0]!.slice(0, 2)).toEqual([
      "p1",
      { creditMicros: 2_500_000 },
    ])
    await press(byText(el, "button", "Refund…"))
    expect(el.textContent).not.toContain("get €2.50 back")
    expect(el.textContent).toContain("get €8.00 back")
    await press(byText(el, "button", "Refund €8.00"))
    const keys = refundFn.mock.calls.map((c) => (c as unknown[])[2])
    expect(keys[0]).not.toBe(keys[1])
    expect(refundFn.mock.calls[1]![1]).toEqual({})
  })

  it("names a bad amount without asking the center", async () => {
    const refundFn = vi.fn(async (..._a: unknown[]) => refund)
    const el = await mountList(refundFn)
    await press(byText(el, "button", "Refund…"))
    await press(byText(el, "button", "An amount"))
    await type(
      el.querySelector("input[type=text]") as HTMLInputElement,
      "9000000",
    )
    await press(byText(el, "button", /^Refund €/))
    expect(el.textContent).toContain("between 1 and 8,000,000")
    expect(refundFn).not.toHaveBeenCalled()
  })

  it("retries once after the center's hint when a call is running, and points to support when refused", async () => {
    vi.useFakeTimers()
    try {
      let n = 0
      const refundFn = vi.fn(async (..._a: unknown[]) => {
        if (++n === 1)
          throw new TokenCenterError({
            code: "refund_not_available",
            message: "x",
            action: "wait",
            retryAfterSeconds: 2,
          })
        throw new TokenCenterError({
          code: "refund_refused_by_processor",
          message: "x",
        })
      })
      const el = await mountList(refundFn)
      await press(byText(el, "button", "Refund…"))
      await press(byText(el, "button", /^Refund €/))
      expect(el.textContent).toContain("Trying again in 2 seconds")
      expect(refundFn).toHaveBeenCalledOnce()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000)
      })
      await settle()
      expect(refundFn).toHaveBeenCalledTimes(2)
      expect(refundFn.mock.calls[0]![2]).toBe(refundFn.mock.calls[1]![2])
      expect(el.textContent).toContain("support@kaperkun.de")
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("OwnModelForm", () => {
  const saved: OwnEndpoint = {
    baseUrl: "https://llm.example/v1",
    hasKey: true,
    keyHint: "a1b2",
    models: ["m1", "m2"],
    defaultModel: "m1",
    capabilities: ["streaming", "tools"],
    toolChoice: "auto",
    monthlyTokenLimit: 1_000_000,
    usedThisMonth: 250_000,
    periodEndsAt: "2026-12-01T00:00:00.000Z",
    order: "own_then_tokens",
    lastTest: null,
  }

  it("names what is needed, and never shows a saved key", async () => {
    const onSave = vi.fn(async (): Promise<OwnEndpoint> => saved)
    const el = await mount(<OwnModelForm endpoint={null} onSave={onSave} />)
    await submit(el.querySelector("form"))
    expect(el.querySelector("[role=alert]")?.textContent).toBe(
      "Still needed: Address, Models.",
    )
    expect(onSave).not.toHaveBeenCalled()

    await act(async () =>
      root!.render(<OwnModelForm endpoint={saved} onSave={onSave} />),
    )
    expect(el.textContent).toContain("Saved (…a1b2)")
    expect(el.textContent).toContain("250k of 1M used this month")
    const key = el.querySelector<HTMLInputElement>("input[type=password]")!
    expect(key.value).toBe("")
  })

  it("saves with the key left out to keep it, a new one to replace it, and null to remove it", async () => {
    const onSave = vi.fn(async (_input: unknown): Promise<OwnEndpoint> => saved)
    const el = await mount(<OwnModelForm endpoint={saved} onSave={onSave} />)
    await submit(el.querySelector("form"))
    expect(onSave.mock.calls[0]![0]).not.toHaveProperty("apiKey")
    expect(onSave.mock.calls[0]![0]).toMatchObject({
      baseUrl: "https://llm.example/v1",
      models: ["m1", "m2"],
      monthlyTokenLimit: 1_000_000,
      order: "own_then_tokens",
    })

    await type(
      el.querySelector<HTMLInputElement>("input[type=password]")!,
      "sk-new",
    )
    await submit(el.querySelector("form"))
    expect(onSave.mock.calls[1]![0]).toMatchObject({ apiKey: "sk-new" })

    await press(
      byText(el, "label", /Remove the saved key/)?.querySelector("input"),
    )
    await submit(el.querySelector("form"))
    expect(onSave.mock.calls[2]![0]).toMatchObject({ apiKey: null })
  })

  it("sends the tool choice once tools are on", async () => {
    const onSave = vi.fn(async (_input: unknown): Promise<OwnEndpoint> => saved)
    const el = await mount(<OwnModelForm endpoint={saved} onSave={onSave} />)
    await press(byText(el, "button", "Require it to call one"))
    await submit(el.querySelector("form"))
    expect(onSave.mock.calls[0]![0]).toMatchObject({ toolChoice: "required" })
  })

  it("tests the endpoint and says how it went", async () => {
    const onTest = vi.fn(async () => ({
      ok: false,
      at: "2026-11-17T10:00:00.000Z",
      latencyMs: null,
      models: null,
      error: { code: "byo_failed" as const, message: "It answered 401." },
    }))
    const el = await mount(<OwnModelForm endpoint={saved} onTest={onTest} />)
    await press(byText(el, "button", "Test it"))
    expect(el.querySelector("[role=alert]")?.textContent).toBe(
      "It did not answer: It answered 401.",
    )
  })

  it("keeps the order switch honest without an own endpoint", async () => {
    const onChange = vi.fn()
    const el = await mount(
      <BackendOrderSwitch
        order="tokens_only"
        hasOwn={false}
        onChange={onChange}
      />,
    )
    await press(byText(el, "button", "My own only"))
    expect(onChange).not.toHaveBeenCalled()
    expect(el.textContent).toContain("Save your own model first")
    await press(byText(el, "button", "Tokens only"))
    expect(onChange).toHaveBeenCalledWith("tokens_only")
  })
})
