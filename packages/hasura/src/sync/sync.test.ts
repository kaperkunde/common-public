import { existsSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { makeApp, makePackage, tempDir, write } from "./fixture"
import { runSync, serializeLock, type LockFile } from "./sync"

const setup = (
  pkgOptions?: Parameters<typeof makePackage>[1],
  entry?: Parameters<typeof makeApp>[1],
) => {
  const root = tempDir()
  const pkg = tempDir()
  makePackage(pkg, pkgOptions)
  makeApp(root, entry)
  const run = (check = false) => {
    const lines: string[] = []
    const result = runSync({
      root,
      check,
      log: (l) => lines.push(l),
      resolvePackage: () => pkg,
    })
    return { ...result, lines }
  }
  const migrations = join(root, "hasura/migrations/main")
  const metadata = join(root, "hasura/metadata/databases/main")
  const lock = () =>
    JSON.parse(
      readFileSync(join(root, "kaperkunde.lock.json"), "utf8"),
    ) as LockFile
  return { root, pkg, run, migrations, metadata, lock }
}

const FUNCTIONS = `- function:
    name: {{prefix}}spend
    schema: {{schema}}
  configuration:
    exposed_as: mutation
  permissions:
    - role: {{server_role}}
`

describe("kk-hasura sync", () => {
  it("renders a migration with the same version and name, and records it", () => {
    const s = setup()
    const { ok } = s.run()
    expect(ok).toBe(true)
    const dir = join(s.migrations, "1788000000000_init")
    expect(readFileSync(join(dir, "up.sql"), "utf8")).toBe(
      "create table public.credit_usage (id int);\n",
    )
    expect(readFileSync(join(dir, "down.sql"), "utf8")).toBe(
      "drop table public.credit_usage;\n",
    )
    const entry = s.lock().packages["@k/credits"]!
    expect(entry.version).toBe("0.1.0")
    expect(entry.migrations["1788000000000"]).toMatchObject({ name: "init" })
    expect(entry.migrations["1788000000000"]!.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(entry.migrations["1788000000000"]!.adopted).toBeUndefined()
  })

  it("is idempotent and passes --check afterwards", () => {
    const s = setup()
    s.run()
    const again = s.run()
    expect(again.ok).toBe(true)
    expect(again.plan.writes).toEqual([])
    expect(again.lines).toContain("already in sync")
    expect(s.run(true).ok).toBe(true)
  })

  it("--check fails, and writes nothing, before the first sync", () => {
    const s = setup()
    const result = s.run(true)
    expect(result.ok).toBe(false)
    expect(existsSync(s.migrations)).toBe(false)
    expect(existsSync(join(s.root, "kaperkunde.lock.json"))).toBe(false)
    expect(result.lines.join("\n")).toContain("out of date")
  })

  it("errors on a variable the template uses but nothing sets", () => {
    const s = setup(undefined, { vars: {} })
    const result = s.run()
    expect(result.ok).toBe(false)
    expect(result.lines.join("\n")).toContain("{{prefix}} has no value")
    expect(existsSync(s.migrations)).toBe(false)
  })

  it("errors on an unknown variable in a template", () => {
    const s = setup({
      migrations: { "1788000000000_init": { up: "{{typo}}", down: "x" } },
    })
    const result = s.run()
    expect(result.ok).toBe(false)
    expect(result.lines.join("\n")).toContain("unknown variable {{typo}}")
  })

  it("errors on a var the package never declared", () => {
    const s = setup(undefined, { vars: { prefix: "a_", surprise: "x" } })
    const result = s.run()
    expect(result.ok).toBe(false)
    expect(result.lines.join("\n")).toContain('"surprise"')
  })

  it("lets the app override a manifest default", () => {
    const s = setup(undefined, { vars: { prefix: "c_", usage_table: "calls" } })
    s.run()
    expect(
      readFileSync(join(s.migrations, "1788000000000_init", "up.sql"), "utf8"),
    ).toContain("c_calls")
  })

  it("syncs only the versions not yet synced when the package adds one", () => {
    const s = setup()
    s.run()
    write(
      join(s.pkg, "hasura/migrations/1788000000001_more/up.sql"),
      "alter table {{prefix}}usage add column x int;\n",
    )
    write(
      join(s.pkg, "hasura/migrations/1788000000001_more/down.sql"),
      "select 1;\n",
    )
    expect(s.run(true).ok).toBe(false)
    const result = s.run()
    expect(result.ok).toBe(true)
    expect(result.lines).toContain("wrote @k/credits 1788000000001_more")
    expect(
      readFileSync(join(s.migrations, "1788000000001_more", "up.sql"), "utf8"),
    ).toBe("alter table credit_usage add column x int;\n")
    expect(Object.keys(s.lock().packages["@k/credits"]!.migrations)).toEqual([
      "1788000000000",
      "1788000000001",
    ])
  })

  describe("drift detection", () => {
    it("fails when a synced file was edited", () => {
      const s = setup()
      s.run()
      write(join(s.migrations, "1788000000000_init", "up.sql"), "-- mine\n")
      const check = s.run(true)
      expect(check.ok).toBe(false)
      expect(check.lines.join("\n")).toContain("synced file was edited")
      expect(s.run().ok).toBe(false)
      expect(
        readFileSync(
          join(s.migrations, "1788000000000_init", "up.sql"),
          "utf8",
        ),
      ).toBe("-- mine\n")
    })

    it("fails when a synced file went missing", () => {
      const s = setup()
      s.run()
      write(join(s.migrations, "1788000000000_init", "up.sql"), "x")
      rmSync(join(s.migrations, "1788000000000_init"), { recursive: true })
      const check = s.run(true)
      expect(check.ok).toBe(false)
      expect(check.lines.join("\n")).toContain("missing")
    })

    it("fails when the vars change after sync", () => {
      const s = setup()
      s.run()
      makeApp(s.root, { vars: { prefix: "other_" } })
      const check = s.run(true)
      expect(check.ok).toBe(false)
      expect(check.lines.join("\n")).toContain("renders differently")
    })

    it("fails when the package rewrites a version it already shipped", () => {
      const s = setup()
      s.run()
      write(
        join(s.pkg, "hasura/migrations/1788000000000_init/up.sql"),
        "select 'changed';\n",
      )
      expect(s.run(true).ok).toBe(false)
    })

    it("fails on a lock entry whose package left the config", () => {
      const s = setup()
      s.run()
      const lock = JSON.parse(
        readFileSync(join(s.root, "kaperkunde.lock.json"), "utf8"),
      ) as LockFile
      lock.packages["@k/old"] = { version: "1", migrations: {}, metadata: {} }
      write(join(s.root, "kaperkunde.lock.json"), serializeLock(lock))
      const check = s.run(true)
      expect(check.ok).toBe(false)
      expect(check.lines.join("\n")).toContain("@k/old")
    })

    it("refuses to write over a directory it did not create", () => {
      const s = setup()
      write(join(s.migrations, "1788000000000_init", "up.sql"), "mine\n")
      write(join(s.migrations, "1788000000000_init", "down.sql"), "mine\n")
      const result = s.run()
      expect(result.ok).toBe(false)
      expect(result.lines.join("\n")).toContain(
        'add "1788000000000" to "adopted"',
      )
    })

    it("recognises an identical directory already present", () => {
      const s = setup()
      s.run()
      rmSync(join(s.root, "kaperkunde.lock.json"))
      const result = s.run()
      expect(result.ok).toBe(true)
      expect(result.lines.join("\n")).toContain("already present")
    })
  })

  describe("adopted versions", () => {
    it("records the version in the lock without writing any file", () => {
      const s = setup(undefined, {
        vars: { prefix: "credit_" },
        adopted: ["1788000000000"],
      })
      const result = s.run()
      expect(result.ok).toBe(true)
      expect(existsSync(s.migrations)).toBe(false)
      expect(
        s.lock().packages["@k/credits"]!.migrations["1788000000000"],
      ).toMatchObject({
        name: "init",
        adopted: true,
      })
      expect(s.run(true).ok).toBe(true)
    })

    it("writes no metadata when every version is adopted", () => {
      const s = setup(
        { functions: FUNCTIONS },
        {
          vars: { prefix: "credit_", server_role: "server" },
          adopted: ["1788000000000"],
        },
      )
      s.run()
      expect(existsSync(s.metadata)).toBe(false)
    })

    it("still syncs versions that are not adopted", () => {
      const s = setup(
        {
          migrations: {
            "1788000000000_init": { up: "a", down: "b" },
            "1788000000001_next": { up: "c", down: "d" },
          },
        },
        { vars: { prefix: "credit_" }, adopted: ["1788000000000"] },
      )
      s.run()
      expect(existsSync(join(s.migrations, "1788000000000_init"))).toBe(false)
      expect(
        existsSync(join(s.migrations, "1788000000001_next", "up.sql")),
      ).toBe(true)
    })

    it("errors on an adopted version the package does not have", () => {
      const s = setup(undefined, { vars: { prefix: "c_" }, adopted: ["1"] })
      const result = s.run()
      expect(result.ok).toBe(false)
      expect(result.lines.join("\n")).toContain("not in the package")
    })

    it("cannot adopt a version that was already synced", () => {
      const s = setup()
      s.run()
      makeApp(s.root, {
        vars: { prefix: "credit_" },
        adopted: ["1788000000000"],
      })
      expect(s.run().ok).toBe(false)
    })
  })

  describe("metadata merge", () => {
    const vars = { prefix: "credit_", server_role: "server" }

    it("writes table files, includes them, and merges functions", () => {
      const s = setup({ functions: FUNCTIONS }, { vars })
      write(
        join(s.metadata, "tables/tables.yaml"),
        '# mine\n- "!include public_users.yaml"\n',
      )
      write(
        join(s.metadata, "functions.yaml"),
        "# existing\n- function:\n    name: other\n    schema: public\n",
      )
      expect(s.run().ok).toBe(true)
      expect(
        readFileSync(join(s.metadata, "tables/public_credit_usage.yaml"), "utf8"),
      ).toBe("table:\n  name: credit_usage\n  schema: public\n")
      const tables = readFileSync(
        join(s.metadata, "tables/tables.yaml"),
        "utf8",
      )
      expect(tables).toContain("# mine")
      expect(tables).toContain("public_users.yaml")
      expect(tables).toContain("!include public_credit_usage.yaml")
      const functions = readFileSync(join(s.metadata, "functions.yaml"), "utf8")
      expect(functions).toContain("# existing")
      expect(functions).toContain("name: other")
      expect(functions).toContain("name: credit_spend")
      expect(functions).toContain("role: server")
      expect(s.lock().packages["@k/credits"]!.metadata).toHaveProperty(
        "functions/public.credit_spend",
      )
      expect(s.lock().packages["@k/credits"]!.metadata).toHaveProperty(
        "tables/public_credit_usage.yaml",
      )
    })

    it("creates the metadata files when none exist, and does not duplicate on re-run", () => {
      const s = setup({ functions: FUNCTIONS }, { vars })
      s.run()
      s.run()
      const tables = readFileSync(
        join(s.metadata, "tables/tables.yaml"),
        "utf8",
      )
      expect(tables.match(/public_credit_usage\.yaml/g)).toHaveLength(1)
      const functions = readFileSync(join(s.metadata, "functions.yaml"), "utf8")
      expect(functions.match(/credit_spend/g)).toHaveLength(1)
      expect(s.run(true).ok).toBe(true)
    })

    it("updates unedited metadata when the package's template changes", () => {
      const s = setup({ functions: FUNCTIONS }, { vars })
      s.run()
      write(
        join(s.pkg, "hasura/metadata/functions.yaml.tmpl"),
        FUNCTIONS.replace("exposed_as: mutation", "exposed_as: query"),
      )
      expect(s.run(true).ok).toBe(false)
      expect(s.run().ok).toBe(true)
      expect(
        readFileSync(join(s.metadata, "functions.yaml"), "utf8"),
      ).toContain("exposed_as: query")
      expect(
        readFileSync(join(s.metadata, "functions.yaml"), "utf8").match(
          /credit_spend/g,
        ),
      ).toHaveLength(1)
      expect(s.run(true).ok).toBe(true)
    })

    it("fails when a synced table file was edited", () => {
      const s = setup(undefined, { vars })
      s.run()
      write(join(s.metadata, "tables/public_credit_usage.yaml"), "table: {}\n")
      const check = s.run(true)
      expect(check.ok).toBe(false)
      expect(check.lines.join("\n")).toContain(
        "credit_usage.yaml: synced file was edited",
      )
    })

    it("fails when a synced function entry was edited", () => {
      const s = setup({ functions: FUNCTIONS }, { vars })
      s.run()
      const path = join(s.metadata, "functions.yaml")
      write(
        path,
        readFileSync(path, "utf8").replace(
          "exposed_as: mutation",
          "exposed_as: query",
        ),
      )
      const check = s.run(true)
      expect(check.ok).toBe(false)
      expect(check.lines.join("\n")).toContain("synced entry was edited")
    })

    it("refuses to overwrite a table file it did not write", () => {
      const s = setup(undefined, { vars })
      write(
        join(s.metadata, "tables/public_credit_usage.yaml"),
        "table: {name: other}\n",
      )
      const result = s.run()
      expect(result.ok).toBe(false)
      expect(result.lines.join("\n")).toContain("was not written by sync")
    })

    it("rejects a functions template that is not a list", () => {
      const s = setup({ functions: "function: {}\n" }, { vars })
      expect(s.run().ok).toBe(false)
    })
  })
})
