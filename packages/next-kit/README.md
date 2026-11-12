# @kaperkunde/next-kit

The app patterns every Kaperkunde Next.js app wrote again.

| Import                            | What it gives                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@kaperkunde/next-kit`            | `Result` / `ok` / `fail` / `statusFor` (expected failures are returned, not thrown); `ActionState`, `guarded`, `field`, `fields`, `file`, `textValues` for Server Actions; `OPERATOR` and `siteUrlFrom`; `robotsFor`, `sitemapFor`, `llmsTxt`, `textResponse`; `formatDate`, `timeAgo`; `slugify`, `uniqueSlug`, `plural`, `shortName`; `randomCode`, `normalizeCode` |
| `@kaperkunde/next-kit/local-date` | `<LocalDate>`: UTC on the server, the reader's zone after hydration, no mismatch                                                                                                                                                                                                                                                                                      |
| `@kaperkunde/next-kit/prisma`     | `mariaDbOptions` (from `DATABASE_URL` or `<PREFIX>_*`), `cachedClient`, `getMigrationProblem`, `isUniqueViolation`                                                                                                                                                                                                                                                    |
| `@kaperkunde/next-kit/scheduler`  | `Job`, `runJob` (claimed once per run through the app's own store), `startScheduler` (node-cron passed in), `dailyRunKey`                                                                                                                                                                                                                                             |

```ts
// lib/actions/rename.ts
"use server"
export async function rename(_: ActionState, form: FormData) {
  return guarded(() => renameGuild(field(form, "name")), {
    values: textValues(form),
  })
}
```

## Env and health

```ts
// env.ts: fails at boot naming each bad variable, never its value
import { defineEnv } from "@kaperkunde/next-kit"
import { z } from "zod"
export const env = defineEnv(
  z.object({
    DATABASE_URL: z.string().url(),
    PORT: z.coerce.number().default(3000),
  }),
)

// app/api/health/route.ts: 200 {status:"ok"} or 503 naming the failing checks (never why)
import { healthRoute } from "@kaperkunde/next-kit"
export const dynamic = "force-dynamic"
export const GET = healthRoute({
  checks: { db: () => db.query("select 1") },
  timeoutMs: 3000,
})
```

`defineEnv(schema, source = process.env)` takes any zod object schema (no zod
dependency here) and throws `EnvError` with `problems`. `healthRoute({ checks, timeoutMs })`
runs checks in parallel; a check passes unless it throws, returns `false` or times out.
