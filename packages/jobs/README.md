# @kaperkunde/jobs

A small job queue for apps on Hasura + Postgres: **one pending row per scope**,
an idempotent upsert enqueue, a lease-based claim with heartbeat, reclaim of
passes whose process died, and a sweep. It is a `kk-hasura` migration template
plus a TypeScript runner. A scope is whatever you need looked at one pass at a
time (a room, an account, a document); the package knows nothing about it.

No brakes, budgets or domain concepts live here: pausing a scope, stopping it
after a failure and telling its owner are yours, through `settle`.

## 1. Add the database objects

```json
// kaperkunde.json
{
  "packages": {
    "@kaperkunde/jobs": {
      "vars": { "prefix": "app_", "server_role": "server" }
    }
  }
}
```

```bash
npx kk-hasura sync      # renders migration 1789500000000_jobs_queue and the Hasura metadata
```

Variables (all have defaults): `prefix` (default empty), `jobs_table` (`jobs`),
`scope_column` (`scope_id`), `scope_type` (`text`), `server_role` (`server`),
`schema` (`public`). With the defaults you get table `jobs` and functions
`jobs_enqueue`, `jobs_claim`, `jobs_heartbeat`, `jobs_finish`,
`jobs_mark_attempt`, `jobs_reclaim`, `jobs_sweep`. Every function refuses any
role but `server_role` itself (read from `hasura.user`), and the metadata grants
it to that role alone.

Columns: `id`, `<scope_column>`, `status` (`pending | running | done | failed |
paused`), `source`, `reason`, `attempts`, `run_after`, `claimed_at`,
`leased_until`, `finished_at`, `wrote`, `outcome`, `attempt`, `payload jsonb`,
`created_at`.

## 2. Use it from TypeScript

```ts
import {
  createJobs,
  createJobRunner,
  graphqlTransport,
  reclaimedRepeatedly,
} from "@kaperkunde/jobs"
import { createServerClient } from "@kaperkunde/hasura/server"

const hasura = createServerClient({ endpoint, adminSecret, role: "server" })
export const jobs = createJobs({
  transport: graphqlTransport({ execute: hasura.execute }), // or sqlTransport({ sql })
})

// Ask for a scope to be looked at (from a webhook, a write, the sweep).
await jobs.enqueue({
  scope: roomId,
  source: "person",
  reason: "someone spoke",
  payload: { characterId },
})

export const runner = createJobRunner<{ characterId: string }>({
  jobs,
  concurrency: 3,
  leaseSeconds: 120,
  passTimeoutSeconds: 300,
  handler: async (job, { signal, markAttempt }) => {
    await markAttempt(`turn:${job.payload?.characterId}`)
    await doTheWork(job.scope, { signal }) // aborted on timeout or when the job is taken back
    return { status: "done", wrote: true, outcome: "took a turn" }
  },
  // optional policy around finishing: stop the scope on a fatal failure, tell someone
  settle: async (job, result, finish) => {
    if (result.status === "failed" && isFatal(result.outcome))
      await stopScope(job.scope)
    await finish()
  },
})

// In the route Hasura's event trigger posts to: answer promptly, work in the background.
runner.kick()

// In the route Hasura's cron trigger posts to (every minute):
for (const dead of await runner.tick()) {
  if (reclaimedRepeatedly(dead)) await stopScope(dead.scope) // the scope was not asked for again
}
```

| Export                                                                            | What it gives                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createJobs({ transport, log? })`                                                 | `enqueue`, `claim`, `heartbeat`, `finish` (3 tries), `markAttempt`, `reclaim`, `sweep`, returning camelCase `Job`s.                                                                                                   |
| `graphqlTransport({ execute, prefix?, table?, scopeColumn?, scopeGraphqlType? })` | The queue over Hasura GraphQL; `execute(query, variables) => data` (`ServerClient.execute` fits). Pass the same `prefix`, `table` and `scopeColumn` you rendered with.                                                |
| `sqlTransport({ sql, schema?, serverRole?, prefix?, table?, scopeColumn? })`      | The queue over plain SQL: `sql.transaction(run)` where `run(query)` takes `(text, params)`; each call sets `hasura.user` to the server role first.                                                                    |
| `createJobRunner(options)`                                                        | `drain()` (claim and work until nothing is due), `kick()` (the same without waiting), `tick()` (reclaim, sweep, drain; answers the reclaimed jobs), `busy()`. State is per runner: keep one (on `globalThis` in dev). |
| `runJobs(options)`                                                                | One `drain` with a throwaway runner.                                                                                                                                                                                  |
| `reclaimedRepeatedly(job)`                                                        | True for a job `reclaim` failed for the second time running; the scope was not asked for again.                                                                                                                       |

Behaviour worth knowing:

- Enqueue upserts: asks before a pass are one job. Earliest `run_after`, newest
  `reason`/`source`, newest non-null `payload` win. `delaySeconds` delays it.
- A scope has at most one running job whose lease is live; others wait.
- The handler's `signal` aborts on `passTimeoutSeconds` or when a heartbeat
  finds the job no longer running. A pass that returns only because it was
  stopped is failed; a job taken back is left as whoever took it back left it.
- `reclaim` asks for a dead job's scope again (with its payload), except when
  the same `attempt` was reclaimed before, or within `repeatWindowSeconds`
  (900): then the job's outcome says "the second time running".
- Throwing from the handler fails the job with the error's message.
