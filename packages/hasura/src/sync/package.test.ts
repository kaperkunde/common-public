import { mkdirSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { makePackage, tempDir, write } from "./fixture"
import {
  checkVarValue,
  loadPackage,
  PackageError,
  resolvePackageDir,
  resolveVars,
} from "./package"

describe("loadPackage", () => {
  it("reads the manifest, migrations in order, and templates", () => {
    const dir = tempDir()
    makePackage(dir, {
      version: "2.3.4",
      migrations: {
        "1788000000001_b": { up: "b", down: "b" },
        "1788000000000_a": { up: "a", down: "a" },
      },
      functions: "- function: {name: f}\n",
    })
    const pkg = loadPackage(dir)
    expect(pkg.packageVersion).toBe("2.3.4")
    expect(pkg.migrations.map((m) => m.version)).toEqual([
      "1788000000000",
      "1788000000001",
    ])
    expect(pkg.tables.map((t) => t.file)).toEqual(["usage.yaml"])
    expect(pkg.functions).toContain("function")
  })

  it("rejects a badly named migration directory or a missing down.sql", () => {
    const dir = tempDir()
    makePackage(dir, { migrations: { "17_bad": { up: "a", down: "b" } } })
    expect(() => loadPackage(dir)).toThrow(PackageError)
    const dir2 = tempDir()
    makePackage(dir2)
    write(join(dir2, "hasura/migrations/1788000000009_lonely/up.sql"), "x")
    expect(() => loadPackage(dir2)).toThrow(/down\.sql/)
  })

  it("rejects a missing manifest and a bad variable name", () => {
    expect(() => loadPackage(tempDir())).toThrow(/manifest/)
    const dir = tempDir()
    makePackage(dir, { vars: { "bad-name": { description: "x" } } })
    expect(() => loadPackage(dir)).toThrow(/valid variable name/)
  })
})

describe("resolveVars", () => {
  it("applies the app's value, then the manifest default, then the standard default", () => {
    const dir = tempDir()
    makePackage(dir, {
      vars: {
        a: { description: "", default: "da" },
        b: { description: "", default: "db" },
      },
    })
    const pkg = loadPackage(dir)
    const { values, declared } = resolveVars(pkg, { b: "mine", prefix: "p_" })
    expect(values).toMatchObject({
      a: "da",
      b: "mine",
      prefix: "p_",
      schema: "public",
    })
    expect(values.owner_table).toBeUndefined()
    expect(declared.has("owner_table")).toBe(true)
  })

  it("rejects a value for an undeclared name", () => {
    const dir = tempDir()
    makePackage(dir)
    expect(() => resolveVars(loadPackage(dir), { nope: "x" })).toThrow(
      /does not declare/,
    )
  })
})

describe("resolvePackageDir", () => {
  it("finds the package in node_modules, following symlinks and walking upward", () => {
    const root = tempDir()
    const real = tempDir()
    makePackage(real)
    mkdirSync(join(root, "node_modules/@k"), { recursive: true })
    symlinkSync(real, join(root, "node_modules/@k/credits"))
    mkdirSync(join(root, "apps/web"), { recursive: true })
    expect(resolvePackageDir(join(root, "apps/web"), "@k/credits")).toBe(
      join(root, "node_modules/@k/credits"),
    )
    expect(() => resolvePackageDir(root, "@k/missing")).toThrow(/not installed/)
  })
})

describe("variable values are validated before rendering", () => {
  const load = (
    vars: Record<
      string,
      {
        description: string
        default?: string
        type?: "identifier" | "literal" | "integer"
      }
    >,
  ) => {
    const dir = tempDir()
    makePackage(dir, { vars })
    return loadPackage(dir)
  }

  it("takes identifiers, and rejects anything that could break out of one, naming the variable", () => {
    const pkg = load({ usage_table: { description: "", default: "usage" } })
    expect(
      resolveVars(pkg, { prefix: "credit_", schema: "app" }).values.prefix,
    ).toBe("credit_")
    for (const bad of [
      "a b",
      "a;b",
      'a"b',
      "a'b",
      "1a",
      "a-b",
      "a\nb",
      "a.b",
      "",
    ]) {
      expect(() => resolveVars(pkg, { schema: bad }), bad).toThrow(
        /variable "schema"/,
      )
    }
    expect(() => resolveVars(pkg, { usage_table: "x; drop table y" })).toThrow(
      /variable "usage_table" must be an identifier/,
    )
    expect(() => resolveVars(pkg, { server_role: "a'b" })).toThrow(
      /server_role/,
    )
  })

  it("lets prefix be empty and owner_table be schema-qualified", () => {
    const pkg = load({})
    expect(resolveVars(pkg, { prefix: "" }).values.prefix).toBe("")
    expect(
      resolveVars(pkg, { owner_table: "auth.user" }).values.owner_table,
    ).toBe("auth.user")
    expect(() => resolveVars(pkg, { owner_table: "a.b.c" })).toThrow(
      /owner_table/,
    )
    expect(() => resolveVars(pkg, { owner_table: 'a."b"' })).toThrow(
      /owner_table/,
    )
  })

  it("checks literal and integer types", () => {
    expect(() =>
      checkVarValue("p", "t", "timestamp with time zone", "literal"),
    ).not.toThrow()
    for (const bad of ["a'b", 'a"b', "a;b", "a\\b", "a\nb", "a`b", ""]) {
      expect(() => checkVarValue("p", "t", bad, "literal"), bad).toThrow(
        /variable "t"/,
      )
    }
    expect(() => checkVarValue("p", "n", "-12", "integer")).not.toThrow()
    expect(() => checkVarValue("p", "n", "1.5", "integer")).toThrow(
      /whole number/,
    )
    expect(() => checkVarValue("p", "n", "1; select", "integer")).toThrow()
    const pkg = load({
      kind: { description: "", default: "text", type: "literal" },
      n: { description: "", default: "5", type: "integer" },
    })
    expect(resolveVars(pkg, { kind: "numeric(10, 2)" }).values.kind).toBe(
      "numeric(10, 2)",
    )
    expect(() => resolveVars(pkg, { n: "five" })).toThrow(/variable "n"/)
  })

  it("rejects an unsafe manifest default too", () => {
    expect(() =>
      resolveVars(load({ t: { description: "", default: "a;b" } })),
    ).toThrow(/variable "t"/)
  })

  it("resolves defaults that use other variables after the app's values are applied", () => {
    const pkg = load({
      table_prices: { description: "", default: "{{prefix}}model_prices" },
      table_ledger: { description: "", default: "{{table_prices}}_ledger" },
    })
    expect(resolveVars(pkg, { prefix: "credit_" }).values).toMatchObject({
      table_prices: "credit_model_prices",
      table_ledger: "credit_model_prices_ledger",
    })
    expect(
      resolveVars(pkg, { prefix: "credit_", table_prices: "prices" }).values
        .table_ledger,
    ).toBe("prices_ledger")
    expect(resolveVars(pkg, {}).values.table_prices).toBe("model_prices")
  })

  it("rejects a default that uses an undeclared variable, one without a value, or a loop", () => {
    expect(() =>
      resolveVars(load({ a: { description: "", default: "{{nope}}" } })),
    ).toThrow(/does not declare/)
    expect(() =>
      resolveVars(
        load({ a: { description: "", default: "{{owner_table}}_x" } }),
      ),
    ).toThrow(/has no value/)
    expect(() =>
      resolveVars(
        load({
          a: { description: "", default: "{{b}}" },
          b: { description: "", default: "{{a}}" },
        }),
      ),
    ).toThrow(/loop: a -> b -> a/)
  })

  it("is enforced by sync, before anything is written", () => {
    // covered end to end in sync.test.ts
    expect(() => resolveVars(load({}), { prefix: "x';--" })).toThrow(/prefix/)
  })
})
