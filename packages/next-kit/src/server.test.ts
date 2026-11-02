import { mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { describe, expect, it, vi } from "vitest"

import {
  cachedClient,
  getMigrationProblem,
  isUniqueViolation,
  mariaDbOptions,
  type RawQueryClient,
} from "./prisma"
import { dailyRunKey, runJob, type Job, type JobRunStore } from "./scheduler"

describe("mariaDbOptions", () => {
  it("reads a DATABASE_URL", () => {
    expect(
      mariaDbOptions({
        urlVariable: "DATABASE_URL",
        env: { DATABASE_URL: "mysql://u%40:p%3A@db:3307/app" },
      }),
    ).toMatchObject({
      host: "db",
      port: 3307,
      user: "u@",
      password: "p:",
      database: "app",
      timezone: "Z",
    })
  })

  it("reads prefixed variables with defaults", () => {
    expect(
      mariaDbOptions({
        prefix: "APP_DB",
        defaults: { user: "app", database: "app" },
        env: { APP_DB_HOST: "h" },
      }),
    ).toMatchObject({ host: "h", port: 3306, user: "app", database: "app" })
  })
})

describe("cachedClient", () => {
  it("reuses a client until it is stale", () => {
    const key = `test-client-${Math.random()}`
    const a = cachedClient(key, () => ({ v: 1 }), { production: false })
    expect(cachedClient(key, () => ({ v: 2 }), { production: false })).toBe(a)
    expect(
      cachedClient(key, () => ({ v: 3 }), {
        production: false,
        isStale: () => true,
      }).v,
    ).toBe(3)
  })
})

describe("getMigrationProblem", () => {
  const dir = () => {
    const root = mkdtempSync(path.join(tmpdir(), "migrations-"))
    mkdirSync(path.join(root, "20260101_a"))
    mkdirSync(path.join(root, "20260102_b"))
    return root
  }
  const client = (rows: unknown[]): RawQueryClient => ({
    $queryRawUnsafe: vi.fn(
      async (query: string) =>
        (query.includes("information_schema") ? [{ found: 1 }] : rows) as never,
    ),
  })

  it("is happy when everything is applied, and names what is not", async () => {
    const done = { finished_at: new Date(), rolled_back_at: null }
    expect(
      await getMigrationProblem(
        client([
          { migration_name: "20260101_a", ...done },
          { migration_name: "20260102_b", ...done },
        ]),
        { migrationsDir: dir() },
      ),
    ).toBeNull()
    expect(
      await getMigrationProblem(
        client([{ migration_name: "20260101_a", ...done }]),
        { migrationsDir: dir() },
      ),
    ).toBe("1 migration(s) not applied: 20260102_b")
    expect(
      await getMigrationProblem(
        client([
          {
            migration_name: "20260101_a",
            finished_at: null,
            rolled_back_at: null,
          },
        ]),
        { migrationsDir: dir() },
      ),
    ).toMatch(/did not finish/)
  })

  it("knows a unique violation", () => {
    expect(isUniqueViolation({ code: "P2002" })).toBe(true)
    expect(isUniqueViolation(new Error("x"))).toBe(false)
  })
})

describe("runJob", () => {
  const job = (run: Job["run"]): Job => ({
    name: "j",
    cron: "0 7 * * *",
    runKey: dailyRunKey,
    run,
  })
  const store = (
    claimed: string | null,
  ): JobRunStore & { finished: string[] } => {
    const finished: string[] = []
    return {
      finished,
      claim: async () => claimed,
      finish: async (_id, outcome) => void finished.push(outcome),
    }
  }

  it("runs a run once, and records its outcome", async () => {
    const s = store("1")
    expect(
      await runJob(
        job(async () => "sent 3"),
        s,
      ),
    ).toEqual({ ran: true, outcome: "sent 3" })
    expect(s.finished).toEqual(["sent 3"])
    expect(
      await runJob(
        job(async () => "again"),
        store(null),
      ),
    ).toEqual({ ran: false })
  })

  it("records a failure and rethrows it", async () => {
    const s = store("1")
    await expect(
      runJob(
        job(async () => {
          throw new Error("smtp down")
        }),
        s,
      ),
    ).rejects.toThrow("smtp down")
    expect(s.finished).toEqual(["failed: smtp down"])
  })
})
