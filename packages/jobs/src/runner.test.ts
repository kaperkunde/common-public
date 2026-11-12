import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"

import { queueOn } from "./fixture"
import { TAKEN_BACK, createJobRunner, runJobs } from "./runner"
import type { Job } from "./types"

type Queue = Awaited<ReturnType<typeof queueOn>>
let q: Queue

const row = async (id: string) =>
  (
    await q.db.query<Record<string, unknown>>(
      `SELECT * FROM jobs WHERE id = ${id}`,
    )
  ).rows[0]!
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

beforeAll(async () => {
  q = await queueOn()
}, 60_000)
afterAll(async () => {
  await q.db.close()
})
beforeEach(async () => {
  await q.db.exec("TRUNCATE jobs RESTART IDENTITY")
})

describe("runJobs", () => {
  it("claims and works every due job, finishing each as the handler says", async () => {
    await q.jobs.enqueue({ scope: "a", reason: "r", payload: { n: 1 } })
    await q.jobs.enqueue({ scope: "b", reason: "r", payload: { n: 2 } })
    const seen: Job<{ n: number }>[] = []
    await runJobs<{ n: number }>({
      jobs: q.jobs,
      handler: async (job) => {
        seen.push(job)
        return {
          status: "done",
          wrote: job.payload?.n === 2,
          outcome: `did ${job.scope}`,
        }
      },
    })
    expect(seen.map((j) => j.scope)).toEqual(["a", "b"])
    expect(await row("1")).toMatchObject({
      status: "done",
      wrote: false,
      outcome: "did a",
    })
    expect(await row("2")).toMatchObject({
      status: "done",
      wrote: true,
      outcome: "did b",
    })
  })

  it("treats a handler that returns nothing as done", async () => {
    await q.jobs.enqueue({ scope: "a", reason: "r" })
    await runJobs({ jobs: q.jobs, handler: async () => undefined })
    expect((await row("1")).status).toBe("done")
  })

  it("fails the job with the error's message when the handler throws, keeping what it started on", async () => {
    await q.jobs.enqueue({ scope: "a", reason: "r" })
    await runJobs({
      jobs: q.jobs,
      handler: async (_job, pass) => {
        await pass.markAttempt("step 2")
        throw new Error("the model said no")
      },
    })
    expect(await row("1")).toMatchObject({
      status: "failed",
      outcome: "the model said no",
      attempt: "step 2",
    })
  })

  it("aborts a pass that runs past its timeout and fails it", async () => {
    await q.jobs.enqueue({ scope: "a", reason: "r" })
    let aborted = false
    await runJobs({
      jobs: q.jobs,
      passTimeoutSeconds: 0.05,
      handler: (_job, pass) =>
        new Promise((resolve) => {
          pass.signal.addEventListener("abort", () => {
            aborted = true
            resolve({ status: "done" })
          })
        }),
    })
    expect(aborted).toBe(true)
    expect(await row("1")).toMatchObject({ status: "failed" })
    expect((await row("1")).outcome).toContain("ran past")
  })

  it("keeps the lease alive while a pass runs", async () => {
    await q.jobs.enqueue({ scope: "a", reason: "r" })
    const heartbeats = vi.spyOn(q.jobs, "heartbeat")
    await runJobs({
      jobs: q.jobs,
      leaseSeconds: 30,
      heartbeatMs: 20,
      handler: async () => {
        await sleep(120)
        return { status: "done" }
      },
    })
    expect(heartbeats.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(heartbeats.mock.calls[0]![1]).toBe(30)
    heartbeats.mockRestore()
  })

  it("lets go of a job that was taken back, finishing nothing", async () => {
    await q.jobs.enqueue({ scope: "a", reason: "r" })
    const log = { warn: vi.fn(), error: vi.fn() }
    let signal: AbortSignal | undefined
    await runJobs({
      jobs: q.jobs,
      heartbeatMs: 20,
      log,
      handler: async (job, pass) => {
        signal = pass.signal
        await q.db.exec(
          `UPDATE jobs SET status = 'failed', outcome = 'unstuck by its owner' WHERE id = ${job.id}`,
        )
        await sleep(100)
        return { status: "done", outcome: "late" }
      },
    })
    expect(signal?.aborted).toBe(true)
    expect((signal?.reason as Error).message).toBe(TAKEN_BACK)
    expect((await row("1")).outcome).toBe("unstuck by its owner")
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("taken back"))
  })

  it("hands the finished pass to settle, which may add its own policy around finish", async () => {
    await q.jobs.enqueue({ scope: "a", reason: "r" })
    const order: string[] = []
    await runJobs({
      jobs: q.jobs,
      handler: async () => ({ status: "failed", outcome: "fatal" }),
      settle: async (job, result, finish) => {
        order.push(`stop ${job.scope} for ${result.outcome}`)
        await finish()
        order.push("told them")
      },
    })
    expect(order).toEqual(["stop a for fatal", "told them"])
    expect((await row("1")).status).toBe("failed")
  })
})

describe("concurrency", () => {
  it("works up to `concurrency` scopes at once, and a scope one pass at a time", async () => {
    for (const scope of ["a", "b", "c", "d", "e"])
      await q.jobs.enqueue({ scope, reason: "r" })
    let live = 0
    let peak = 0
    const runner = createJobRunner({
      jobs: q.jobs,
      concurrency: 2,
      handler: async () => {
        live += 1
        peak = Math.max(peak, live)
        await sleep(30)
        live -= 1
        return { status: "done" }
      },
    })
    await runner.drain()
    // drain returns for the first worker; wait for the rest to finish
    for (
      let i = 0;
      i < 50 &&
      (runner.busy() > 0 ||
        (await q.db.query("SELECT 1 FROM jobs WHERE status <> 'done'")).rows
          .length);
      i++
    ) {
      await sleep(20)
    }
    expect(peak).toBe(2)
    expect(
      (
        await q.db.query(
          "SELECT count(*)::int AS n FROM jobs WHERE status = 'done'",
        )
      ).rows[0],
    ).toEqual({ n: 5 })
  })

  it("a call while every worker is busy leaves one more look behind", async () => {
    await q.jobs.enqueue({ scope: "a", reason: "r" })
    const handled: string[] = []
    const runner = createJobRunner({
      jobs: q.jobs,
      concurrency: 1,
      handler: async (job) => {
        handled.push(job.scope)
        if (job.scope === "a") {
          await q.jobs.enqueue({ scope: "b", reason: "asked during a" })
          await runner.drain() // busy: only leaves `again`
        }
        return { status: "done" }
      },
    })
    await runner.drain()
    expect(handled).toEqual(["a", "b"])
  })
})

describe("kick and tick", () => {
  it("kick starts without waiting and logs what stops a worker", async () => {
    const log = { warn: vi.fn(), error: vi.fn() }
    const jobs = {
      ...q.jobs,
      claim: async () => {
        throw new Error("hasura down")
      },
    } as unknown as typeof q.jobs
    createJobRunner({ jobs, handler: async () => undefined, log }).kick()
    await vi.waitFor(() =>
      expect(log.error).toHaveBeenCalledWith(
        "a worker stopped",
        expect.any(Error),
      ),
    )
  })

  it("kick works what is due", async () => {
    await q.jobs.enqueue({ scope: "a", reason: "r" })
    createJobRunner({
      jobs: q.jobs,
      handler: async () => ({ status: "done", outcome: "kicked" }),
    }).kick()
    await vi.waitFor(async () =>
      expect((await row("1")).outcome).toBe("kicked"),
    )
  })

  it("tick reclaims a dead pass, clears old rows, then works what is due", async () => {
    await q.jobs.enqueue({ scope: "dead", reason: "r" })
    await q.jobs.claim(60)
    await q.db.exec(
      "UPDATE jobs SET leased_until = now() - interval '1 minute'",
    )
    const handled: string[] = []
    const reclaimed = await createJobRunner({
      jobs: q.jobs,
      handler: async (job) => {
        handled.push(`${job.scope}:${job.reason}`)
        return { status: "done" }
      },
    }).tick()
    expect(reclaimed.map((j) => j.scope)).toEqual(["dead"])
    expect(handled).toEqual(["dead:a pass that stopped answering"])
  })
})
