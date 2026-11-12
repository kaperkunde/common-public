/**
 * Test support: the templates rendered by `kk-hasura sync` itself (`@kaperkunde/hasura/sync`)
 * into a throwaway app, as an app renders them, and a throwaway database to run them in. The
 * SQL tests run where `CREDITS_TEST_DATABASE_URL` names a Postgres the test may create
 * databases on, and are skipped elsewhere.
 */

import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { runSync } from "@kaperkunde/hasura/sync"
import pg from "pg"

export const PACKAGE_ROOT = join(import.meta.dirname, "..", "..")
export const HASURA_ROOT = join(PACKAGE_ROOT, "hasura")

export const manifest = JSON.parse(
  readFileSync(join(HASURA_ROOT, "manifest.json"), "utf8"),
) as {
  name: string
  vars: Record<string, { description: string; default?: string }>
}

/** The template migrations, oldest first, as the package ships them. */
export const migrations = () =>
  readdirSync(join(HASURA_ROOT, "migrations"))
    .sort()
    .map((dir) => ({
      dir,
      up: readFileSync(join(HASURA_ROOT, "migrations", dir, "up.sql"), "utf8"),
      down: readFileSync(
        join(HASURA_ROOT, "migrations", dir, "down.sql"),
        "utf8",
      ),
    }))

/** What an app sets: the owner table, and everything else left to the manifest's defaults. */
export const TEST_VARS: Record<string, string> = {
  owner_table: "user",
}

/**
 * Renders the package into a throwaway app with `kk-hasura sync`, with `vars` as the app's
 * `kaperkunde.json` gives them, and answers the rendered migrations (oldest first) and a reader
 * for any other file it wrote. Throws with the sync's own words when it fails.
 */
export const renderApp = (vars: Record<string, string> = TEST_VARS) => {
  const root = mkdtempSync(join(tmpdir(), "kk-credits-"))
  writeFileSync(
    join(root, "kaperkunde.json"),
    JSON.stringify({
      hasura: {
        database: "main",
        migrationsDir: "migrations",
        metadataDir: "metadata",
      },
      packages: { "@kaperkunde/credits": { vars } },
    }),
  )
  const lines: string[] = []
  const result = runSync({
    root,
    log: (line) => lines.push(line),
    resolvePackage: () => PACKAGE_ROOT,
  })
  if (!result.ok) throw new Error(`sync failed:\n${lines.join("\n")}`)
  const dir = join(root, "migrations")
  const rendered = readdirSync(dir)
    .sort()
    .map((name) => ({
      dir: name,
      up: readFileSync(join(dir, name, "up.sql"), "utf8"),
      down: readFileSync(join(dir, name, "down.sql"), "utf8"),
    }))
  const read = (path: string) => readFileSync(join(root, path), "utf8")
  const files = (sub: string) => readdirSync(join(root, sub))
  return {
    root,
    migrations: rendered,
    read,
    files,
    dispose: () => rmSync(root, { recursive: true, force: true }),
  }
}

export const databaseUrl = process.env.CREDITS_TEST_DATABASE_URL

/**
 * A fresh database with the owner table and every migration applied, rendered with `vars`.
 * Answers the pool and the rendered migrations (for rolling back).
 */
export const freshDatabase = async (
  name: string,
  vars: Record<string, string> = TEST_VARS,
) => {
  const app = renderApp(vars)
  app.dispose()
  const admin = new pg.Client({ connectionString: databaseUrl })
  await admin.connect()
  await admin.query(`DROP DATABASE IF EXISTS ${name}`)
  await admin.query(`CREATE DATABASE ${name}`)
  await admin.end()
  const url = new URL(databaseUrl as string)
  url.pathname = `/${name}`
  const pool = new pg.Pool({ connectionString: url.toString(), max: 8 })
  await pool.query(
    `CREATE TABLE public."${vars.owner_table ?? "user"}" (id text PRIMARY KEY)`,
  )
  for (const migration of app.migrations) {
    await pool.query(migration.up)
  }
  return Object.assign(pool, { migrations: app.migrations })
}
