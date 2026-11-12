import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { exportJWK, generateKeyPair, SignJWT } from "jose"
import { describe, expect, it, vi } from "vitest"

import {
  createBearerVerifier,
  jwksVerifier,
  type BearerIdentity,
} from "./bearer"
import { createDoor, protectedResourceMetadata } from "./door"
import { headerPairs, noStore, sendWebResponse, toWebRequest } from "./http"
import { DEFAULT_BUCKETS, requestKind, rpcIdOf, tooManyBody } from "./rate"
import {
  consentRequest,
  describeScopes,
  isAuthorizeQuery,
  mcpUrl,
  resumeAuthorizeUrl,
  scopesOf,
  webAddress,
} from "./scopes"

const call = (name: string, id: number = 1) => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name },
})

describe("requestKind and friends", () => {
  it("counts protocol requests and read tools as reads, other tools as writes", () => {
    const classifier = { readTools: new Set(["whoami"]) }
    expect(requestKind({ method: "initialize" }, classifier)).toBe("read")
    expect(requestKind({ method: "tools/list" })).toBe("read")
    expect(requestKind(call("whoami"), classifier)).toBe("read")
    expect(requestKind(call("list_things"))).toBe("read")
    expect(requestKind(call("get_x"))).toBe("read")
    expect(requestKind(call("move_things"), classifier)).toBe("write")
    expect(requestKind(call("unknown"))).toBe("write")
    expect(requestKind(null)).toBe("read")
    expect(requestKind([call("whoami"), call("mutate")], classifier)).toBe(
      "write",
    )
    expect(requestKind(call("x"), { readPattern: /^x$/ })).toBe("read")
  })
  it("answers the request's own id, or null", () => {
    expect(rpcIdOf({ id: 7 })).toBe(7)
    expect(rpcIdOf({ id: "a" })).toBe("a")
    expect(rpcIdOf([{ id: 1 }])).toBeNull()
    expect(rpcIdOf(null)).toBeNull()
    expect(rpcIdOf({ id: {} })).toBeNull()
  })
  it("words the 429 with what a program needs to back off", () => {
    const body = tooManyBody("write", 12, 5)
    expect(body.id).toBe(5)
    expect(body.error.data).toEqual({
      retryAfterSeconds: 12,
      bucket: "write",
      limit: 120,
      windowSeconds: 60,
    })
    expect(body.error.message).toContain("120 a minute")
    expect(body.error.message).toContain("reads still go through")
    const read = tooManyBody("read", 3, null, {
      ...DEFAULT_BUCKETS,
      read: { limit: 5, windowMs: 30_000 },
    })
    expect(read.error.message).toContain("5 a 30 s")
    expect(read.error.message).not.toContain("reads still")
  })
})

describe("scope helpers", () => {
  it("builds addresses and reads scope claims", () => {
    expect(mcpUrl("https://a.b/", "/api/mcp")).toBe("https://a.b/api/mcp")
    expect(mcpUrl("https://a.b", "api/mcp")).toBe("https://a.b/api/mcp")
    expect([...scopesOf("a  b")]).toEqual(["a", "b"])
    expect(scopesOf(undefined).size).toBe(0)
  })
  it("draws only http(s) client addresses as links", () => {
    expect(webAddress("https://x.y/a")).toBe("https://x.y/a")
    expect(webAddress("javascript:alert(1)")).toBeUndefined()
    expect(webAddress("nope")).toBeUndefined()
    expect(webAddress(3)).toBeUndefined()
  })
  it("describes known scopes in their words and others by name", () => {
    expect(
      describeScopes(["r", "z"], [{ scope: "r", label: "Read", caption: "c" }]),
    ).toEqual([
      { scope: "r", label: "Read", caption: "c" },
      { scope: "z", label: "z", caption: "" },
    ])
  })
  it("resumes an authorize request without its signature and spent prompts", () => {
    const search =
      "?client_id=c&scope=a+b&prompt=login+consent&sig=s&exp=1&ba_iat=2"
    expect(isAuthorizeQuery(search)).toBe(true)
    expect(isAuthorizeQuery("?x=1")).toBe(false)
    expect(resumeAuthorizeUrl(search)).toBe(
      "/api/auth/oauth2/authorize?client_id=c&scope=a+b&prompt=consent",
    )
    expect(resumeAuthorizeUrl("?client_id=c&sig=s&prompt=login", "/auth")).toBe(
      "/auth?client_id=c",
    )
    expect(resumeAuthorizeUrl("?client_id=c")).toBeUndefined()
    expect(consentRequest("?client_id=c&scope=a%20b")).toEqual({
      clientId: "c",
      scopes: ["a", "b"],
    })
    expect(consentRequest("?x=1")).toBeUndefined()
  })
})

describe("createBearerVerifier", () => {
  const verifyToken = vi.fn(async (token: string) => {
    if (token === "bad") throw new Error("bad signature")
    if (token === "nosub") return { client_id: "c" }
    return { sub: "u1", client_id: "c1", scope: "r w offline" }
  })
  const make = (consent: unknown) =>
    createBearerVerifier({ verifyToken, loadConsent: async () => consent })

  it("narrows scopes to what the consent still allows", async () => {
    expect(await make(["r", "offline"])("bearer good")).toEqual({
      userId: "u1",
      clientId: "c1",
      scopes: new Set(["r", "offline"]),
    })
    expect((await make("r w")("Bearer good"))?.scopes).toEqual(
      new Set(["r", "w"]),
    )
  })
  it("is nobody for a disconnected client, a bad or sub-less token, or no header", async () => {
    expect(await make(null)("Bearer good")).toBeUndefined()
    expect(await make(["r"])("Bearer bad")).toBeUndefined()
    expect(await make(["r"])("Bearer nosub")).toBeUndefined()
    expect(await make(["r"])(undefined)).toBeUndefined()
    expect(await make(["r"])("Basic abc")).toBeUndefined()
  })
})

describe("jwksVerifier", () => {
  it("verifies signature, issuer, audience and expiry against a key set, and keeps the set for its ttl", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256")
    const jwk = { ...(await exportJWK(publicKey)), alg: "RS256", kid: "k1" }
    let now = 0
    const jwks = vi.fn(async () => ({ keys: [jwk] }))
    const verify = jwksVerifier({
      jwks,
      issuer: "https://i",
      audience: "https://i/mcp",
      ttlMs: 1000,
      now: () => now,
    })
    const sign = (
      claims: Record<string, unknown>,
      issuer = "https://i",
      audience = "https://i/mcp",
      exp = "5m",
    ) =>
      new SignJWT({ scope: "r", client_id: "c", ...claims })
        .setProtectedHeader({ alg: "RS256", kid: "k1" })
        .setSubject("u1")
        .setIssuer(issuer)
        .setAudience(audience)
        .setExpirationTime(exp)
        .sign(privateKey)
    const payload = await verify(await sign({}))
    expect(payload).toMatchObject({ sub: "u1", client_id: "c" })
    await verify(await sign({}))
    expect(jwks).toHaveBeenCalledTimes(1)
    now = 5000
    await verify(await sign({}))
    expect(jwks).toHaveBeenCalledTimes(2)
    await expect(verify(await sign({}, "https://other"))).rejects.toThrow()
    await expect(
      verify(await sign({}, "https://i", "https://elsewhere")),
    ).rejects.toThrow()
    await expect(
      verify(await sign({}, "https://i", "https://i/mcp", "-1m")),
    ).rejects.toThrow()
    await expect(verify("garbage")).rejects.toThrow()
    const other = await generateKeyPair("RS256")
    const forged = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setSubject("u")
      .setIssuer("https://i")
      .setAudience("https://i/mcp")
      .setExpirationTime("5m")
      .sign(other.privateKey)
    await expect(verify(forged)).rejects.toThrow()
  })
})

const identity: BearerIdentity = {
  userId: "u1",
  clientId: "c",
  scopes: new Set(["r"]),
}
const door = (
  over: Partial<Parameters<typeof createDoor<{ id: string }>>[0]> = {},
) => {
  const counts = new Map<string, number>()
  return createDoor<{ id: string }>({
    verifyBearer: async (header) =>
      header === "Bearer ok" ? identity : undefined,
    resolve: async (who) => ({
      ok: true,
      caller: { id: who.userId },
      rateKey: who.userId,
    }),
    resourceMetadataUrl: "https://i/.well-known/oauth-protected-resource",
    scopes: ["r", "w"],
    rateLimit: (key, { max }) => {
      const n = (counts.get(key) ?? 0) + 1
      counts.set(key, n)
      return { allowed: n <= max, retryAfterMs: 1500 }
    },
    buckets: {
      read: { limit: 3, windowMs: 60_000 },
      write: { limit: 1, windowMs: 60_000 },
    },
    classifier: { readTools: new Set(["whoami"]) },
    ...over,
  })
}

describe("createDoor", () => {
  it("admits a known caller and counts reads and writes in separate buckets", async () => {
    const d = door()
    expect(await d.admit("Bearer ok", call("mutate"))).toMatchObject({
      ok: true,
      caller: { id: "u1" },
    })
    const second = await d.admit("Bearer ok", call("mutate", 9))
    expect(second).toMatchObject({
      ok: false,
      refusal: { status: 429, headers: { "Retry-After": "2" } },
    })
    expect(
      (second as { refusal: { body: { id: number } } }).refusal.body.id,
    ).toBe(9)
    expect((await d.admit("Bearer ok", call("whoami"))).ok).toBe(true)
  })

  it("sends a client to sign in with the challenge, and says when the token was the problem", async () => {
    const d = door()
    const none = await d.admit(undefined, {})
    expect(none).toMatchObject({ ok: false, refusal: { status: 401 } })
    const header = (none as { refusal: { headers: Record<string, string> } })
      .refusal.headers["WWW-Authenticate"]
    expect(header).toContain(
      'resource_metadata="https://i/.well-known/oauth-protected-resource"',
    )
    expect(header).toContain('scope="r w"')
    expect(header).not.toContain("invalid_token")
    const bad = await d.admit("Bearer nope", {})
    expect(
      (
        bad as {
          refusal: {
            headers: Record<string, string>
            body: { error: { message: string } }
          }
        }
      ).refusal.headers["WWW-Authenticate"],
    ).toContain('error="invalid_token"')
    const custom = await door({
      messages: { invalidToken: "X", signIn: "Y" },
    }).admit(undefined, {})
    expect(
      (custom as { refusal: { body: { error: { message: string } } } }).refusal
        .body.error.message,
    ).toBe("Y")
  })

  it("passes on the app's own refusal, and treats an unresolved identity as an unknown token", async () => {
    const waitlist = await door({
      resolve: async () => ({
        ok: false,
        status: 403,
        message: "On the waitlist.",
      }),
    }).admit("Bearer ok", {})
    expect(waitlist).toMatchObject({
      ok: false,
      refusal: {
        status: 403,
        body: { error: { message: "On the waitlist." } },
      },
    })
    const gone = await door({ resolve: async () => undefined }).admit(
      "Bearer ok",
      {},
    )
    expect(gone).toMatchObject({ ok: false, refusal: { status: 401 } })
  })

  it("serves the app router: the caller, or the Response, leaving the request readable", async () => {
    const d = door()
    const request = new Request("https://i/mcp", {
      method: "POST",
      headers: { authorization: "Bearer ok" },
      body: JSON.stringify(call("whoami")),
    })
    expect(await d.admitWeb(request)).toEqual({ caller: { id: "u1" } })
    expect(await request.json()).toMatchObject({ method: "tools/call" })
    const refused = await d.admitWeb(
      new Request("https://i/mcp", { method: "GET" }),
    )
    const { response } = refused as { response: Response }
    expect(response.status).toBe(401)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(response.headers.get("www-authenticate")).toContain("Bearer")
    expect((await response.json()).error.code).toBe(-32000)
  })

  it("serves the pages router: sets no-store and answers a refusal itself", async () => {
    const d = door()
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      const body = JSON.parse(Buffer.concat(chunks).toString() || "null")
      const caller = await d.admitNode(Object.assign(req, { body }), res)
      if (caller) res.end(JSON.stringify({ caller }))
    })
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
    const { port } = server.address() as AddressInfo
    try {
      const url = `http://127.0.0.1:${port}/`
      const ok = await fetch(url, {
        method: "POST",
        headers: { authorization: "Bearer ok" },
        body: JSON.stringify(call("whoami")),
      })
      expect(await ok.json()).toEqual({ caller: { id: "u1" } })
      expect(ok.headers.get("cache-control")).toBe("no-store")
      const refused = await fetch(url, { method: "POST", body: "{}" })
      expect(refused.status).toBe(401)
      expect(refused.headers.get("www-authenticate")).toContain(
        "resource_metadata",
      )
      expect((await refused.json()).jsonrpc).toBe("2.0")
    } finally {
      server.closeAllConnections()
      await new Promise((r) => server.close(r))
    }
  })
})

describe("protectedResourceMetadata", () => {
  it("is the RFC 9728 document, with the optional parts only when given", () => {
    expect(
      protectedResourceMetadata({
        resource: "https://i/mcp",
        authorizationServers: ["https://i"],
        scopes: ["r"],
      }),
    ).toEqual({
      resource: "https://i/mcp",
      authorization_servers: ["https://i"],
      bearer_methods_supported: ["header"],
      scopes_supported: ["r"],
    })
    expect(
      protectedResourceMetadata({
        resource: "r",
        authorizationServers: [],
        scopes: [],
        name: "N",
        documentation: "D",
      }),
    ).toMatchObject({ resource_name: "N", resource_documentation: "D" })
  })
})

describe("the Node bridge", () => {
  it("rebuilds a Request from Node's, with the parsed body written back", async () => {
    const seen: Request[] = []
    const server = createServer(async (req, res) => {
      const body = { jsonrpc: "2.0", id: 1 }
      const request = toWebRequest(
        req,
        req.method === "POST" ? body : undefined,
      )
      seen.push(request)
      expect(headerPairs({ a: "1", b: ["x", "y"], c: undefined })).toEqual([
        ["a", "1"],
        ["b", "x, y"],
      ])
      await sendWebResponse(
        res,
        new Response("a-b-c", { status: 201, headers: { "x-t": "1" } }),
      )
    })
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
    const { port } = server.address() as AddressInfo
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/mcp?x=1`, {
        method: "POST",
        body: "{}",
        headers: { "x-k": "v" },
      })
      expect(res.status).toBe(201)
      expect(res.headers.get("x-t")).toBe("1")
      expect(await res.text()).toBe("a-b-c")
      expect(seen[0]!.url).toBe(`http://127.0.0.1:${port}/api/mcp?x=1`)
      expect(seen[0]!.headers.get("x-k")).toBe("v")
      expect(await seen[0]!.json()).toEqual({ jsonrpc: "2.0", id: 1 })
      const get = await fetch(`http://127.0.0.1:${port}/`)
      expect(get.status).toBe(201)
      expect(seen[1]!.method).toBe("GET")
    } finally {
      server.closeAllConnections()
      await new Promise((r) => server.close(r))
    }
  })

  it("streams chunks as they arrive, flushing each, and ends an empty body", async () => {
    const written: string[] = []
    const flush = vi.fn()
    const res = {
      statusCode: 0,
      setHeader: vi.fn(),
      write: (c: Uint8Array) => written.push(new TextDecoder().decode(c)),
      end: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      flush,
    }
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode("one"))
        c.enqueue(new TextEncoder().encode("two"))
        c.close()
      },
    })
    await sendWebResponse(res as never, new Response(stream, { status: 200 }))
    expect(written).toEqual(["one", "two"])
    expect(flush).toHaveBeenCalledTimes(2)
    expect(res.end).toHaveBeenCalledOnce()
    const empty = { ...res, end: vi.fn() }
    await sendWebResponse(empty as never, new Response(null, { status: 204 }))
    expect(empty.end).toHaveBeenCalledOnce()
  })

  it("marks an app-router response no-store, keeping its body and status", async () => {
    const out = noStore(
      new Response("hi", { status: 202, headers: { a: "b" } }),
    )
    expect(out.headers.get("cache-control")).toBe("no-store")
    expect(out.headers.get("a")).toBe("b")
    expect(out.status).toBe(202)
    expect(await out.text()).toBe("hi")
  })
})
