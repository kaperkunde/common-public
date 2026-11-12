import { describe, expect, it } from "vitest"

import { namesOf, pgExecutor, type PgClientLike } from "./executor"

const fakePool = (fail?: RegExp) => {
  const seen: string[] = []
  const released: unknown[] = []
  const client: PgClientLike = {
    query: async (sql, params) => {
      seen.push(params?.length ? `${sql} ${JSON.stringify(params)}` : sql)
      if (fail?.test(sql)) throw new Error("boom")
      return { rows: [{ ok: 1 }] }
    },
    release: (error) => released.push(error),
  }
  return { pool: { connect: async () => client }, seen, released }
}

describe("the pg executor", () => {
  it("runs each statement in a transaction of its own, as the server role", async () => {
    const { pool, seen, released } = fakePool()
    const rows = await pgExecutor(pool, { role: "server" }).query(
      "SELECT 1",
      [],
    )
    expect(rows).toEqual([{ ok: 1 }])
    expect(seen).toEqual([
      "BEGIN",
      `SELECT set_config('hasura.user', $1, true) ["{\\"x-hasura-role\\":\\"server\\"}"]`,
      "SELECT 1",
      "COMMIT",
    ])
    expect(released).toEqual([undefined])
  })

  it("rolls back and lets the client go on a failure", async () => {
    const { pool, seen, released } = fakePool(/credit_admit/)
    await expect(
      pgExecutor(pool, { role: "server" }).query("SELECT credit_admit($1)", [
        "a",
      ]),
    ).rejects.toThrow("boom")
    expect(seen.at(-1)).toBe("ROLLBACK")
    expect(released[0]).toBeInstanceOf(Error)
  })
})

describe("the names", () => {
  it("qualify every object, and refuse anything but a plain identifier", () => {
    expect(namesOf().t("admit")).toBe("public.credit_admit")
    expect(namesOf().table("balances")).toBe("public.credit_balances")
    expect(namesOf().usage).toBe("public.credit_usage")
    expect(namesOf({ prefix: "lore_" }).usage).toBe("public.lore_usage")
    // An app keeping its own table names maps each one; the rest keep the prefix.
    const adopted = namesOf({
      prefix: "lore_",
      tables: {
        model_prices: "model_prices",
        sale_prices: "lore_token_prices",
      },
    })
    expect(adopted.table("model_prices")).toBe("public.model_prices")
    expect(adopted.table("sale_prices")).toBe("public.lore_token_prices")
    expect(adopted.table("balances")).toBe("public.lore_balances")
    expect(adopted.t("spend")).toBe("public.lore_spend")
    expect(() => namesOf({ tables: { balances: "x; DROP" } })).toThrow(
      /plain SQL identifier/,
    )
    expect(() => namesOf({ tables: { nope: "x" } as never })).toThrow(
      /No credit table/,
    )
    expect(namesOf({ prefix: "lore_", usageTable: "ai_usage" }).usage).toBe(
      "public.ai_usage",
    )
    expect(() => namesOf({ prefix: "x; DROP" })).toThrow(/plain SQL identifier/)
    expect(() => namesOf({ schema: "Public" })).toThrow(/plain SQL identifier/)
  })
})
