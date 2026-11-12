import { createHmac } from "node:crypto"
import { describe, expect, it } from "vitest"

import { jwtExpiry, mintHasuraJwt, parseJwtSecret } from "./jwt"

const decode = (token: string) =>
  JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString())

describe("mintHasuraJwt", () => {
  it("signs HS256 with sub, claims and exp", () => {
    const token = mintHasuraJwt({
      userId: "u1",
      secret: "s3cret",
      role: "user",
      now: 1000,
    })
    const [head, body, sig] = token.split(".")
    expect(JSON.parse(Buffer.from(head!, "base64url").toString())).toEqual({
      alg: "HS256",
      typ: "JWT",
    })
    const expected = createHmac("sha256", "s3cret")
      .update(`${head}.${body}`)
      .digest("base64url")
    expect(sig).toBe(expected)
    expect(decode(token)).toEqual({
      sub: "u1",
      iat: 1000,
      exp: 4600,
      "https://hasura.io/jwt/claims": {
        "x-hasura-allowed-roles": ["user"],
        "x-hasura-default-role": "user",
        "x-hasura-user-id": "u1",
      },
    })
  })

  it("takes allowed roles, extra claims, a ttl and a namespace", () => {
    const token = mintHasuraJwt({
      userId: "u1",
      secret: "k",
      role: "ai",
      allowedRoles: ["ai", "user"],
      claims: { "x-hasura-ai-hat": "player" },
      ttlSeconds: 60,
      now: 10,
      namespace: "ns",
    })
    const payload = decode(token)
    expect(payload.exp).toBe(70)
    expect(payload.ns["x-hasura-allowed-roles"]).toEqual(["ai", "user"])
    expect(payload.ns["x-hasura-ai-hat"]).toBe("player")
  })

  it("refuses a missing secret, user or a default role outside the allowed", () => {
    expect(() =>
      mintHasuraJwt({ userId: "u", secret: "", role: "a" }),
    ).toThrow()
    expect(() =>
      mintHasuraJwt({ userId: "", secret: "k", role: "a" }),
    ).toThrow()
    expect(() =>
      mintHasuraJwt({
        userId: "u",
        secret: "k",
        role: "a",
        allowedRoles: ["b"],
      }),
    ).toThrow(/allowed/)
  })
})

describe("parseJwtSecret", () => {
  it("reads the JSON form and the bare key", () => {
    expect(parseJwtSecret('{"type":"HS256","key":"abc"}')).toBe("abc")
    expect(parseJwtSecret("  abc ")).toBe("abc")
    expect(() => parseJwtSecret('{"type":"HS256"}')).toThrow()
  })
})

describe("jwtExpiry", () => {
  it("reads exp and answers null for rubbish", () => {
    const token = mintHasuraJwt({
      userId: "u",
      secret: "k",
      role: "user",
      now: 5,
      ttlSeconds: 5,
    })
    expect(jwtExpiry(token)).toBe(10)
    expect(jwtExpiry("nope")).toBeNull()
    expect(jwtExpiry("a.!!.c")).toBeNull()
  })
})
