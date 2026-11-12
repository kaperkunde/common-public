import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { HASURA_ROOT, TEST_VARS, manifest, migrations, render } from "./test/database"

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

  it("render to SQL with no variable left, and refuse an unknown one", () => {
    migrations().forEach((migration) => {
      expect(render(migration.up, TEST_VARS)).not.toContain("{{")
    })
    expect(() => render("{{nope}}", TEST_VARS)).toThrow(/Unknown template variable/)
  })
})
