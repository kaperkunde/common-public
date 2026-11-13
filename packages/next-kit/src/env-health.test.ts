import { z } from "zod"
import { describe, expect, it } from "vitest"

import { EnvError, defineEnv } from "./env"
import { healthRoute } from "./health"

describe("defineEnv", () => {
  const schema = z.object({
    DATABASE_URL: z.string().url(),
    PORT: z.coerce.number().int().default(3000),
    FLAG: z.enum(["on", "off"]).optional(),
  })

  it("returns the typed, coerced values", () => {
    const env = defineEnv(schema, {
      DATABASE_URL: "https://db.example",
      PORT: "8080",
    })
    expect(env).toEqual({ DATABASE_URL: "https://db.example", PORT: 8080 })
    expect(env.PORT + 1).toBe(8081)
  })

  it("fails fast naming every bad variable and never its value", () => {
    let error: unknown
    try {
      defineEnv(schema, { DATABASE_URL: "not-a-secret-url", FLAG: "maybe" })
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(EnvError)
    const { message, problems } = error as EnvError
    expect(problems).toHaveLength(2)
    expect(message).toContain("DATABASE_URL")
    expect(message).toContain("FLAG")
    expect(message).not.toContain("not-a-secret-url")
    expect(message).not.toContain("maybe")
  })

  it("names a whole-environment problem", () => {
    const refined = z
      .object({ A: z.string().optional() })
      .refine((v) => v.A, "A is needed")
    expect(() => defineEnv(refined, {})).toThrow("(environment): A is needed")
  })

  it("reads process.env by default", () => {
    process.env.KK_TEST_ENV = "yes"
    expect(defineEnv(z.object({ KK_TEST_ENV: z.string() })).KK_TEST_ENV).toBe(
      "yes",
    )
    delete process.env.KK_TEST_ENV
  })
})

describe("healthRoute", () => {
  it("is 200 ok with no checks, and with passing ones", async () => {
    const empty = await healthRoute()()
    expect(empty.status).toBe(200)
    expect(await empty.json()).toEqual({ status: "ok", checks: {} })
    const ok = await healthRoute({
      checks: { db: async () => 1, cache: () => true },
    })()
    expect(ok.headers.get("cache-control")).toBe("no-store")
    expect(await ok.json()).toEqual({
      status: "ok",
      checks: { db: "ok", cache: "ok" },
    })
  })

  it("is 503 naming which check failed, never why", async () => {
    const response = await healthRoute({
      checks: {
        db: async () => {
          throw new Error("password=hunter2")
        },
        flag: () => false,
        up: () => undefined,
      },
    })()
    expect(response.status).toBe(503)
    const text = await response.text()
    expect(JSON.parse(text)).toEqual({
      status: "failing",
      checks: { db: "failed", flag: "failed", up: "ok" },
    })
    expect(text).not.toContain("hunter2")
  })

  it("counts a check that takes too long as failed", async () => {
    const response = await healthRoute({
      timeoutMs: 20,
      checks: { slow: () => new Promise((r) => setTimeout(r, 500)) },
    })()
    expect(response.status).toBe(503)
  })
})
