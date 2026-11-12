import type { Jobs, Logger } from "./jobs"
import type { Job, JobResult } from "./types"

/** What a handler is handed beside the job. */
export type PassContext = {
  /** Aborted when the pass runs past its timeout or its job is taken back. Pass it to whatever you await. */
  signal: AbortSignal
  /** Writes what the pass has started on, for a reclaim to read should this process die. */
  markAttempt: (attempt: string) => Promise<void>
}

export type JobHandler<P = unknown> = (
  job: Job<P>,
  pass: PassContext,
) => Promise<JobResult | void>

export type RunnerOptions<P = unknown> = {
  jobs: Jobs
  /** Does the work. Throwing fails the job with the error's message. Returning nothing is `done`. */
  handler: JobHandler<P>
  /** How many scopes are worked at once per process; a scope is still one pass at a time. Default 3. */
  concurrency?: number
  /** How long a claimed job holds its scope without word from its runner. Default 120. */
  leaseSeconds?: number
  /** The longest a pass may run before it is aborted and failed. Default 300. */
  passTimeoutSeconds?: number
  /** How often the lease is renewed. Default a third of the lease, at least 5s. */
  heartbeatMs?: number
  /**
   * What becomes of a finished pass. Default: finish the job. Override to
   * apply your own policy (stop a scope after a failure, tell its owner)
   * around `finish`.
   */
  settle?: (
    job: Job<P>,
    result: JobResult,
    finish: () => Promise<boolean>,
  ) => Promise<void>
  log?: Logger
}

/** What ended a pass early, in the words its job is failed with. */
export const TAKEN_BACK = "the job was taken back while its pass ran"

const messageOf = (error: unknown) =>
  error instanceof Error
    ? error.message || error.name
    : String(error ?? "the pass failed without saying why")

const abortedBy = (signal: AbortSignal) =>
  new Promise<never>((_, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    signal.addEventListener("abort", () => reject(signal.reason), {
      once: true,
    })
  })

const quiet: Logger = { warn: () => undefined, error: () => undefined }

/**
 * A pool of workers over the queue. `drain` claims and works jobs until
 * nothing is due; `kick` starts that without waiting (for a webhook that owes
 * Hasura a prompt 200); `tick` is the minute hand: reclaim, sweep, drain.
 *
 * State is per runner. Make one and keep it (on `globalThis` in dev, where
 * module reloads would otherwise start a second set of workers).
 */
export const createJobRunner = <P = unknown>(options: RunnerOptions<P>) => {
  const { jobs, handler } = options
  const concurrency = Math.max(Math.floor(options.concurrency ?? 3), 1)
  const leaseSeconds = options.leaseSeconds ?? 120
  const passTimeoutMs = (options.passTimeoutSeconds ?? 300) * 1000
  const heartbeatMs =
    options.heartbeatMs ?? Math.max(Math.floor((leaseSeconds * 1000) / 3), 5000)
  const log = options.log ?? quiet
  const workers = { busy: 0, again: false }

  /**
   * One claimed job, worked under its lease: renewed on a timer so a living
   * pass keeps its scope and a dead process loses it within one lease; ended
   * by the timeout, which aborts the signal; given up on when a renewal finds
   * the job no longer running, since whoever took it back has already said
   * what happened to it.
   */
  const work = async (job: Job<P>): Promise<void> => {
    const controller = new AbortController()
    let takenBack = false
    let started: string | undefined
    const beat = setInterval(() => {
      jobs
        .heartbeat(job.id, leaseSeconds)
        .then((alive) => {
          if (!alive && !controller.signal.aborted) {
            takenBack = true
            controller.abort(new Error(TAKEN_BACK))
          }
        })
        .catch((error) =>
          log.error(`could not renew the lease on job ${job.id}`, error),
        )
    }, heartbeatMs)
    const timer = setTimeout(() => {
      controller.abort(
        new Error(
          `the pass ran past ${options.passTimeoutSeconds ?? 300} seconds and was stopped`,
        ),
      )
    }, passTimeoutMs)

    let result: JobResult
    try {
      const outcome = await Promise.race([
        handler(job, {
          signal: controller.signal,
          markAttempt: async (attempt) => {
            started = attempt
            await jobs.markAttempt(job.id, attempt)
          },
        }),
        abortedBy(controller.signal),
      ])
      // A pass that returned only because it was told to stop did not finish its work.
      if (controller.signal.aborted) throw controller.signal.reason
      result = outcome ?? { status: "done" }
    } catch (error) {
      result = {
        status: "failed",
        wrote: false,
        outcome: messageOf(error),
        attempt: started,
      }
    } finally {
      clearInterval(beat)
      clearTimeout(timer)
    }
    if (takenBack) {
      log.warn(
        `job ${job.id} was taken back while it ran; leaving it as it was left`,
      )
      return
    }
    const finish = () =>
      jobs.finish(job.id, { ...result, attempt: result.attempt ?? started })
    if (options.settle) await options.settle(job, result, finish)
    else await finish()
  }

  const drain = async (): Promise<void> => {
    if (workers.busy >= concurrency) {
      workers.again = true
      return
    }
    workers.busy += 1
    try {
      do {
        workers.again = false
        let job = await jobs.claim<P>(leaseSeconds)
        while (job) {
          if (workers.busy < concurrency) {
            drain().catch((error) => log.error("a worker stopped", error))
          }
          await work(job)
          job = await jobs.claim<P>(leaseSeconds)
        }
      } while (workers.again)
    } finally {
      workers.busy -= 1
    }
  }

  return {
    drain,
    /** Starts draining and does not wait. What stops a worker is logged, never swallowed. */
    kick: () => {
      drain().catch((error) => log.error("a worker stopped", error))
    },
    /**
     * The minute hand: fails jobs whose lease ran out (asking for their
     * scopes again), clears old rows, then drains. Answers with the reclaimed
     * jobs so the app can stop and tell about any that
     * `reclaimedRepeatedly` names.
     */
    tick: async (
      tickOptions: {
        repeatWindowSeconds?: number
        retentionDays?: number
      } = {},
    ) => {
      const reclaimed = await jobs.reclaim<P>(tickOptions.repeatWindowSeconds)
      await jobs.sweep<P>(tickOptions.retentionDays)
      await drain()
      return reclaimed
    },
    /** How many workers are busy now. */
    busy: () => workers.busy,
  }
}

export type JobRunner<P = unknown> = ReturnType<typeof createJobRunner<P>>

/** One drain of the queue: claim and work jobs until nothing is due. */
export const runJobs = <P = unknown>(
  options: RunnerOptions<P>,
): Promise<void> => createJobRunner(options).drain()
