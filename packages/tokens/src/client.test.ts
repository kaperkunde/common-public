import { describe, expect, it, vi } from "vitest"

import { TokenCenterError } from "./errors"
import { createTokenCenter } from "./server/client"

const ok = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  })

function center(fetchImpl: typeof fetch, extra = {}) {
  return createTokenCenter({
    baseUrl: "https://c.test/",
    apiKey: "tk_test_k",
    fetch: fetchImpl,
    ...extra,
  })
}

describe("createTokenCenter", () => {
  it("sends the app key, the encoded user and the query, and returns the parsed body", async () => {
    const fetchImpl = vi.fn(async () => ok({ userId: "a/b" }))
    const c = center(fetchImpl as unknown as typeof fetch)
    await c.calls("a/b", { limit: 5, scope: "p1", job: undefined })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe("https://c.test/api/v1/users/a%2Fb/calls?limit=5&scope=p1")
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer tk_test_k",
    )
    expect(init.method).toBe("GET")
  })

  it("posts JSON and an idempotency key", async () => {
    const fetchImpl = vi.fn(async () =>
      ok({ purchaseId: "p" }, { status: 201 }),
    )
    await center(fetchImpl as unknown as typeof fetch).checkout(
      "u1",
      {
        currency: "eur",
        amountCents: 1000,
        successUrl: "https://a/ok",
        cancelUrl: "https://a/no",
      },
      { idempotencyKey: "k1" },
    )
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers["idempotency-key"]).toBe("k1")
    expect(headers["content-type"]).toBe("application/json")
    expect(JSON.parse(init.body as string).amountCents).toBe(1000)
  })

  it("throws the center's own error with its code, status and detail", async () => {
    const c = center((async () =>
      ok(
        {
          error: {
            code: "purchase_too_small",
            message: "Too small.",
            minimumCents: 500,
          },
        },
        { status: 400 },
      )) as typeof fetch)
    const error = await c
      .checkout("u", {
        currency: "eur",
        amountCents: 1,
        successUrl: "",
        cancelUrl: "",
      })
      .catch((e) => e)
    expect(error).toBeInstanceOf(TokenCenterError)
    expect(error.code).toBe("purchase_too_small")
    expect(error.status).toBe(400)
    expect(error.detail.minimumCents).toBe(500)
  })

  it("fails closed: no answer, a timeout, a 5xx page and unreadable JSON are all center_unavailable", async () => {
    const refused = center((async () => {
      throw new TypeError("fetch failed")
    }) as typeof fetch)
    expect((await refused.balance("u").catch((e) => e)).code).toBe(
      "center_unavailable",
    )

    const slow = center(
      ((_url: string, init: RequestInit) =>
        new Promise((_, reject) =>
          init.signal!.addEventListener("abort", () =>
            reject(init.signal!.reason),
          ),
        )) as unknown as typeof fetch,
      { timeoutMs: 20 },
    )
    const timedOut = await slow.balance("u").catch((e) => e)
    expect(timedOut.code).toBe("center_unavailable")
    expect(timedOut.message).toMatch(/in time/)

    const page = center(
      (async () =>
        new Response("<html>502</html>", { status: 502 })) as typeof fetch,
    )
    expect((await page.balance("u").catch((e) => e)).code).toBe(
      "center_unavailable",
    )

    const garbled = center(
      (async () => new Response("not json", { status: 200 })) as typeof fetch,
    )
    expect((await garbled.balance("u").catch((e) => e)).code).toBe(
      "center_unavailable",
    )
  })

  it("answers null for an own endpoint that is not saved, and waits for a call within a longer timeout", async () => {
    const none = center((async () =>
      ok(
        { error: { code: "not_found", message: "No." } },
        { status: 404 },
      )) as typeof fetch)
    expect(await none.ownEndpoint("u")).toBeNull()

    const fetchImpl = vi.fn(async () => ok({ callId: "c1" }))
    await center(fetchImpl as unknown as typeof fetch, {
      timeoutMs: 1000,
    }).call("c1", { wait: 99 })
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe(
      "https://c.test/api/v1/calls/c1?wait=30",
    )
  })

  it("refuses to be made without a key or asked about nobody", () => {
    expect(() =>
      createTokenCenter({ baseUrl: "https://c.test", apiKey: "" }),
    ).toThrow()
    expect(() => center(fetch).balance("")).toThrow()
  })

  it("lists purchases and refunds one with the caller's idempotency key", async () => {
    const refund = {
      id: "ref_1",
      purchaseId: "pur 1",
      status: "pending",
      creditMicros: 4_000_000,
      amountCents: 400,
      currency: "eur",
      initiatedBy: "app",
      failure: null,
      createdAt: "2026-11-24T10:00:00.000Z",
      settledAt: null,
    }
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith("/refund")
        ? ok(refund, { status: 202 })
        : ok({ purchases: [], nextCursor: null }),
    )
    const c = center(fetchImpl as unknown as typeof fetch)
    await c.purchases("u1", { limit: 10, cursor: "x" })
    const made = await c.refund(
      "u1",
      "pur 1",
      { creditMicros: 4_000_000 },
      { idempotencyKey: "k-1" },
    )
    expect(made.status).toBe("pending")
    const [listUrl] = fetchImpl.mock.calls[0] as unknown as [string]
    expect(listUrl).toBe(
      "https://c.test/api/v1/users/u1/purchases?limit=10&cursor=x",
    )
    const [url, init] = fetchImpl.mock.calls[1] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe("https://c.test/api/v1/users/u1/purchases/pur%201/refund")
    expect(init.method).toBe("POST")
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe(
      "k-1",
    )
    expect(JSON.parse(init.body as string)).toEqual({ creditMicros: 4_000_000 })
    expect(() => c.refund("u1", "p", {}, { idempotencyKey: "" })).toThrow(
      /idempotencyKey/,
    )
  })

  it("throws the refund refusals with what is refundable, typed", async () => {
    const c = center((async () =>
      ok(
        {
          error: {
            code: "refund_amount_invalid",
            message: "Too much.",
            refundableCreditMicros: 2_500_000,
          },
        },
        { status: 400 },
      )) as typeof fetch)
    const e = (await c
      .refund("u1", "p", { creditMicros: 9 }, { idempotencyKey: "k" })
      .catch((x) => x)) as TokenCenterError
    expect(e.code).toBe("refund_amount_invalid")
    expect(e.status).toBe(400)
    expect(e.refundableCreditMicros).toBe(2_500_000)

    const wait = center((async () =>
      ok(
        {
          error: {
            code: "refund_not_available",
            message: "A call is running.",
            action: "wait",
            retryAfterSeconds: 3,
          },
        },
        { status: 409 },
      )) as typeof fetch)
    const w = (await wait
      .refund("u1", "p", {}, { idempotencyKey: "k" })
      .catch((x) => x)) as TokenCenterError
    expect(w.code).toBe("refund_not_available")
    expect(w.action).toBe("wait")
    expect(w.detail.retryAfterSeconds).toBe(3)
  })
})
