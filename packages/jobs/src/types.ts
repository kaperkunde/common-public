export type JobStatus = "pending" | "running" | "done" | "failed" | "paused"

/** A job row, in camelCase. `scope` is whatever the app keyed the queue by. */
export type Job<P = unknown> = {
  id: string
  scope: string
  status: JobStatus
  /** Who asked, in the app's own words. */
  source: string
  reason: string
  attempts: number
  runAfter: string
  claimedAt: string | null
  leasedUntil: string | null
  finishedAt: string | null
  wrote: boolean
  outcome: string | null
  /** What the pass started on. */
  attempt: string | null
  payload: P | null
  createdAt: string
}

/** What a pass came to. */
export type JobResult = {
  status: "done" | "failed" | "paused"
  /** Whether the pass changed anything. */
  wrote?: boolean
  /** One line about what happened; the whole error for a failure. */
  outcome?: string
  /** What the pass started on, for a reclaim to read. */
  attempt?: string
}

/** The queue's functions by short name, with the arguments they take (snake_case, as in SQL). */
export type QueueCalls = {
  enqueue: {
    job_scope: string
    job_source: string
    job_reason: string
    job_payload: unknown
    delay_seconds: number
  }
  claim: { lease_seconds: number }
  heartbeat: { job_id: string; lease_seconds: number }
  finish: {
    job_id: string
    job_status: string
    job_wrote: boolean
    job_outcome: string
    job_attempt: string | null
  }
  mark_attempt: { job_id: string; job_attempt: string }
  reclaim: { repeat_window_seconds: number }
  sweep: { retention_days: number }
}

/** A raw row as the database or Hasura answers it. */
export type RawJob = Record<string, unknown>

/** How a call reaches the queue's functions: over Hasura GraphQL, or straight SQL. */
export interface Transport {
  call<K extends keyof QueueCalls>(
    fn: K,
    args: QueueCalls[K],
  ): Promise<RawJob[]>
  /** The name of the scope column, to read the scope back out of a row. */
  readonly scopeColumn: string
}
