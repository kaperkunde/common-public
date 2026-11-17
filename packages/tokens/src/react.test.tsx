/** @vitest-environment happy-dom */
import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import type { TokenApi } from "./browser-api"
import {
  AutoRefill,
  BackendOrderSwitch,
  BuyTokens,
  OwnModelForm,
  PurchaseHistory,
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

describe("OwnModelForm", () => {
  const saved: OwnEndpoint = {
    baseUrl: "https://llm.example/v1",
    hasKey: true,
    keyHint: "a1b2",
    models: ["m1", "m2"],
    defaultModel: "m1",
    capabilities: ["streaming", "tools"],
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
