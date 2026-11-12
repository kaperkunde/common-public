/** The part of a zod (or any Standard-ish) schema `defineEnv` needs: no dependency on zod itself. */
export type EnvSchema<T> = {
  safeParse(input: unknown):
    | { success: true; data: T }
    | {
        success: false
        error: {
          issues: ReadonlyArray<{
            path: ReadonlyArray<PropertyKey>
            message: string
          }>
        }
      }
}

export class EnvError extends Error {
  readonly problems: string[]
  constructor(problems: string[]) {
    super(`Invalid environment:\n${problems.map((p) => `- ${p}`).join("\n")}`)
    this.name = "EnvError"
    this.problems = problems
  }
}

/**
 * Reads and checks the environment once, at boot: the typed result, or an
 * {@link EnvError} naming each variable that is missing or wrong (never its
 * value, since values may be secrets). Hand it a zod object schema:
 *
 *     export const env = defineEnv(z.object({ DATABASE_URL: z.string().url() }))
 *
 * `source` defaults to `process.env`; pass another for tests.
 */
export const defineEnv = <T>(
  schema: EnvSchema<T>,
  source: Record<string, string | undefined> = process.env,
): T => {
  const result = schema.safeParse(source)
  if (result.success) return result.data
  throw new EnvError(
    result.error.issues.map(
      (issue) =>
        `${issue.path.map(String).join(".") || "(environment)"}: ${issue.message}`,
    ),
  )
}
