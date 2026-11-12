import { describe, expect, it, vi } from "vitest"

import {
  HasuraError,
  UNEXPLAINED,
  createServerClient,
  forwardGraphql,
  hasuraAdminHeaders,
  hasuraHeaders,
  postGraphql,
  unexplainedRefusal,
} from "./courier"

const answer = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }))

describe("headers", () => {
  it("names the role and the credential", () => {
    expect(hasuraHeaders("t", "user")).toEqual({
      "X-Hasura-Role": "user",
      Authorization: "Bearer t",
    })
    expect(hasuraAdminHeaders("s", "server")).toEqual({
      "X-Hasura-Role": "server",
      "X-Hasura-Admin-Secret": "s",
    })
  })
})

describe("postGraphql and forwardGraphql", () => {
  it("posts the document and returns the body untouched", async () => {
    const fetchMock = answer({ data: { x: 1 } })
    const result = await postGraphql(
      "http://h/v1/graphql",
      { a: "b" },
      { query: "{x}", variables: null },
      fetchMock as unknown as typeof fetch,
    )
    expect(result).toEqual({ status: 200, body: { data: { x: 1 } } })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe("http://h/v1/graphql")
    expect(JSON.parse(init.body as string)).toEqual({ query: "{x}" })
    expect((init.headers as Record<string, string>).a).toBe("b")
  })

  it("reports a body that is not JSON as an error", async () => {
    const result = await postGraphql(
      "http://h",
      {},
      { query: "{x}" },
      (async () => new Response("<html>", { status: 502 })) as typeof fetch,
    )
    expect(result.status).toBe(502)
    expect(result.body.errors?.[0]?.message).toMatch(/not JSON/)
  })

  it("forwards under the caller's token and role and tells the observer", async () => {
    const fetchMock = answer({ data: {} })
    const seen = vi.fn()
    await forwardGraphql(
      { query: "mutation{a}", operationName: "A" },
      {
        endpoint: "http://h",
        token: "tok",
        role: "ai",
        fetch: fetchMock as unknown as typeof fetch,
        onResult: seen,
      },
    )
    const init = (
      fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    )[1]
    expect(init.headers).toMatchObject({
      Authorization: "Bearer tok",
      "X-Hasura-Role": "ai",
    })
    expect(seen).toHaveBeenCalledOnce()
    expect(seen.mock.calls[0]?.[0]).toEqual({
      query: "mutation{a}",
      operationName: "A",
    })
  })
})

describe("createServerClient", () => {
  it("sends the admin secret and returns data", async () => {
    const fetchMock = answer({ data: { n: 2 } })
    const client = createServerClient({
      endpoint: "http://h",
      adminSecret: "adm",
      role: "server",
      fetch: fetchMock as unknown as typeof fetch,
    })
    await expect(client.execute<{ n: number }>("{n}")).resolves.toEqual({
      n: 2,
    })
    const init = (
      fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    )[1]
    expect(init.headers).toMatchObject({
      "X-Hasura-Admin-Secret": "adm",
      "X-Hasura-Role": "server",
    })
  })

  it("throws HasuraError carrying the messages", async () => {
    const client = createServerClient({
      endpoint: "http://h",
      adminSecret: "adm",
      role: "server",
      fetch: answer({
        errors: [{ message: "nope" }, { message: "again" }],
      }) as unknown as typeof fetch,
    })
    await expect(client.execute("{n}")).rejects.toThrow(HasuraError)
    await expect(client.execute("{n}")).rejects.toThrow("nope; again")
  })

  it("refuses to be built without an endpoint or a secret", () => {
    expect(() =>
      createServerClient({ endpoint: "", adminSecret: "a", role: "r" }),
    ).toThrow()
    expect(() =>
      createServerClient({ endpoint: "x", adminSecret: "", role: "r" }),
    ).toThrow()
  })
})

describe("unexplainedRefusal", () => {
  it("speaks only when Hasura gave no reason", () => {
    expect(
      unexplainedRefusal(
        { errors: [{ message: UNEXPLAINED }] },
        "Call whoami.",
      ),
    ).toContain("Call whoami.")
    expect(
      unexplainedRefusal({ errors: [{ message: "Because." }] }),
    ).toBeUndefined()
    expect(unexplainedRefusal({})).toBeUndefined()
    expect(
      unexplainedRefusal({ errors: [{ message: UNEXPLAINED }] }),
    ).not.toContain("undefined")
  })
})
