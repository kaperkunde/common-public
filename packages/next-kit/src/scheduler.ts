/**
 * In-process jobs that run once per run, however many containers run them.
 *
 * Each job names its schedule (a cron expression) and a run key (say, the
 * UTC date for a daily job). Before running, a run is claimed in the app's
 * own table through `store.claim` (unique on name + run key): a second
 * replica, or an HTTP poke for the same run, finds it claimed and does
 * nothing. Jobs should still be idempotent themselves.
 */

export type Job = {
  name: string
  /** node-cron expression. */
  cron: string
  timezone?: string
  /** Which run `now` falls in: two calls with the same key are one run. */
  runKey(now: Date): string
  /** Does the work; answers a short outcome for the record. */
  run(now: Date): Promise<string>
}

export type JobRunStore = {
  /** Claims the run; answers its id, or null when it is already claimed. */
  claim(name: string, runKey: string): Promise<string | null>
  /** Records how a claimed run ended. */
  finish(id: string, outcome: string): Promise<void>
}

const OUTCOME_MAX = 500

function truncate(text: string): string {
  return text.length > OUTCOME_MAX ? `${text.slice(0, OUTCOME_MAX - 1)}…` : text
}

/**
 * Runs `job` once for the run `now` falls in. An error is recorded as
 * `failed: <message>` and rethrown; a run that dies without finishing keeps
 * a claimed row with no outcome.
 */
export async function runJob(
  job: Job,
  store: JobRunStore,
  now: Date = new Date(),
): Promise<{ ran: false } | { ran: true; outcome: string }> {
  const id = await store.claim(job.name, job.runKey(now))
  if (id === null) return { ran: false }

  let outcome: string
  try {
    outcome = truncate(await job.run(now))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await store
      .finish(id, truncate(`failed: ${message}`))
      .catch((recordError: unknown) => {
        console.error(
          `[scheduler] ${job.name}: could not record failure`,
          recordError,
        )
      })
    throw error
  }

  await store.finish(id, outcome)
  return { ran: true, outcome }
}

/** The run key of a job that runs once a UTC day. */
export const dailyRunKey = (now: Date) => now.toISOString().slice(0, 10)

/** The run key of a job that runs once a UTC hour. */
export const hourlyRunKey = (now: Date) => now.toISOString().slice(0, 13)

type CronModule = {
  schedule(
    expression: string,
    task: () => Promise<void>,
    options: { name: string; noOverlap?: boolean; timezone?: string },
  ): {
    name?: string
    destroy(): unknown
    on(
      event: string,
      listener: (context: { execution?: { error?: unknown } }) => void,
    ): unknown
  }
}

const TASKS = Symbol.for("@kaperkunde/next-kit/scheduler")

/**
 * Starts every job on its schedule, once per process (`next dev` can run
 * instrumentation again after a reload). `cron` is node-cron's default
 * export, passed in so the app owns the dependency.
 */
export function startScheduler(
  jobs: readonly Job[],
  store: JobRunStore,
  cron: CronModule,
): void {
  const holder = globalThis as unknown as Record<
    symbol,
    ReturnType<CronModule["schedule"]>[] | undefined
  >
  if (holder[TASKS]) return

  holder[TASKS] = jobs.map((job) => {
    const task = cron.schedule(
      job.cron,
      async () => {
        await runJob(job, store, new Date())
      },
      {
        name: job.name,
        noOverlap: true,
        ...(job.timezone ? { timezone: job.timezone } : {}),
      },
    )
    task.on("execution:failed", (context) => {
      console.error(`[scheduler] ${job.name} failed`, context.execution?.error)
    })
    return task
  })

  console.log(`[scheduler] Started: ${jobs.map((job) => job.name).join(", ")}`)
}

/** Stops what startScheduler started. */
export async function stopScheduler(): Promise<void> {
  const holder = globalThis as unknown as Record<
    symbol,
    ReturnType<CronModule["schedule"]>[] | undefined
  >
  const tasks = holder[TASKS] ?? []
  holder[TASKS] = undefined
  await Promise.all(tasks.map((task) => task.destroy()))
}
