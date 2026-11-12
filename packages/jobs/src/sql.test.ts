import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { queueOn, renderInto } from "./fixture"
import { reclaimedRepeatedly } from "./jobs"

type Queue = Awaited<ReturnType<typeof queueOn>>
let q: Queue

const rows = async (where = "true") =>
  (
    await q.db.query<Record<string, unknown>>(
      `SELECT * FROM jobs WHERE ${where} ORDER BY id`,
    )
  ).rows

const asRole = async (role: string, sql: string) => {
  await q.db.exec(
    `SELECT set_config('hasura.user', '{"x-hasura-role":"${role}"}', false)`,
  )
  try {
    return await q.db.query(sql)
  } finally {
    await q.db.exec(`SELECT set_config('hasura.user', '', false)`)
  }
}

beforeAll(async () => {
  q = await queueOn()
}, 60_000)
afterAll(async () => {
  await q.db.close()
})
beforeEach(async () => {
  await q.db.exec("TRUNCATE jobs RESTART IDENTITY")
})

describe("enqueue", () => {
  it("is one pending row per scope, however many asks", async () => {
    const first = await q.jobs.enqueue({
      scope: "a",
      reason: "first",
      source: "person",
      payload: { room: 1 },
    })
    const second = await q.jobs.enqueue({
      scope: "a",
      reason: "second",
      source: "system",
      delaySeconds: 3600,
    })
    expect(second?.id).toBe(first?.id)
    const [row] = await rows()
    expect(await rows()).toHaveLength(1)
    expect(row).toMatchObject({
      reason: "second",
      source: "system",
      status: "pending",
    })
    // the earliest run_after wins, and a payload-less ask keeps the old payload
    expect(new Date(row!.run_after as string).getTime()).toBeLessThanOrEqual(
      Date.now() + 5000,
    )
    expect(row!.payload).toEqual({ room: 1 })
    await q.jobs.enqueue({ scope: "a", reason: "third", payload: { room: 2 } })
    expect((await rows())[0]!.payload).toEqual({ room: 2 })
    await q.jobs.enqueue({ scope: "b", reason: "other scope" })
    expect(await rows()).toHaveLength(2)
  })

  it("can be delayed", async () => {
    const job = await q.jobs.enqueue({
      scope: "a",
      reason: "later",
      delaySeconds: 3600,
    })
    expect(new Date(job!.runAfter).getTime()).toBeGreaterThan(
      Date.now() + 3_000_000,
    )
    expect(await q.jobs.claim(60)).toBeUndefined()
  })

  it("reads rows back as camelCase jobs", async () => {
    const job = await q.jobs.enqueue({
      scope: "a",
      reason: "r",
      payload: { x: 1 },
    })
    expect(job).toMatchObject({
      scope: "a",
      status: "pending",
      source: "system",
      reason: "r",
      attempts: 0,
      wrote: false,
      outcome: null,
      attempt: null,
      payload: { x: 1 },
      claimedAt: null,
    })
    expect(typeof job!.id).toBe("string")
  })
})

describe("every function is the server's own", () => {
  it("refuses any other role, and no role, with insufficient_privilege", async () => {
    const calls = [
      "SELECT * FROM jobs_enqueue('a', 's', 'r')",
      "SELECT * FROM jobs_claim(60)",
      "SELECT * FROM jobs_heartbeat(1, 60)",
      "SELECT * FROM jobs_finish(1, 'done', false, '')",
      "SELECT * FROM jobs_mark_attempt(1, 'x')",
      "SELECT * FROM jobs_reclaim()",
      "SELECT * FROM jobs_sweep()",
    ]
    for (const call of calls) {
      await expect(asRole("user", call)).rejects.toThrow(/the server's own/)
      await expect(q.db.query(call)).rejects.toThrow(/the server's own/)
      await expect(asRole("server", call)).resolves.toBeDefined()
    }
  })
})

describe("claim", () => {
  it("takes one job under a lease and counts the attempt", async () => {
    await q.jobs.enqueue({ scope: "a", reason: "r" })
    const job = await q.jobs.claim(60)
    expect(job).toMatchObject({ scope: "a", status: "running", attempts: 1 })
    expect(job!.leasedUntil).not.toBeNull()
    expect(await q.jobs.claim(60)).toBeUndefined()
  })

  it("holds a scope while its running job's lease is live, and only that scope", async () => {
    await q.jobs.enqueue({ scope: "a", reason: "r" })
    const running = await q.jobs.claim(60)
    await q.jobs.enqueue({ scope: "a", reason: "again" })
    await q.jobs.enqueue({ scope: "b", reason: "other" })
    expect((await q.jobs.claim(60))?.scope).toBe("b")
    expect(await q.jobs.claim(60)).toBeUndefined()
    await q.jobs.finish(running!.id, { status: "done" })
    expect((await q.jobs.claim(60))?.scope).toBe("a")
  })

  it("frees a scope whose lease ran out, so the next claim may take it", async () => {
    await q.jobs.enqueue({ scope: "a", reason: "r" })
    await q.jobs.claim(60)
    await q.jobs.enqueue({ scope: "a", reason: "again" })
    await q.db.exec(
      "UPDATE jobs SET leased_until = now() - interval '1 minute' WHERE status = 'running'",
    )
    expect((await q.jobs.claim(60))?.reason).toBe("again")
  })

  it("claims the earliest due job first", async () => {
    await q.jobs.enqueue({ scope: "late", reason: "r" })
    await q.db.exec("UPDATE jobs SET run_after = now() - interval '1 hour'")
    await q.jobs.enqueue({ scope: "early", reason: "r" })
    await q.db.exec(
      "UPDATE jobs SET run_after = now() - interval '2 hours' WHERE scope_id = 'early'",
    )
    expect((await q.jobs.claim(60))?.scope).toBe("early")
  })

  it("never gives the same job to two claimers", async () => {
    for (const scope of ["a", "b", "c", "d"])
      await q.jobs.enqueue({ scope, reason: "r" })
    const claimed = await Promise.all(
      [1, 2, 3, 4, 5, 6].map(() => q.jobs.claim(60)),
    )
    const taken = claimed.filter(Boolean).map((j) => j!.id)
    expect(new Set(taken).size).toBe(taken.length)
    expect(taken).toHaveLength(4)
  })
})

describe("heartbeat, finish and mark_attempt", () => {
  it("renews only a running job's lease", async () => {
    await q.jobs.enqueue({ scope: "a", reason: "r" })
    const job = await q.jobs.claim(30)
    expect(await q.jobs.heartbeat(job!.id, 600)).toBe(true)
    const [row] = await rows()
    expect(new Date(row!.leased_until as string).getTime()).toBeGreaterThan(
      Date.now() + 500_000,
    )
    await q.jobs.finish(job!.id, { status: "done" })
    expect(await q.jobs.heartbeat(job!.id, 600)).toBe(false)
  })

  it("finishes a running job once, with its outcome, wrote and attempt", async () => {
    await q.jobs.enqueue({ scope: "a", reason: "r" })
    const job = await q.jobs.claim(60)
    await q.jobs.markAttempt(job!.id, "turn:7")
    expect(
      await q.jobs.finish(job!.id, {
        status: "failed",
        wrote: true,
        outcome: "boom",
      }),
    ).toBe(true)
    expect((await rows())[0]).toMatchObject({
      status: "failed",
      wrote: true,
      outcome: "boom",
      attempt: "turn:7",
    })
    expect((await rows())[0]!.finished_at).not.toBeNull()
    expect(await q.jobs.finish(job!.id, { status: "done" })).toBe(false)
    expect((await rows())[0]!.status).toBe("failed")
  })

  it("refuses a status that is not an ending", async () => {
    await expect(
      asRole("server", "SELECT * FROM jobs_finish(1, 'running', false, '')"),
    ).rejects.toThrow(/done, failed or paused/)
  })

  it("lets a pass pause a job, and clips a long outcome", async () => {
    await q.jobs.enqueue({ scope: "a", reason: "r" })
    const job = await q.jobs.claim(60)
    await q.jobs.finish(job!.id, {
      status: "paused",
      outcome: "x".repeat(3000),
    })
    const [row] = await rows()
    expect(row!.status).toBe("paused")
    expect((row!.outcome as string).length).toBe(500)
  })

  it("ignores a mark_attempt for a job that is not running", async () => {
    await q.jobs.enqueue({ scope: "a", reason: "r" })
    await q.jobs.markAttempt("1", "x")
    expect((await rows())[0]!.attempt).toBeNull()
  })
})

describe("reclaim", () => {
  const dieOnce = async (scope: string, attempt?: string) => {
    await q.jobs.enqueue({ scope, reason: "r", payload: { keep: true } })
    const job = await q.jobs.claim(60)
    if (attempt) await q.jobs.markAttempt(job!.id, attempt)
    await q.db.exec(
      `UPDATE jobs SET leased_until = now() - interval '1 minute' WHERE id = ${job!.id}`,
    )
    return job!
  }

  it("fails a dead job and asks for its scope again with its payload", async () => {
    const dead = await dieOnce("a")
    const reclaimed = await q.jobs.reclaim()
    expect(reclaimed).toHaveLength(1)
    expect(reclaimed[0]).toMatchObject({ id: dead.id, status: "failed" })
    expect(reclaimed[0]!.outcome).toContain(
      "reclaimed: the pass stopped answering",
    )
    expect(reclaimedRepeatedly(reclaimed[0]!)).toBe(false)
    const pending = await rows("status = 'pending'")
    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({
      scope_id: "a",
      reason: "a pass that stopped answering",
      payload: { keep: true },
    })
  })

  it("leaves a live lease alone", async () => {
    await q.jobs.enqueue({ scope: "a", reason: "r" })
    await q.jobs.claim(600)
    expect(await q.jobs.reclaim()).toEqual([])
  })

  it("does not ask again when the same thing killed the pass twice", async () => {
    await dieOnce("a", "turn:7")
    await q.jobs.reclaim()
    await q.db.exec(
      "UPDATE jobs SET finished_at = now() - interval '2 hours' WHERE status = 'failed'",
    )
    await q.db.exec(
      "UPDATE jobs SET status = 'running', claimed_at = now(), leased_until = now() - interval '1 minute', attempt = 'turn:7' WHERE status = 'pending'",
    )
    const second = await q.jobs.reclaim()
    expect(second).toHaveLength(1)
    expect(reclaimedRepeatedly(second[0]!)).toBe(true)
    expect(await rows("status = 'pending'")).toHaveLength(0)
  })

  it("does not ask again when reclaimed twice within the window", async () => {
    await dieOnce("a")
    await q.jobs.reclaim()
    await q.db.exec(
      "UPDATE jobs SET status = 'running', claimed_at = now(), leased_until = now() - interval '1 minute' WHERE status = 'pending'",
    )
    const second = await q.jobs.reclaim(900)
    expect(reclaimedRepeatedly(second[0]!)).toBe(true)
    expect(await rows("status = 'pending'")).toHaveLength(0)
  })

  it("asks again outside the window with a different attempt", async () => {
    await dieOnce("a", "turn:1")
    await q.jobs.reclaim()
    await q.db.exec(
      "UPDATE jobs SET finished_at = now() - interval '2 hours' WHERE status = 'failed'",
    )
    await q.db.exec(
      "UPDATE jobs SET status = 'running', claimed_at = now(), leased_until = now() - interval '1 minute', attempt = 'turn:2' WHERE status = 'pending'",
    )
    const second = await q.jobs.reclaim()
    expect(reclaimedRepeatedly(second[0]!)).toBe(false)
    expect(await rows("status = 'pending'")).toHaveLength(1)
  })
})

describe("sweep", () => {
  it("clears old finished jobs and answers with what is due", async () => {
    await q.jobs.enqueue({ scope: "old", reason: "r" })
    const old = await q.jobs.claim(60)
    await q.jobs.finish(old!.id, { status: "done" })
    await q.db.exec("UPDATE jobs SET finished_at = now() - interval '30 days'")
    await q.jobs.enqueue({ scope: "recent", reason: "r" })
    const recent = await q.jobs.claim(60)
    await q.jobs.finish(recent!.id, { status: "done" })
    await q.jobs.enqueue({ scope: "due", reason: "r" })
    await q.jobs.enqueue({ scope: "later", reason: "r", delaySeconds: 3600 })
    const due = await q.jobs.sweep(14)
    expect(due.map((j) => j.scope)).toEqual(["due"])
    expect((await rows()).map((r) => r.scope_id)).toEqual([
      "recent",
      "due",
      "later",
    ])
  })
})

describe("the templates", () => {
  it("render with other names and work: prefix, table, scope column and type", async () => {
    const custom = await queueOn(
      {
        prefix: "ai_",
        jobs_table: "runs",
        scope_column: "room_id",
        scope_type: "uuid",
        server_role: "worker",
      },
      {
        prefix: "ai_",
        table: "runs",
        scopeColumn: "room_id",
        serverRole: "worker",
      },
    )
    try {
      expect(custom.rendered.up).toContain("CREATE TABLE public.ai_runs")
      expect(custom.rendered.up).not.toContain("{{")
      const scope = "6f1c1b0e-3b8f-4d57-9f6e-0b8f5a1d2c3e"
      const job = await custom.jobs.enqueue({ scope, reason: "r" })
      expect(job?.scope).toBe(scope)
      expect((await custom.jobs.claim(60))?.id).toBe(job?.id)
      await expect(
        custom.db.query("SELECT * FROM ai_runs_claim(60)"),
      ).rejects.toThrow(/the server's own/)
    } finally {
      await custom.db.close()
    }
  }, 60_000)

  it("down.sql removes everything the migration made", async () => {
    const fresh = await queueOn()
    try {
      await fresh.db.exec(fresh.rendered.down)
      const left = await fresh.db.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'jobs_%'",
      )
      expect(left.rows[0]!.n).toBe("0")
      await expect(fresh.db.query("SELECT 1 FROM jobs")).rejects.toThrow()
      await fresh.db.exec(fresh.rendered.up)
    } finally {
      await fresh.db.close()
    }
  }, 60_000)

  it("render metadata: the table with a server-only select, and every function as a server mutation", () => {
    const rendered = renderInto({ prefix: "ai_", server_role: "worker" })
    const table = rendered.read("metadata/tables/public_ai_jobs.yaml")
    expect(table).toContain("name: ai_jobs")
    expect(table).toContain("role: worker")
    expect(rendered.read("metadata/tables/tables.yaml")).toContain(
      "!include public_ai_jobs.yaml",
    )
    const functions = rendered.read("metadata/functions.yaml")
    for (const fn of [
      "enqueue",
      "claim",
      "heartbeat",
      "finish",
      "mark_attempt",
      "reclaim",
      "sweep",
    ]) {
      expect(functions).toContain(`name: ai_jobs_${fn}`)
    }
    expect(functions.match(/role: worker/g)).toHaveLength(7)
    expect(functions).not.toContain("assert_server")
  })
})
