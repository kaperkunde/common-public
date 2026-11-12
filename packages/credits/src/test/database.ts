/**
 * Test support: the templates rendered the way `kk-hasura sync` renders them (`{{var}}` only,
 * an unknown variable an error), and a throwaway database to run them in. The SQL tests run
 * where `CREDITS_TEST_DATABASE_URL` names a Postgres the test may create databases on, and are
 * skipped elsewhere.
 */

import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

import pg from "pg"

export const PACKAGE_ROOT = join(import.meta.dirname, "..", "..")
export const HASURA_ROOT = join(PACKAGE_ROOT, "hasura")

export const manifest = JSON.parse(
  readFileSync(join(HASURA_ROOT, "manifest.json"), "utf8"),
) as {
  name: string
  vars: Record<string, { description: string; default?: string }>
}

/** `{{var}}` replaced; an unknown variable is an error, as the CLI makes it. */
export const render = (text: string, vars: Readonly<Record<string, string>>) =>
  text.replace(/\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/g, (_, name: string) => {
    const value = vars[name] ?? manifest.vars[name]?.default
    if (value === undefined)
      throw new Error(`Unknown template variable ${name}`)
    return value
  })

/** Every migration, oldest first. */
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

export const TEST_VARS = {
  prefix: "credit_",
  schema: "public",
  owner_table: "user",
  owner_id_column: "id",
  owner_id_type: "text",
  server_role: "server",
  user_role: "user",
  usage_table: "credit_usage",
  min_purchase_cents: "500",
}

export const databaseUrl = process.env.CREDITS_TEST_DATABASE_URL

/** A fresh database with the owner table and every migration applied. */
export const freshDatabase = async (name: string) => {
  const admin = new pg.Client({ connectionString: databaseUrl })
  await admin.connect()
  await admin.query(`DROP DATABASE IF EXISTS ${name}`)
  await admin.query(`CREATE DATABASE ${name}`)
  await admin.end()
  const url = new URL(databaseUrl as string)
  url.pathname = `/${name}`
  const pool = new pg.Pool({ connectionString: url.toString(), max: 8 })
  await pool.query(`CREATE TABLE public."user" (id text PRIMARY KEY)`)
  for (const migration of migrations()) {
    await pool.query(render(migration.up, TEST_VARS))
  }
  return pool
}
