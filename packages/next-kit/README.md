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
