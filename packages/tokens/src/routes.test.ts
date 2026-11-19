import { describe, expect, it, vi } from "vitest"

import { TokenCenterError } from "./errors"
import { tokenRoutes, safeReturnPath, type TokenUser } from "./server/routes"
import type { TokenCenter } from "./server/client"

/** A center whose every method records its arguments and answers `{ called: name }`. */
function fakeCenter(overrides: Record<string, unknown> = {}) {
  const calls: { name: string; args: unknown[] }[] = []
  const center = new Proxy(
    {},
    {
      get: (_t, name: string) =>
        overrides[name] ??
        (name === "upsertUser" ? async () => ({}) : undefined) ??
        (async (...args: unknown[]) => {
          calls.push({ name, args })
          return { called: name }
        }),
    },
  ) as unknown as TokenCenter
  return { center, calls }
}

const alice: TokenUser = { id: "alice", email: "alice@example.com" }
const req = (
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) =>
  new Request(`https://app.test/api/tokens/${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

describe("tokenRoutes", () => {
  it("always uses the user the app's session names, never one from the request", async () => {
    const { center, calls } = fakeCenter()
    const handler = tokenRoutes(center, { userOf: () => alice })
    await handler(req("GET", "balance?userId=bob"))
    await handler(
      req("PUT", "autorefill", {
        userId: "bob",
        enabled: true,
        thresholdMicros: 1,
        amountCents: 1000,
        currency: "eur",
        monthlyMaxCents: 5000,
        card: { label: "x" },
      }),
    )
    expect(calls.filter((c) => c.name === "balance")[0]!.args).toEqual([
      "alice",
    ])
    const refill = calls.find((c) => c.name === "setAutoRefill")!
    expect(refill.args[0]).toBe("alice")
    expect(refill.args[1]).toEqual({
      enabled: true,
      thresholdMicros: 1,
      amountCents: 1000,
      currency: "eur",
      monthlyMaxCents: 5000,
    })
  })

  it("hands the request to userOf and answers 401 for nobody, before the center is called", async () => {
    const { center, calls } = fakeCenter()
    const userOf = vi.fn(() => null)
    const res = await tokenRoutes(center, { userOf })(
      req("GET", "balance", undefined, { cookie: "s=1" }),
    )
    expect(res.status).toBe(401)
    expect((await res.json()).error.code).toBe("unauthenticated")
    expect(
      (userOf.mock.calls[0] as unknown as [Request])[0].headers.get("cookie"),
    ).toBe("s=1")
    expect(calls).toHaveLength(0)
  })

  it("syncs the verified email once per change, never failing the request over it", async () => {
    const upsert = vi.fn(async () => {
      throw new Error("down")
    })
    const { center, calls } = fakeCenter({ upsertUser: upsert })
    const handler = tokenRoutes(center, { userOf: () => alice })
    expect((await handler(req("GET", "balance"))).status).toBe(200)
    expect((await handler(req("GET", "balance"))).status).toBe(200)
    expect(upsert).toHaveBeenCalledTimes(2) // failed both times, so retried
    expect(calls.map((c) => c.name)).toEqual(["balance", "balance"])

    const ok = vi.fn(async () => ({}))
    const second = tokenRoutes(fakeCenter({ upsertUser: ok }).center, {
      userOf: () => alice,
    })
    await second(req("GET", "balance"))
    await second(req("GET", "balance"))
    expect(ok).toHaveBeenCalledOnce()
    expect(ok).toHaveBeenCalledWith("alice", { email: "alice@example.com" })
  })

  it("builds the checkout return URLs on the app's origin and forwards the idempotency key", async () => {
    const { center, calls } = fakeCenter()
    const handler = tokenRoutes(center, {
      userOf: () => alice,
      origin: "https://app.example",
    })
    const res = await handler(
      req(
        "POST",
        "checkout",
        {
          currency: "eur",
          amountCents: 1000,
          saveCard: true,
          returnPath: "/ai/tokens",
        },
        { "idempotency-key": "k-1" },
      ),
    )
    expect(res.status).toBe(201)
    const [userId, body, options] = calls[0]!.args as [
      string,
      Record<string, unknown>,
      { idempotencyKey?: string },
    ]
    expect(userId).toBe("alice")
    expect(body).toMatchObject({
      currency: "eur",
      amountCents: 1000,
      saveCard: true,
      successUrl:
        "https://app.example/ai/tokens?tokens=purchased&purchase={PURCHASE_ID}",
      cancelUrl: "https://app.example/ai/tokens?tokens=cancelled",
    })
    expect(options.idempotencyKey).toBe("k-1")
  })

  it("never lets a browser choose another origin to come back to", () => {
    expect(safeReturnPath("/ok?x=1")).toBe("/ok?x=1")
    for (const bad of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "javascript:alert(1)",
      5,
      undefined,
    ])
      expect(safeReturnPath(bad)).toBe("/")
  })

  it("validates bodies before asking the center, in words", async () => {
    const { center, calls } = fakeCenter()
    const handler = tokenRoutes(center, { userOf: () => alice })
    const small = await handler(
      req("POST", "checkout", { currency: "gbp", amountCents: 1000 }),
    )
    expect(small.status).toBe(400)
    expect((await small.json()).error.path).toBe("currency")
    expect(
      (
        await handler(
          req("POST", "checkout", { currency: "eur", amountCents: 10.5 }),
        )
      ).status,
    ).toBe(400)
    expect(
      (await handler(req("PUT", "backend-order", { order: "sideways" })))
        .status,
    ).toBe(400)
    expect(
      (
        await handler(
          new Request("https://app.test/api/tokens/checkout", {
            method: "POST",
            body: "nope",
          }),
        )
      ).status,
    ).toBe(400)
    expect(calls).toHaveLength(0)
  })

  it("passes the center's errors on with their code, status and Retry-After", async () => {
    const { center } = fakeCenter({
      balance: async () => {
        throw new TokenCenterError({
          code: "rate_limited",
          message: "Slow.",
          retryAfterSeconds: 4,
        })
      },
      autoRefill: async () => {
        throw new TokenCenterError({
          code: "center_unavailable",
          message: "Down.",
        })
      },
      models: async () => {
        throw new Error("bug")
      },
    })
    const handler = tokenRoutes(center, { userOf: () => alice })
    const limited = await handler(req("GET", "balance"))
    expect(limited.status).toBe(429)
    expect(limited.headers.get("retry-after")).toBe("4")
    expect(limited.headers.get("x-token-error")).toBe("rate_limited")
    expect((await handler(req("GET", "autorefill"))).status).toBe(503)
    const bug = vi.spyOn(console, "error").mockImplementation(() => {})
    const broken = await handler(req("GET", "models"))
    expect(broken.status).toBe(500)
    expect(JSON.stringify(await broken.json())).not.toMatch(/bug/)
    bug.mockRestore()
  })

  it("answers 404 for unknown paths, 405 for a wrong method, and 200 null for an own endpoint not saved", async () => {
    const { center } = fakeCenter({ ownEndpoint: async () => null })
    const handler = tokenRoutes(center, { userOf: () => alice })
    expect((await handler(req("GET", "nope"))).status).toBe(404)
    expect((await handler(req("GET", "constructor"))).status).toBe(404)
    const wrong = await handler(req("POST", "balance"))
    expect(wrong.status).toBe(405)
    expect(wrong.headers.get("allow")).toBe("GET")
    const own = await handler(req("GET", "own-endpoint"))
    expect(own.status).toBe(200)
    expect(await own.json()).toBeNull()
  })

  it("finds its operation when mounted somewhere else", async () => {
    const { center, calls } = fakeCenter()
    const handler = tokenRoutes(center, {
      userOf: () => alice,
      basePath: "/api/tokens",
    })
    await handler(new Request("https://app.test/internal/proxy/purchase/pur_1"))
    expect(calls[0]).toMatchObject({
      name: "purchase",
      args: ["alice", "pur_1"],
    })
  })
})
