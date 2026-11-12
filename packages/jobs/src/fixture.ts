import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { PGlite } from "@electric-sql/pglite"
import { runSync } from "@kaperkunde/hasura/sync"

import { sqlTransport, type QueueNames, type SqlExecutor } from "./transport"
import { createJobs } from "./jobs"

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..")

/** Renders this package into a throwaway app with `kk-hasura sync`, as an app would. */
export const renderInto = (vars: Record<string, string> = {}) => {
  const root = mkdtempSync(join(tmpdir(), "kk-jobs-"))
  writeFileSync(
    join(root, "kaperkunde.json"),
    JSON.stringify({
      hasura: {
        database: "main",
        migrationsDir: "migrations",
        metadataDir: "metadata",
      },
      packages: { "@kaperkunde/jobs": { vars } },
    }),
  )
  const lines: string[] = []
  const result = runSync({
    root,
    log: (line) => lines.push(line),
    resolvePackage: () => PACKAGE_DIR,
  })
  if (!result.ok) throw new Error(`sync failed: ${lines.join("\n")}`)
  const dir = join(root, "migrations", "1789500000000_jobs_queue")
  return {
    root,
    up: readFileSync(join(dir, "up.sql"), "utf8"),
    down: readFileSync(join(dir, "down.sql"), "utf8"),
    read: (path: string) => readFileSync(join(root, path), "utf8"),
  }
}

export const sqlOver = (db: PGlite): SqlExecutor => ({
  transaction: (run) =>
    db.transaction((tx) =>
      run(
        async (sql, params) =>
          (await tx.query<Record<string, unknown>>(sql, params as never[]))
            .rows,
      ),
    ),
})

/** A database with the migration applied and the queue over it. */
export const queueOn = async (
  vars: Record<string, string> = {},
  names: QueueNames & { serverRole?: string } = {},
) => {
  const rendered = renderInto(vars)
  const db = new PGlite()
  await db.exec(rendered.up)
  const transport = sqlTransport({ sql: sqlOver(db), ...names })
  return {
    db,
    rendered,
    jobs: createJobs({ transport, retryPause: async () => undefined }),
    transport,
  }
}
