import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { startStub, type Stub } from "../stub/server.mjs"
import { createTokenApi } from "./browser-api"
import { isTokenError } from "./errors"
import { createTokenCenter, type TokenCenter } from "./server/client"
import {
  callIdFromHeaders,
  chargeFromHeaders,
  gatewayConfig,
  gatewayHeaders,
  parseTrailer,
} from "./server/gateway"
import { nodeHandler } from "./server/node"
import { tokenRoutes } from "./server/routes"
import { tokenErrorOf } from "./server/error-of"
import { webhookRoute } from "./server/webhook"
import type { WebhookEvent } from "./types"

const SECRET = "whsec_integration"
let stub: Stub
let center: TokenCenter
let received: WebhookEvent[] = []
let hookServer: Server
let hookUrl = ""

const control = (path: string, body: unknown = {}) =>
  fetch(`${stub.url}/stub/${path}`, {
    method: "POST",
    body: JSON.stringify(body),
  }).then((r) => r.json())

beforeAll(async () => {
  // The app's webhook endpoint, a real server, for the stub to post to.
  const route = webhookRoute({
    secret: SECRET,
    handlers: Object.fromEntries(
      [
        "grant.received",
        "purchase.completed",
        "purchase.refunded",
        "purchase.refund_failed",
        "balance.low",
        "balance.empty",
        "autorefill.failed",
        "grant.expired",
      ].map((t) => [t, (e: WebhookEvent) => void received.push(e)]),
    ),
  })
  hookServer = createServer(nodeHandler(route))
  await new Promise<void>((ok) => hookServer.listen(0, ok))
  hookUrl = `http://localhost:${(hookServer.address() as AddressInfo).port}/hook`
  stub = await startStub({
    port: 0,
    key: "tk_test_integration",
    webhookUrl: hookUrl,
    webhookSecret: SECRET,
    unitOne: "credit",
    unitMany: "credits",
  })
  center = createTokenCenter({
    baseUrl: stub.url,
    apiKey: "tk_test_integration",
  })
})

afterAll(async () => {
  await stub.close()
  await new Promise((ok) => hookServer.close(ok))
})

beforeEach(async () => {
  stub.reset()
  received = []
  await control("mode", {
    down: false,
    providerError: false,
    fail: null,
  })
})

const until = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i++)
    await new Promise((r) => setTimeout(r, 20))
  expect(check()).toBe(true)
}

describe("against the stub", () => {
  it("reads the app, the models, a new user's balance with the unit", async () => {
    const app = await center.app()
    expect(app.unit).toEqual({
      one: "credit",
      many: "credits",
      perDollar: 1_000_000,
    })
    expect((await center.models()).map((m) => m.id)).toContain(
      "claude-sonnet-5-5",
    )
    const b = await center.balance("u1")
    expect(b.availableMicros).toBe(5_000_000)
    expect(b.known).toBe(false)
  })

  it("rejects a wrong app key as unauthenticated", async () => {
    const wrong = createTokenCenter({
      baseUrl: stub.url,
      apiKey: "tk_test_other",
    })
    expect(await wrong.balance("u1").catch((e) => e.code)).toBe(
      "unauthenticated",
    )
  })

  it("charges a gateway call from the headers, and the ledger agrees with the correlation id", async () => {
    const config = gatewayConfig({
      baseUrl: stub.url,
      apiKey: "tk_test_integration",
      user: "u1",
      attribution: {
        purpose: "dj",
        activity: "Telling Åsa",
        correlation: "usage_1",
      },
    })
    const response = await fetch(`${config.baseURL}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.apiKey,
        ...config.headers,
      },
      body: JSON.stringify({
        model: "claude-sonnet-5-5",
        max_tokens: 10,
        messages: [{ role: "user", content: "hi" }],
      }),
    })
    expect(response.status).toBe(200)
    const charge = chargeFromHeaders(response.headers)!
    expect(charge).toMatchObject({
      source: "tokens",
      costMicros: 600,
      feeMicros: 120,
      chargedMicros: 720,
    })
    const page = await center.calls("u1", { correlation: "usage_1" })
    expect(page.calls).toHaveLength(1)
    expect(page.calls[0]!.callId).toBe(charge.callId)
    expect(page.calls[0]!.attribution.activity).toBe("Telling Åsa")
    expect(page.totals.chargedMicros).toBe(720)
    const one = await center.call(charge.callId, { wait: 1 })
    expect(one.status).toBe("charged")
    expect((await center.balance("u1")).availableMicros).toBe(5_000_000 - 720)
  })

  it("streams, then finds the charge through the trailer and through the call", async () => {
    const headers = gatewayHeaders({ user: "u1", trailer: true })
    const response = await fetch(`${stub.url}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": "tk_test_integration",
        ...headers,
      },
      body: JSON.stringify({
        model: "claude-sonnet-5-5",
        max_tokens: 10,
        stream: true,
        messages: [],
      }),
    })
    const callId = callIdFromHeaders(response.headers)!
    const trailer = parseTrailer<{ callId: string; chargedMicros: number }>(
      await response.text(),
    )
    expect(trailer?.callId).toBe(callId)
    expect((await center.call(callId)).chargedMicros).toBe(
      trailer?.chargedMicros,
    )
  })

  it("maps an empty wallet and a provider failure the way tokenErrorOf reads an SDK error", async () => {
    await control("balance", { userId: "u1", purchasedMicros: 0 })
    const post = () =>
      fetch(`${stub.url}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": "tk_test_integration",
          ...gatewayHeaders({ user: "u1" }),
        },
        body: JSON.stringify({
          model: "claude-sonnet-5-5",
          max_tokens: 10,
          messages: [],
        }),
      })
    const empty = await post()
    expect(empty.status).toBe(402)
    const asSdkError = {
      statusCode: empty.status,
      responseHeaders: Object.fromEntries(empty.headers),
      responseBody: await empty.text(),
    }
    expect(tokenErrorOf(asSdkError)).toMatchObject({
      code: "insufficient_balance",
      status: 402,
    })
    expect(tokenErrorOf(asSdkError)?.action).toBe("buy_tokens")

    await control("balance", { userId: "u1", purchasedMicros: 5_000_000 })
    await control("mode", { providerError: true })
    const failed = await post()
    expect(
      tokenErrorOf({
        statusCode: failed.status,
        responseHeaders: Object.fromEntries(failed.headers),
        responseBody: await failed.text(),
      })?.code,
    ).toBe("provider_error")
  })

  it("simulates provider refusals, and a voice that falls back", async () => {
    await control("mode", { fail: "out_of_credit" })
    const chat = () =>
      fetch(`${stub.url}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": "tk_test_integration",
          ...gatewayHeaders({ user: "u1" }),
        },
        body: JSON.stringify({
          model: "claude-sonnet-5-5",
          max_tokens: 10,
          messages: [],
        }),
      })
    const out = await chat()
    expect(out.status).toBe(503)
    expect(out.headers.get("x-should-retry")).toBe("false")
    const refused = tokenErrorOf({
      statusCode: 503,
      responseHeaders: Object.fromEntries(out.headers),
      responseBody: await out.text(),
    })
    expect(refused?.code).toBe("provider_out_of_credit")
    expect(refused?.detail.provider).toBe("anthropic")
    expect(refused?.detail.model).toBe("claude-sonnet-5-5")
    expect(refused?.retryable).toBe(false)

    await control("mode", { fail: "rate_limited" })
    const slow = await chat()
    expect(slow.status).toBe(429)
    expect(slow.headers.get("retry-after")).toBe("7")
    await control("mode", { fail: "overloaded" })
    const busy = await chat()
    expect(busy.status).toBe(503)
    expect(
      tokenErrorOf({
        statusCode: 503,
        responseHeaders: Object.fromEntries(busy.headers),
        responseBody: await busy.text(),
      })?.code,
    ).toBe("provider_overloaded")

    // Speech does not fail: it falls to the app's other voice and says which.
    const spoken = await center.speech({ user: "u1" }, { input: "Hi" })
    expect(spoken.voiceFallback).toBe("stub-voice-eleven")
    await control("mode", { fail: null })
    const plain = await center.speech({ user: "u1" }, { input: "Hi" })
    expect(plain.voiceFallback).toBeNull()
  })

  it("exposes the call on a provider failure, through the client and tokenErrorOf", async () => {
    await control("mode", { providerError: true })
    const response = await fetch(`${stub.url}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": "tk_test_integration",
        ...gatewayHeaders({ user: "u1" }),
      },
      body: JSON.stringify({
        model: "claude-sonnet-5-5",
        max_tokens: 10,
        messages: [],
      }),
    })
    expect(response.status).toBe(502)
    const failure = tokenErrorOf({
      statusCode: 502,
      responseHeaders: Object.fromEntries(response.headers),
      responseBody: await response.text(),
    })
    expect(failure?.code).toBe("provider_error")
    expect(failure?.callId).toMatch(/^call_/)
    expect(response.headers.get("x-token-call-id")).toBe(failure?.callId)
  })

  it("fails closed when the stub says it is down, and when it is gone", async () => {
    await control("mode", { down: true })
    expect(await center.balance("u1").catch((e) => e.code)).toBe(
      "center_unavailable",
    )
    const gone = createTokenCenter({
      baseUrl: "http://127.0.0.1:1",
      apiKey: "k",
      timeoutMs: 500,
    })
    expect(await gone.balance("u1").catch((e) => e.code)).toBe(
      "center_unavailable",
    )
  })

  it("speaks: audio bytes with the characters and the charge", async () => {
    const out = await center.speech(
      { user: "u1", attribution: { purpose: "voice" } },
      { input: "Hello there" },
    )
    expect(out.audio.byteLength).toBe(5004)
    expect(out.chars).toBe(11)
    expect(out.charge?.chargedMicros).toBeGreaterThan(0)
  })

  it("answers audio that is real MP3 frames, and a null own endpoint as 200", async () => {
    const out = await center.speech({ user: "u9" }, { input: "Hi" })
    const b = out.audio
    expect(b.byteLength % 417).toBe(0)
    for (let i = 0; i < b.byteLength; i += 417) {
      expect(b[i]).toBe(0xff)
      expect(b[i + 1]! & 0xe0).toBe(0xe0)
    }
    expect(out.contentType).toBe("audio/mpeg")
    const raw = await fetch(`${stub.url}/api/v1/users/u9/own-endpoint`, {
      headers: { authorization: "Bearer tk_test_integration" },
    })
    expect(raw.status).toBe(200)
    expect(await raw.json()).toBeNull()
  })

  it("carries the app's packs, the tool choice and the cache split", async () => {
    expect((await center.app()).purchaseOptions.packsCents).toEqual([
      500, 1000, 2500, 5000,
    ])
    expect((await center.salePrices()).options.packsOnly).toBe(false)
    const own = await center.saveOwnEndpoint("u1", {
      baseUrl: "https://llm.example/v1",
      models: ["m"],
      capabilities: ["tools"],
      toolChoice: "required",
      monthlyTokenLimit: null,
      order: "own_then_tokens",
    })
    expect(own.toolChoice).toBe("required")
    expect((await center.calls("u1")).totals).toHaveProperty(
      "cacheWrite5mTokens",
    )
  })

  it("routes by the user's order, with the capability fallback", async () => {
    expect(
      (await center.route({ userId: "u1", model: "claude-sonnet-5-5" })).source,
    ).toBe("tokens")
    await center.saveOwnEndpoint("u1", {
      baseUrl: "https://llm.example/v1",
      apiKey: "sk-abcd1234",
      models: ["m1"],
      capabilities: ["streaming"],
      monthlyTokenLimit: null,
      order: "own_only",
    })
    const own = await center.ownEndpoint("u1")
    expect(own).toMatchObject({ hasKey: true, keyHint: "1234" })
    expect(JSON.stringify(own)).not.toContain("sk-abcd1234")
    expect(
      (await center.route({ userId: "u1", model: "claude-sonnet-5-5" })).source,
    ).toBe("own")
    const voice = await center.route({
      userId: "u1",
      model: "claude-sonnet-5-5",
      needs: ["voice"],
    })
    expect(voice).toMatchObject({ source: "tokens" })
    expect(voice.fallback?.reason).toBe("capability")
  })

  it("receives signed webhooks: a grant, a purchase through checkout, and an expiry", async () => {
    await control("grant", { userId: "u1", micros: 8_000_000, reason: "drop" })
    await until(() => received.some((e) => e.type === "grant.received"))

    const session = await center.checkout("u1", {
      currency: "eur",
      amountCents: 1000,
      successUrl: "http://localhost/done?p={PURCHASE_ID}",
      cancelUrl: "http://localhost/no",
    })
    expect(session.creditMicros).toBe(8_264_462) // 1000 cents at 121 cents per dollar
    const redirect = await fetch(session.url, { redirect: "manual" })
    expect(redirect.status).toBe(303)
    expect(redirect.headers.get("location")).toBe(
      `http://localhost/done?p=${session.purchaseId}`,
    )
    await until(() => received.some((e) => e.type === "purchase.completed"))
    expect((await center.purchase("u1", session.purchaseId)).status).toBe(
      "paid",
    )
    const history = await center.history("u1")
    expect(history.entries.map((e) => e.type)).toEqual(["purchase", "grant"])

    const lot = (await center.balance("u1")).lots[0]!
    await control("expire", { lotId: lot.id })
    await until(() => received.some((e) => e.type === "grant.expired"))
  })

  it("lists purchases and refunds unspent credit through the center client, once per key, with the webhook", async () => {
    const session = await center.checkout("u1", {
      currency: "eur",
      amountCents: 1000,
      successUrl: "http://localhost/done",
      cancelUrl: "http://localhost/no",
    })
    await fetch(session.url, { redirect: "manual" })
    const credit = session.creditMicros

    const before = await center.purchases("u1")
    expect(before.purchases).toHaveLength(1)
    expect(before.purchases[0]).toMatchObject({
      id: session.purchaseId,
      refundableCreditMicros: credit,
      refundedCents: 0,
    })
    expect(before.purchases[0]!.refundableCents).toBe(1000)

    const part = await center.refund(
      "u1",
      session.purchaseId,
      { creditMicros: Math.floor(credit / 2) },
      { idempotencyKey: "k1" },
    )
    expect(part).toMatchObject({ status: "succeeded", initiatedBy: "app" })
    expect(part.amountCents).toBe(500)
    // The same key is the same refund, not a second.
    const again = await center.refund(
      "u1",
      session.purchaseId,
      { creditMicros: Math.floor(credit / 2) },
      { idempotencyKey: "k1" },
    )
    expect(again.id).toBe(part.id)
    await until(() => received.some((e) => e.type === "purchase.refunded"))
    const after = (await center.purchases("u1")).purchases[0]!
    expect(after.refundedCents).toBe(500)

    const tooMuch = await center
      .refund(
        "u1",
        session.purchaseId,
        { creditMicros: credit },
        { idempotencyKey: "k2" },
      )
      .catch((e) => e)
    expect(isTokenError(tooMuch, "refund_amount_invalid")).toBe(true)
    expect(tooMuch.refundableCreditMicros).toBe(after.refundableCreditMicros)

    await control("mode", { refundRefused: true })
    const refused = await center
      .refund("u1", session.purchaseId, {}, { idempotencyKey: "k3" })
      .catch((e) => e)
    expect(isTokenError(refused, "refund_refused_by_processor")).toBe(true)
    await control("mode", { refundRefused: false })

    const rest = await center.refund(
      "u1",
      session.purchaseId,
      {},
      { idempotencyKey: "k4" },
    )
    expect(rest.amountCents).toBe(500)
    const none = await center
      .refund("u1", session.purchaseId, {}, { idempotencyKey: "k5" })
      .catch((e) => e)
    expect(isTokenError(none, "refund_not_available")).toBe(true)
    expect(none.refundableCreditMicros).toBe(0)

    const types = (await center.history("u1")).entries.map((e) => e.type)
    expect(types.filter((t) => t === "refund")).toHaveLength(2)
    expect(
      (await center.purchase("other", session.purchaseId).catch((e) => e)).code,
    ).toBe("not_found")
  })

  it("is mounted through tokenRoutes, which serves the browser client with only a session", async () => {
    const routes = tokenRoutes(center, {
      origin: "http://localhost",
      userOf: (r) =>
        r.headers.get("cookie") === "session=ok"
          ? { id: "browser-user", email: "b@example.com" }
          : null,
    })
    const app = createServer(nodeHandler(routes))
    await new Promise<void>((ok) => app.listen(0, ok))
    try {
      const base = `http://localhost:${(app.address() as AddressInfo).port}/api/tokens`
      const withSession = (init: RequestInit = {}) => ({
        ...init,
        headers: { ...init.headers, cookie: "session=ok" },
      })
      const balance = (await (
        await fetch(`${base}/balance`, withSession())
      ).json()) as { userId: string; availableMicros: number }
      expect(balance).toMatchObject({
        userId: "browser-user",
        availableMicros: 5_000_000,
      })
      expect((await fetch(`${base}/balance`)).status).toBe(401)

      const api = createTokenApi({
        basePath: base,
        fetch: ((url: string, init: RequestInit) =>
          fetch(url, {
            ...init,
            headers: { ...init.headers, cookie: "session=ok" },
          })) as typeof fetch,
      })
      const session = await api.checkout({
        currency: "usd",
        amountCents: 500,
        returnPath: "/ai/tokens",
      })
      expect(session.url).toContain("/stub/checkout/")
      expect(await api.ownEndpoint()).toBeNull()
      // A purchase of one's own, paid at the stand-in's checkout, refunded from the browser.
      await fetch(session.url, { redirect: "manual" })
      const mine = await api.purchases()
      expect(mine.purchases[0]!.refundableCents).toBe(500)
      const refunded = await api.refund(
        mine.purchases[0]!.id,
        {},
        "browser-key-1",
      )
      expect(refunded.status).toBe("succeeded")
      expect(refunded.amountCents).toBe(500)
      const refill = await api.setAutoRefill({
        enabled: false,
        thresholdMicros: 1_000_000,
        amountCents: 2000,
        currency: "eur",
        monthlyMaxCents: 8000,
      })
      expect(refill.amountCents).toBe(2000)
      const error = await api
        .setAutoRefill({
          enabled: true,
          thresholdMicros: 1,
          amountCents: 1000,
          currency: "eur",
          monthlyMaxCents: 5000,
        })
        .catch((e) => e)
      expect(isTokenError(error, "no_card")).toBe(true)
      expect((await center.upsertUser("browser-user", {})).email).toBe(
        "b@example.com",
      )
    } finally {
      await new Promise((ok) => app.close(ok))
    }
  })
})
