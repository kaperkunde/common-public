import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { renderTemplate, runSync } from "@kaperkunde/hasura/sync"

import { CREDIT_TABLES } from "./executor"
import {
  HASURA_ROOT,
  PACKAGE_ROOT,
  manifest,
  migrations,
  renderApp,
} from "./test/database"

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })

describe("the templates", () => {
  it("use only variables the manifest declares, and nothing app-specific", () => {
    const declared = new Set(Object.keys(manifest.vars))
    files(HASURA_ROOT)
      .filter((path) => !path.endsWith("manifest.json"))
      .forEach((path) => {
        const text = readFileSync(path, "utf8")
        for (const [, name] of text.matchAll(/\{\{\s*([a-z_0-9]+)\s*\}\}/g)) {
          expect(declared.has(name as string), `${path}: ${name}`).toBe(true)
        }
        expect(text, path).not.toMatch(/lore|campfire|universe/i)
      })
    expect(manifest.name).toBe("@kaperkunde/credits")
  })

  it("name each migration by a 13-digit version, with an up and a down", () => {
    const all = migrations()
    expect(all.length).toBeGreaterThan(0)
    all.forEach((migration) => {
      expect(migration.dir).toMatch(/^\d{13}_[a-z0-9_]+$/)
      expect(migration.down.length).toBeGreaterThan(0)
    })
  })

  it("render through kk-hasura sync with no variable left, and refuse an unknown one", () => {
    const app = renderApp()
    try {
      expect(app.migrations.map((m) => m.dir)).toEqual(
        migrations().map((m) => m.dir),
      )
      app.migrations.forEach((migration) => {
        expect(migration.up).not.toContain("{{")
        expect(migration.down).not.toContain("{{")
      })
      // The table defaults reference the prefix, and resolve through it.
      expect(app.migrations[0]?.up).toContain(
        "CREATE TABLE public.credit_model_prices",
      )
      expect(app.migrations[0]?.up).toContain(
        "CREATE TABLE public.credit_usage",
      )
      expect(app.read("metadata/functions.yaml")).toContain("credit_admit")
      // A second sync has nothing to write, and --check agrees.
      expect(
        runSync({
          root: app.root,
          check: true,
          resolvePackage: () => PACKAGE_ROOT,
        }).ok,
      ).toBe(true)
    } finally {
      app.dispose()
    }
    expect(() =>
      renderTemplate("{{nope}}", new Set(["prefix"]), {}, "test"),
    ).toThrow(/unknown variable/)
  })
})

describe("the table names", () => {
  it("are each a variable of their own, defaulting to the prefix and the logical name", () => {
    CREDIT_TABLES.forEach((table) => {
      expect(manifest.vars[`table_${table}`]?.default, table).toBe(
        `{{prefix}}${table}`,
      )
    })
    expect(manifest.vars.usage_table?.default).toBe("{{prefix}}usage")
  })

  it("are used for every table the migrations create", () => {
    const created = migrations().flatMap((migration) =>
      Array.from(
        migration.up.matchAll(/CREATE TABLE \{\{schema\}\}\.\{\{(\w+)\}\}/g),
        (match) => match[1],
      ),
    )
    expect(created.sort()).toEqual(
      [...CREDIT_TABLES.map((table) => `table_${table}`), "usage_table"].sort(),
    )
    // And nothing refers to a table by the prefix alone.
    migrations().forEach((migration) => {
      CREDIT_TABLES.forEach((table) => {
        expect(migration.up).not.toMatch(
          new RegExp(`\\{\\{prefix\\}\\}${table}(?![a-z0-9_])`),
        )
      })
    })
  })

  it("map onto an app's own, unprefixed names in SQL and metadata alike", () => {
    const app = renderApp({
      owner_table: "user",
      prefix: "lore_",
      usage_table: "ai_usage",
      table_model_prices: "model_prices",
      table_sale_prices: "lore_token_prices",
      table_stripe_events: "stripe_events",
    })
    try {
      const sql = app.migrations.map((m) => m.up).join("\n")
      expect(sql).toContain("CREATE TABLE public.model_prices")
      expect(sql).toContain("CREATE TABLE public.lore_token_prices")
      expect(sql).toContain("CREATE TABLE public.ai_usage")
      expect(sql).toContain("CREATE TABLE public.lore_balances")
      expect(sql).toContain("FUNCTION public.lore_spend")
      expect(sql).not.toContain("CREATE TABLE public.lore_model_prices")
      expect(app.files("metadata/tables")).toEqual(
        expect.arrayContaining([
          "public_model_prices.yaml",
          "public_lore_token_prices.yaml",
          "public_ai_usage.yaml",
        ]),
      )
      expect(app.read("metadata/tables/public_model_prices.yaml")).toContain(
        "name: lore_model_price_kinds",
      )
    } finally {
      app.dispose()
    }
  })
})

describe("the usage ledger's metadata", () => {
  const text = readFileSync(
    join(HASURA_ROOT, "metadata", "tables", "usage.yaml.tmpl"),
    "utf8",
  )
  const insert = text.slice(
    text.indexOf("insert_permissions:"),
    text.indexOf("select_permissions:"),
  )

  it("lets the server record a call on the user's own key through Hasura", () => {
    expect(insert).toMatch(/^ {8}- source$/m)
    expect(insert).toMatch(/^ {8}- credits$/m)
  })

  it("only as unconverted, or as own: never as already paid from a balance", () => {
    expect(insert).toContain("_or:")
    expect(insert).toMatch(/source:\n\s+_is_null: true/)
    expect(insert).toMatch(/credits:\n\s+_is_null: true/)
    expect(insert).toMatch(/source:\n\s+_eq: own/)
    // Spend's own columns stay out of an insert.
    expect(insert).not.toMatch(
      /- (usd|freeCredits|purchasedCredits|priceFrom)$/m,
    )
  })
})
