import { mkdirSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { makePackage, tempDir, write } from "./fixture"
import {
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
    expect(pkg.tables.map((t) => t.file)).toEqual(["{{prefix}}usage.yaml"])
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
