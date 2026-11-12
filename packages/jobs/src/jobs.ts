import type { Job, JobResult, RawJob, Transport } from "./types"

/** What `finish` retries: three tries, 0.5s then 2s then 8s apart. */
const FINISH_TRIES = 3

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

const text = (value: unknown) =>
  value === null || value === undefined ? null : String(value)

/** A raw row (snake_case, strings or numbers) as a {@link Job}. */
export const jobOf = <P = unknown>(
  row: RawJob,
  scopeColumn: string,
): Job<P> => ({
  id: String(row.id),
  scope: String(row[scopeColumn]),
  status: row.status as Job["status"],
  source: String(row.source),
  reason: String(row.reason),
  attempts: Number(row.attempts),
  runAfter: String(row.run_after),
  claimedAt: text(row.claimed_at),
  leasedUntil: text(row.leased_until),
  finishedAt: text(row.finished_at),
  wrote: Boolean(row.wrote),
  outcome: text(row.outcome),
  attempt: text(row.attempt),
  payload: (row.payload ?? null) as P | null,
  createdAt: String(row.created_at),
})

export type EnqueueInput<P = unknown> = {
  scope: string
  /** Who asked, in your own words. Default `system`. */
  source?: string
  reason: string
  /** Carried with the job; the newest ask that names one keeps it. */
  payload?: P
  /** Do not run before this many seconds from now. */
  delaySeconds?: number
}

export type Logger = {
  warn: (message: string, ...detail: unknown[]) => void
  error: (message: string, ...detail: unknown[]) => void
}

const quiet: Logger = { warn: () => undefined, error: () => undefined }

export type JobsOptions = {
  transport: Transport
  /** Where `finish` failures and the like are said. Default: nowhere. */
  log?: Logger
  /** Pause between `finish` retries, for tests. */
  retryPause?: (ms: number) => Promise<void>
}

/**
 * The queue's calls, over whichever transport. Every function here is the
 * server's own: the transport must run as the server role.
 */
export const createJobs = (options: JobsOptions) => {
  const { transport } = options
  const log = options.log ?? quiet
  const pause = options.retryPause ?? sleep
  const read = <P>(rows: RawJob[]) =>
    rows.map((row) => jobOf<P>(row, transport.scopeColumn))

  return {
    /**
     * Asks for a scope to be looked at. Several asks before a pass are one
     * job: the earliest time, the newest reason and source, and the newest
     * payload that says anything.
     */
    async enqueue<P = unknown>(
      input: EnqueueInput<P>,
    ): Promise<Job<P> | undefined> {
      const rows = await transport.call("enqueue", {
        job_scope: input.scope,
        job_source: input.source ?? "system",
        job_reason: input.reason,
        job_payload: input.payload ?? null,
        delay_seconds: input.delaySeconds ?? 0,
      })
      return read<P>(rows)[0]
    },

    /** Takes the next due job, at most one per scope, under a lease. */
    async claim<P = unknown>(
      leaseSeconds: number,
    ): Promise<Job<P> | undefined> {
      return read<P>(
        await transport.call("claim", { lease_seconds: leaseSeconds }),
      )[0]
    },

    /** Renews a lease. False once the job is no longer running, which ends its pass. */
    async heartbeat(id: string, leaseSeconds: number): Promise<boolean> {
      const rows = await transport.call("heartbeat", {
        job_id: id,
        lease_seconds: leaseSeconds,
      })
      return rows.length > 0
    },

    /**
     * Puts a running job down with a line about what came of it, trying three
     * times. Answers whether this call finished it: false too for a job
     * already taken back, which is somebody else's to say.
     */
    async finish(id: string, result: JobResult): Promise<boolean> {
      const args = {
        job_id: id,
        job_status: result.status,
        job_wrote: result.wrote ?? false,
        job_outcome: (result.outcome ?? "").slice(
          0,
          result.status === "failed" ? 2000 : 500,
        ),
        job_attempt: result.attempt ?? null,
      }
      let last: unknown
      for (let tries = 0; tries < FINISH_TRIES; tries += 1) {
        try {
          const rows = await transport.call("finish", args)
          if (rows.length === 0) {
            log.warn(
              `job ${id} was no longer running when it finished: ${args.job_outcome}`,
            )
          }
          return rows.length > 0
        } catch (error) {
          last = error
          await pause(500 * 4 ** tries)
        }
      }
      log.error(
        `COULD NOT FINISH job ${id} (${args.job_status}: ${args.job_outcome}); its scope is held until the lease runs out`,
        last,
      )
      return false
    },

    /** Says what a running pass has started on. A failure is logged, never thrown. */
    async markAttempt(id: string, attempt: string): Promise<void> {
      try {
        await transport.call("mark_attempt", {
          job_id: id,
          job_attempt: attempt,
        })
      } catch (error) {
        log.error(
          `could not note what job ${id} started on (${attempt})`,
          error,
        )
      }
    },

    /**
     * Fails jobs whose lease ran out and asks for their scopes again, unless
     * the same scope was reclaimed twice running (see {@link reclaimedRepeatedly}).
     * Answers with every job it failed.
     */
    async reclaim<P = unknown>(repeatWindowSeconds = 900): Promise<Job<P>[]> {
      return read<P>(
        await transport.call("reclaim", {
          repeat_window_seconds: repeatWindowSeconds,
        }),
      )
    },

    /** Clears long-finished jobs; answers with what is due. */
    async sweep<P = unknown>(retentionDays = 14): Promise<Job<P>[]> {
      return read<P>(
        await transport.call("sweep", { retention_days: retentionDays }),
      )
    },
  }
}

export type Jobs = ReturnType<typeof createJobs>

/**
 * Whether a job `reclaim` failed is the second time running for its scope, so
 * the scope was NOT asked for again and the app should stop it and tell someone.
 */
export const reclaimedRepeatedly = (job: Pick<Job, "outcome">): boolean =>
  Boolean(
    job.outcome?.startsWith("reclaimed:") &&
    job.outcome.includes("second time running"),
  )
