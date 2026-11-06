import { describe, expect, it } from "vitest"

import {
  authErrorMessage,
  bearerChallenge,
  bearerTokenFrom,
  calledToolNames,
  effectiveScopes,
  hashOpaqueToken,
  mcpAuthError,
  mcpUrls,
  oauthRedirectFrom,
  opaqueTokenClaims,
  parseScopeList,
  validatePassword,
  withResetPasswordEmail,
} from "./index"

const urls = mcpUrls({
  siteUrl: "https://studyguild.my/",
  port: "3000",
  jwksUrl: "",
})

describe("mcpUrls", () => {
  it("roots everything at the site origin", () => {
    expect(urls).toEqual({
      issuer: "https://studyguild.my",
      resource: "https://studyguild.my/mcp",
      jwksUrl: "http://127.0.0.1:3000/api/auth/jwks",
      resourceMetadataUrl:
        "https://studyguild.my/.well-known/oauth-protected-resource/mcp",
    })
  })
})

describe("scopes", () => {
  it("reads every shape Better Auth stores", () => {
    expect(parseScopeList(["a", 1, "b"])).toEqual(["a", "b"])
    expect(parseScopeList("a b,c")).toEqual(["a", "b", "c"])
    expect(parseScopeList('["a","b"]')).toEqual(["a", "b"])
    expect(parseScopeList(null)).toEqual([])
  })

  it("narrows a token to the live consent, and to nothing once disconnected", () => {
    expect(effectiveScopes("x:read x:write", '["x:read"]')).toEqual(["x:read"])
    expect(effectiveScopes("x:read", null)).toBeNull()
  })
})

describe("challenges", () => {
  it("names the metadata and the scopes", () => {
    expect(
      bearerChallenge({
        urls,
        scopes: ["x:read", "offline_access"],
        error: "invalid_token",
        description: 'was "revoked"',
      }),
    ).toBe(
      'Bearer error="invalid_token", error_description="was \\"revoked\\"", resource_metadata="https://studyguild.my/.well-known/oauth-protected-resource/mcp", scope="x:read offline_access"',
    )
  })

  it("answers JSON-RPC with CORS", async () => {
    const response = mcpAuthError({
      status: 401,
      message: "Sign in again.",
      challenge: "Bearer x",
    })
    expect(response.status).toBe(401)
    expect(response.headers.get("www-authenticate")).toBe("Bearer x")
    expect(response.headers.get("access-control-expose-headers")).toContain(
      "WWW-Authenticate",
    )
    expect(await response.json()).toEqual({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Sign in again." },
      id: null,
    })
  })

  it("reads the bearer token and the called tools", async () => {
    expect(
      bearerTokenFrom(
        new Request("https://x", { headers: { authorization: "bearer abc " } }),
      ),
    ).toBe("abc")
    const request = new Request("https://x/mcp", {
      method: "POST",
      body: JSON.stringify([
        { method: "tools/call", params: { name: "add_card" } },
        { method: "tools/list" },
      ]),
    })
    expect(await calledToolNames(request)).toEqual(["add_card"])
  })
})

describe("opaqueTokenClaims", () => {
  const now = new Date("2026-11-02T12:00:00Z")
  const later = new Date("2026-11-02T13:00:00Z")
  const row = {
    clientId: "c",
    userId: "u",
    scopes: "x:read",
    resources: null,
    expiresAt: later,
  }

  it("answers claims for a live token", () => {
    expect(opaqueTokenClaims(row, urls.resource, now)).toEqual({
      sub: "u",
      azp: "c",
      scope: "x:read",
      exp: Math.floor(later.getTime() / 1000),
    })
    expect(hashOpaqueToken("abc")).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it.each([
    { revoked: true },
    { expiresAt: now },
    { confirmation: { jkt: "x" } },
    { client: { disabled: true } },
    { session: { expiresAt: now } },
    { resources: '["https://other/mcp"]' },
    { userId: null },
  ])("refuses %j", (change) => {
    expect(
      opaqueTokenClaims({ ...row, ...change }, urls.resource, now),
    ).toBeNull()
  })
})

describe("forms", () => {
  it("checks a password pair", () => {
    expect(validatePassword("short", "short")).toMatch(/at least 8/)
    expect(validatePassword("longenough", "different")).toBe(
      "Passwords do not match.",
    )
    expect(validatePassword("longenough", "longenough")).toBeNull()
  })

  it("puts the account's address on the reset callback", () => {
    expect(
      withResetPasswordEmail(
        "https://x/api/auth/reset-password/t?callbackURL=%2Freset-password",
        "a@b.c",
      ),
    ).toBe(
      "https://x/api/auth/reset-password/t?callbackURL=%2Freset-password%3Femail%3Da%2540b.c",
    )
    expect(withResetPasswordEmail("not a url", "a@b.c")).toBe("not a url")
  })

  it("turns codes into sentences, and server errors into the unexpected one", () => {
    expect(authErrorMessage({ code: "INVALID_EMAIL_OR_PASSWORD" }, "f")).toBe(
      "Wrong email or password.",
    )
    expect(
      authErrorMessage({ status: 500, message: "stack trace" }, "f"),
    ).toMatch(/our side/)
    expect(authErrorMessage({ status: 429 }, "f")).toMatch(/Too many/)
    expect(authErrorMessage({ code: "X" }, "fallback", { X: "Mine." })).toBe(
      "Mine.",
    )
    expect(authErrorMessage({ code: "UNKNOWN" }, "fallback")).toBe("fallback")
    expect(
      oauthRedirectFrom({ redirect: true, url: "/oauth2/authorize?x" }),
    ).toBe("/oauth2/authorize?x")
    expect(oauthRedirectFrom({ url: "/x" })).toBeNull()
  })
})

describe("mcpAuthPreset", () => {
  it("closes the jwt plugin's /token and wires jwt, mcp and cimd", async () => {
    const { mcpAuthPreset } = await import("./preset")
    const preset = mcpAuthPreset({
      urls,
      scopes: ["openid", "x:read"],
      rateLimited: true,
    })
    expect(preset.disabledPaths).toEqual(["/token"])
    expect(preset.rateLimit.enabled).toBe(true)
    expect(preset.rateLimit.customRules["/jwks"]).toBe(false)
    expect(
      preset.plugins.map((plugin) => (plugin as { id: string }).id),
    ).toEqual(["jwt", "oauth-provider", "cimd"])
  }, 30_000)
})
