import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/** A throwaway app and package on disk for the sync tests. */
export const tempDir = () => mkdtempSync(join(tmpdir(), "kk-hasura-"))

export const write = (path: string, content: string) => {
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, content)
}

export type FixtureOptions = {
  version?: string
  migrations?: Record<string, { up: string; down: string }>
  tables?: Record<string, string>
  functions?: string
  vars?: Record<string, { description: string; default?: string }>
}

export const makePackage = (dir: string, options: FixtureOptions = {}) => {
  write(
    join(dir, "package.json"),
    JSON.stringify({ name: "@k/credits", version: options.version ?? "0.1.0" }),
  )
  write(
    join(dir, "hasura", "manifest.json"),
    JSON.stringify({
      name: "@k/credits",
      vars: options.vars ?? {
        usage_table: { description: "usage", default: "usage" },
      },
    }),
  )
  const migrations = options.migrations ?? {
    "1788000000000_init": {
      up: "create table {{schema}}.{{prefix}}{{usage_table}} (id int);\n",
      down: "drop table {{schema}}.{{prefix}}{{usage_table}};\n",
    },
  }
  for (const [dirName, { up, down }] of Object.entries(migrations)) {
    write(join(dir, "hasura", "migrations", dirName, "up.sql"), up)
    write(join(dir, "hasura", "migrations", dirName, "down.sql"), down)
  }
  const tables = options.tables ?? {
    "usage.yaml.tmpl":
      "table:\n  name: {{prefix}}{{usage_table}}\n  schema: {{schema}}\n",
  }
  for (const [file, text] of Object.entries(tables)) {
    write(join(dir, "hasura", "metadata", "tables", file), text)
  }
  if (options.functions !== undefined) {
    write(
      join(dir, "hasura", "metadata", "functions.yaml.tmpl"),
      options.functions,
    )
  }
}

export const makeApp = (
  root: string,
  entry: { vars?: Record<string, string>; adopted?: string[] } = {
    vars: { prefix: "credit_" },
  },
) => {
  write(
    join(root, "kaperkunde.json"),
    JSON.stringify({
      hasura: {
        database: "main",
        migrationsDir: "hasura/migrations/main",
        metadataDir: "hasura/metadata/databases/main",
      },
      packages: { "@k/credits": entry },
    }),
  )
}
