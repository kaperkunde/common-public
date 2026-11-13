import { gql } from "@apollo/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  createUserClient,
  dropClient,
  getUserConnection,
  toWebSocketUrl,
} from "./connection"

afterEach(() => {
  vi.unstubAllGlobals()
})

const doc = (name: string) => gql(`query ${name} { ok }`)

describe("toWebSocketUrl", () => {
  it("swaps the scheme", () => {
    expect(toWebSocketUrl("https://h/v1/graphql")).toBe("wss://h/v1/graphql")
    expect(toWebSocketUrl("http://h/v1/graphql")).toBe("ws://h/v1/graphql")
  })
})

describe("createUserClient", () => {
  it("sends the role and the token getToken returns on every request", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: { ok: true } }), {
          headers: { "content-type": "application/json" },
        }),
    )
    vi.stubGlobal("fetch", fetchMock)
    let n = 0
    const connection = createUserClient({
      endpoint: "http://h/v1/graphql",
      role: "user",
      getToken: () => `tok${++n}`,
    })
    await connection.client.query({ query: doc("A"), fetchPolicy: "no-cache" })
    await connection.client.query({ query: doc("B"), fetchPolicy: "no-cache" })
    const headersOf = (i: number) =>
      (fetchMock.mock.calls[i] as unknown as [string, RequestInit])[1]
        .headers as Record<string, string>
    expect(headersOf(0)).toMatchObject({
      "x-hasura-role": "user",
      authorization: "Bearer tok1",
    })
    // an opaque token has no exp, so it is held rather than fetched again
    expect(headersOf(1).authorization).toBe("Bearer tok1")
    connection.dispose()
  })

  it("tells watchers when the socket's error comes through", async () => {
    const connection = createUserClient({
      endpoint: "http://h/v1/graphql",
      role: "user",
      getToken: () => "t",
    })
    const lost = vi.fn()
    const stop = connection.onConnectionLost(lost)
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("Socket closed with event 1006 ")
      }),
    )
    await connection.client
      .query({ query: doc("C"), fetchPolicy: "no-cache" })
      .catch(() => undefined)
    expect(lost).toHaveBeenCalledOnce()
    stop()
    connection.dispose()
  })
})

describe("getUserConnection and dropClient", () => {
  const base = {
    endpoint: "http://h/v1/graphql",
    role: "user",
    getToken: () => "t",
  }

  it("caches per endpoint, role and key", () => {
    const a = getUserConnection({ ...base, cacheKey: "u1" })
    expect(getUserConnection({ ...base, cacheKey: "u1" })).toBe(a)
    expect(getUserConnection({ ...base, cacheKey: "u2" })).not.toBe(a)
    expect(getUserConnection({ ...base, cacheKey: "u1", role: "ai" })).not.toBe(
      a,
    )
    for (const [cacheKey, role] of [
      ["u1", "user"],
      ["u2", "user"],
      ["u1", "ai"],
    ] as const) {
      dropClient({ endpoint: base.endpoint, role, cacheKey })
    }
  })

  it("drops a connection so the next call builds a fresh one", () => {
    const a = getUserConnection({ ...base, cacheKey: "x" })
    const dispose = vi.spyOn(a, "dispose")
    dropClient({ endpoint: base.endpoint, role: "user", cacheKey: "x" })
    expect(dispose).toHaveBeenCalledOnce()
    const b = getUserConnection({ ...base, cacheKey: "x" })
    expect(b).not.toBe(a)
    dropClient({ endpoint: base.endpoint, role: "user", cacheKey: "x" })
    dropClient({ endpoint: base.endpoint, role: "user", cacheKey: "nothing" })
  })
})
