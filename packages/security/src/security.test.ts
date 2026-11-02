import { afterEach, describe, expect, it, vi } from "vitest"

import {
  BootRefusedError,
  bearerToken,
  checkRateLimit,
  clientIpFromHeaders,
  createLinkTokens,
  createSecretBox,
  isAdmin,
  isSameOrigin,
  isSealed,
  matchesSecret,
  rateLimitSize,
  redact,
  refundRateLimit,
  resetRateLimits,
  runBootChecks,
  safeCallbackUrl,
  safeEqual,
  secretProblem,
} from "./index"

afterEach(() => resetRateLimits())

describe("checkRateLimit", () => {
  it("allows max in a window, then says how long to wait", () => {
    const limit = { max: 2, windowMs: 1000 }
    expect(checkRateLimit("k", limit, 0).allowed).toBe(true)
    expect(checkRateLimit("k", limit, 10).allowed).toBe(true)
    expect(checkRateLimit("k", limit, 400)).toEqual({
      allowed: false,
      retryAfterMs: 600,
    })
    expect(checkRateLimit("k", limit, 1000).allowed).toBe(true)
  })

  it("gives a count back", () => {
    const limit = { max: 1, windowMs: 1000 }
    checkRateLimit("k", limit, 0)
    refundRateLimit("k", 1)
    expect(checkRateLimit("k", limit, 2).allowed).toBe(true)
  })

  it("is bounded, and never drops an instance-wide cap", () => {
    const limit = { max: 1, windowMs: 60_000 }
    checkRateLimit("all:*", limit, 0)
    for (let i = 0; i < 10_050; i++) checkRateLimit(`ip:${i}`, limit, 0)
    expect(rateLimitSize()).toBe(10_000)
    expect(checkRateLimit("all:*", limit, 0).allowed).toBe(false)
  })
})

describe("clientIpFromHeaders", () => {
  const h = (xff: string) => new Headers({ "x-forwarded-for": xff })

  it("takes the left-most entry without trusted proxies", () => {
    expect(clientIpFromHeaders(h("1.2.3.4, 10.0.0.1"))).toBe("1.2.3.4")
    expect(clientIpFromHeaders(new Headers())).toBe("local")
  })

  it("walks from the right past trusted proxies", () => {
    const opts = { trustedProxies: "10.0.0.0/8" }
    expect(clientIpFromHeaders(h("6.6.6.6, 1.2.3.4, 10.0.0.1"), opts)).toBe(
      "1.2.3.4",
    )
    expect(clientIpFromHeaders(h("::ffff:1.2.3.4"), opts)).toBe("1.2.3.4")
  })

  it("hashes what is not an address", () => {
    expect(clientIpFromHeaders(h("not-an-ip"))).toMatch(/^h:[0-9a-f]{32}$/)
  })
})

describe("safeCallbackUrl", () => {
  it("keeps a path on this site", () => {
    expect(safeCallbackUrl("/a?b=1")).toBe("/a?b=1")
  })

  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/\t/evil.example",
    "/\n/evil.example",
  ])("falls back for %j", (value) => {
    expect(safeCallbackUrl(value, "/home")).toBe("/home")
  })

  it("falls back for a list or nothing", () => {
    expect(safeCallbackUrl(["/a", "/b"])).toBe("/")
    expect(safeCallbackUrl(undefined)).toBe("/")
  })
})

describe("isSameOrigin", () => {
  const req = (headers: Record<string, string>) =>
    new Request("http://app.example/x", { method: "POST", headers })

  it("trusts Sec-Fetch-Site, then Origin, and refuses neither", () => {
    expect(isSameOrigin(req({ "sec-fetch-site": "same-origin" }))).toBe(true)
    expect(isSameOrigin(req({ "sec-fetch-site": "cross-site" }))).toBe(false)
    expect(
      isSameOrigin(
        req({
          origin: "https://app.example",
          host: "app.example",
          "x-forwarded-proto": "https",
        }),
      ),
    ).toBe(true)
    expect(
      isSameOrigin(
        req({ origin: "https://evil.example", host: "app.example" }),
      ),
    ).toBe(false)
    expect(isSameOrigin(req({}))).toBe(false)
  })
})

describe("secrets", () => {
  it("compares in constant time and refuses an unset expectation", () => {
    expect(safeEqual("abc", "abc")).toBe(true)
    expect(safeEqual("abc", "abcd")).toBe(false)
    expect(matchesSecret("", "")).toBe(false)
    expect(matchesSecret("x", undefined)).toBe(false)
    expect(bearerToken("Bearer  t ")).toBe("t")
    expect(bearerToken("Basic t")).toBeNull()
  })
})

describe("createLinkTokens", () => {
  const tokens = createLinkTokens({ secret: "s".repeat(32), label: "test:v1" })

  it("round-trips a subject and refuses an edited one", () => {
    const token = tokens.tokenFor("user-1")
    expect(tokens.subjectOf(token)).toBe("user-1")
    const [, sig] = token.split(".")
    expect(
      tokens.subjectOf(`${Buffer.from("user-2").toString("base64url")}.${sig}`),
    ).toBeUndefined()
    expect(tokens.subjectOf("garbage")).toBeUndefined()
  })

  it("does not accept a token signed under another label", () => {
    const other = createLinkTokens({
      secret: "s".repeat(32),
      label: "other:v1",
    })
    expect(other.subjectOf(tokens.tokenFor("user-1"))).toBeUndefined()
  })
})

describe("isAdmin", () => {
  it("needs a listed and verified address", () => {
    const admins = "Admin@Example.com, ops@example.com"
    expect(
      isAdmin({ email: "admin@example.com", emailVerified: true }, admins),
    ).toBe(true)
    expect(
      isAdmin({ email: "admin@example.com", emailVerified: false }, admins),
    ).toBe(false)
    expect(
      isAdmin({ email: "x@example.com", emailVerified: true }, admins),
    ).toBe(false)
    expect(
      isAdmin({ email: "admin@example.com", emailVerified: true }, ""),
    ).toBe(false)
  })
})

describe("createSecretBox", () => {
  const env = { KEY: Buffer.alloc(32, 7).toString("base64") }
  const box = createSecretBox({ keyVariable: "KEY", label: "test:secret", env })

  it("seals and opens, differently each time", () => {
    const a = box.seal("hunter2")
    expect(a).not.toBe(box.seal("hunter2"))
    expect(isSealed(a)).toBe(true)
    expect(box.open(a)).toBe("hunter2")
  })

  it("refuses another label, a tampered value and an unknown version", () => {
    const sealed = box.seal("hunter2")
    const other = createSecretBox({ keyVariable: "KEY", label: "other", env })
    expect(() => other.open(sealed)).toThrow(/could not be opened/)
    const parts = sealed.split(":")
    const ct = parts[3] ?? ""
    parts[3] = (ct[0] === "A" ? "B" : "A") + ct.slice(1)
    expect(() => box.open(parts.join(":"))).toThrow(/could not be opened/)
    expect(() => box.open(`v9${sealed.slice(2)}`)).toThrow(/version v9/)
    expect(() => box.open("plaintext")).toThrow(/unknown version/)
  })

  it("says what is wrong with the key, never what it holds", () => {
    const bad = createSecretBox({
      keyVariable: "KEY",
      label: "x",
      env: { KEY: "c2hvcnQ=" },
    })
    expect(bad.configured()).toBe(false)
    expect(() => bad.seal("x")).toThrow(/decodes to 5/)
  })

  it("redacts secrets and sealed values from text", () => {
    expect(
      redact(`key sk-abcdefghijkl and ${box.seal("x")} and Bearer tok`, [
        "hunter2",
      ]),
    ).toBe("key [redacted] and [redacted] and Bearer [redacted]")
  })
})

describe("boot checks", () => {
  it("names a missing, placeholder or short secret", () => {
    expect(secretProblem("S", "")).toBe("S is not set")
    expect(
      secretProblem("S", "change-me", { placeholders: ["change-me"] }),
    ).toMatch(/placeholder/)
    expect(secretProblem("S", "short")).toMatch(/shorter than 32/)
    expect(secretProblem("S", "x".repeat(32))).toBeNull()
  })

  it("refuses in production and warns elsewhere", async () => {
    const checks = [
      () => "one",
      async () => null,
      () => {
        throw new Error("two")
      },
    ]
    await expect(
      runBootChecks(checks, { production: true }),
    ).rejects.toBeInstanceOf(BootRefusedError)
    const warn = vi.fn()
    expect(await runBootChecks(checks, { production: false, warn })).toEqual([
      "one",
      "two",
    ])
    expect(warn).toHaveBeenCalledOnce()
  })
})
