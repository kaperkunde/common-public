import { parse } from "graphql"
import { describe, expect, it, vi } from "vitest"

import { createJobs, jobOf } from "./jobs"
import { graphqlTransport, sqlTransport, type SqlExecutor } from "./transport"
import type { QueueCalls } from "./types"

const raw = (extra: object = {}) => ({
  id: "7",
  scope_id: "room-1",
  status: "pending",
  source: "system",
  reason: "r",
  attempts: 0,
  run_after: "2026-01-01T00:00:00+00:00",
  claimed_at: null,
  leased_until: null,
  finished_at: null,
  wrote: false,
  outcome: null,
  attempt: null,
  payload: null,
  created_at: "2026-01-01T00:00:00+00:00",
  ...extra,
})

const ARGS: QueueCalls = {
  enqueue: {
    job_scope: "s",
    job_source: "x",
    job_reason: "r",
    job_payload: { a: 1 },
    delay_seconds: 0,
  },
  claim: { lease_seconds: 60 },
  heartbeat: { job_id: "1", lease_seconds: 60 },
  finish: {
    job_id: "1",
    job_status: "done",
    job_wrote: true,
    job_outcome: "ok",
    job_attempt: null,
  },
  mark_attempt: { job_id: "1", job_attempt: "a" },
  reclaim: { repeat_window_seconds: 900 },
  sweep: { retention_days: 14 },
}

describe("graphqlTransport", () => {
  it("builds a valid mutation per function, named after the prefix and table, and reads the rows", async () => {
    const execute = vi.fn(async (_q: string, _v?: Record<string, unknown>) => ({
      ai_runs_claim: [raw({ room_id: "r1" })],
    }))
    const transport = graphqlTransport({
      execute,
      prefix: "ai_",
      table: "runs",
      scopeColumn: "room_id",
    })
    const rows = await transport.call("claim", ARGS.claim)
    expect(rows).toHaveLength(1)
    const [query, variables] = execute.mock.calls[0]!
    expect(query).toBe(
      "mutation Queue_claim($lease_seconds: Int!) { ai_runs_claim(args: {lease_seconds: $lease_seconds}) { room_id id status source reason attempts run_after claimed_at leased_until finished_at wrote outcome attempt payload created_at } }",
    )
    expect(variables).toEqual({ lease_seconds: 60 })
    for (const fn of Object.keys(ARGS) as (keyof QueueCalls)[]) {
      const seen = vi.fn(
        async (_q: string, _v?: Record<string, unknown>) => ({}),
      )
      await graphqlTransport({ execute: seen, scopeGraphqlType: "uuid" }).call(
        fn,
        ARGS[fn],
      )
      const document = parse(seen.mock.calls[0]![0])
      expect(document.definitions).toHaveLength(1)
      expect(seen.mock.calls[0]![0]).toContain(`jobs_${fn}(args:`)
    }
  })

  it("types the scope and ids as Hasura does", async () => {
    const seen = vi.fn(async (_q: string, _v?: Record<string, unknown>) => ({}))
    const t = graphqlTransport({ execute: seen, scopeGraphqlType: "uuid" })
    await t.call("enqueue", ARGS.enqueue)
    await t.call("heartbeat", ARGS.heartbeat)
    expect(seen.mock.calls[0]![0]).toContain(
      "$job_scope: uuid!, $job_source: String!, $job_reason: String!, $job_payload: jsonb, $delay_seconds: Int",
    )
    expect(seen.mock.calls[1]![0]).toContain("$job_id: bigint!")
  })

  it("answers no rows when the field is missing", async () => {
    const t = graphqlTransport({ execute: async () => ({}) })
    expect(await t.call("sweep", ARGS.sweep)).toEqual([])
  })

  it("propagates the executor's error", async () => {
    const t = graphqlTransport({
      execute: async () => {
        throw new Error("hasura down")
      },
    })
    await expect(t.call("claim", ARGS.claim)).rejects.toThrow("hasura down")
  })
})

describe("sqlTransport", () => {
  it("sets the server role then calls the function with casts, in one transaction", async () => {
    const calls: [string, unknown[] | undefined][] = []
    const sql: SqlExecutor = {
      transaction: async (run) =>
        run(async (text, params) => (calls.push([text, params]), [raw()])),
    }
    const rows = await sqlTransport({
      sql,
      schema: "app",
      prefix: "x_",
      table: "t",
      serverRole: "worker",
    }).call("enqueue", ARGS.enqueue)
    expect(rows).toHaveLength(1)
    expect(calls[0]).toEqual([
      "SELECT set_config('hasura.user', $1, true)",
      ['{"x-hasura-role":"worker"}'],
    ])
    expect(calls[1]![0]).toBe(
      'SELECT * FROM "app"."x_t_enqueue"($1, $2, $3, $4::jsonb, $5::integer)',
    )
    expect(calls[1]![1]).toEqual(["s", "x", "r", '{"a":1}', 0])
  })

  it("passes a null payload and attempt as nulls", async () => {
    const calls: [string, unknown[] | undefined][] = []
    const sql: SqlExecutor = {
      transaction: async (run) =>
        run(async (text, params) => (calls.push([text, params]), [])),
    }
    const t = sqlTransport({ sql })
    await t.call("enqueue", { ...ARGS.enqueue, job_payload: null })
    await t.call("finish", ARGS.finish)
    expect(calls[1]![1]![3]).toBeNull()
    expect(calls[3]![1]).toEqual(["1", "done", true, "ok", null])
    expect(calls[3]![0]).toContain("$1::bigint, $2, $3::boolean, $4, $5::text")
  })
})

describe("createJobs", () => {
  const transportOf = (
    call: (fn: string, args: unknown) => Promise<Record<string, unknown>[]>,
  ) => ({
    scopeColumn: "scope_id",
    call: call as never,
  })

  it("maps rows to camelCase jobs", () => {
    const job = jobOf(
      raw({ id: 9, attempts: "2", wrote: true, payload: { a: 1 } }),
      "scope_id",
    )
    expect(job).toMatchObject({
      id: "9",
      scope: "room-1",
      attempts: 2,
      wrote: true,
      payload: { a: 1 },
      runAfter: "2026-01-01T00:00:00+00:00",
    })
  })

  it("retries finish three times with growing pauses, then says so loudly and answers false", async () => {
    const pauses: number[] = []
    const log = { warn: vi.fn(), error: vi.fn() }
    const call = vi.fn(async () => {
      throw new Error("db down")
    })
    const jobs = createJobs({
      transport: transportOf(call),
      log,
      retryPause: async (ms) => void pauses.push(ms),
    })
    expect(await jobs.finish("1", { status: "failed", outcome: "x" })).toBe(
      false,
    )
    expect(call).toHaveBeenCalledTimes(3)
    expect(pauses).toEqual([500, 2000, 8000])
    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining("COULD NOT FINISH job 1"),
      expect.any(Error),
    )
  })

  it("succeeds on a retry, and warns when the job was no longer running", async () => {
    const log = { warn: vi.fn(), error: vi.fn() }
    const call = vi
      .fn()
      .mockRejectedValueOnce(new Error("blip"))
      .mockResolvedValueOnce([])
    const jobs = createJobs({
      transport: transportOf(call),
      log,
      retryPause: async () => undefined,
    })
    expect(await jobs.finish("1", { status: "done", outcome: "ok" })).toBe(
      false,
    )
    expect(call).toHaveBeenCalledTimes(2)
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("no longer running"),
    )
  })

  it("clips a done outcome to 500 and a failed one to 2000", async () => {
    const call = vi.fn(async () => [raw()])
    const jobs = createJobs({ transport: transportOf(call) })
    await jobs.finish("1", { status: "done", outcome: "x".repeat(3000) })
    await jobs.finish("1", { status: "failed", outcome: "x".repeat(3000) })
    const lengths = call.mock.calls.map(
      (c) =>
        (c as unknown as [string, { job_outcome: string }])[1].job_outcome
          .length,
    )
    expect(lengths).toEqual([500, 2000])
  })

  it("logs and swallows a failed markAttempt", async () => {
    const log = { warn: vi.fn(), error: vi.fn() }
    const jobs = createJobs({
      transport: transportOf(async () => {
        throw new Error("x")
      }),
      log,
    })
    await expect(jobs.markAttempt("1", "a")).resolves.toBeUndefined()
    expect(log.error).toHaveBeenCalled()
  })

  it("defaults source, payload and delay when enqueueing", async () => {
    const call = vi.fn(async () => [raw()])
    await createJobs({ transport: transportOf(call) }).enqueue({
      scope: "s",
      reason: "r",
    })
    expect(call.mock.calls[0]).toEqual([
      "enqueue",
      {
        job_scope: "s",
        job_source: "system",
        job_reason: "r",
        job_payload: null,
        delay_seconds: 0,
      },
    ])
  })
})
