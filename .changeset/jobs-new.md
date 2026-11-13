---
"@kaperkunde/jobs": minor
---

New package: a job queue (one pending row per scope, upsert enqueue, lease claim and heartbeat, reclaim, sweep) shipped as a `kk-hasura` migration template, plus `createJobs`, GraphQL and SQL transports and `createJobRunner` with an abort signal per pass.
