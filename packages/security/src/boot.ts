/**
 * What an app checks before it serves anything: secrets that are unset,
 * still the example placeholder or too short, documents missing from the
 * image, a schema behind the build. In production a problem refuses the
 * start; in development it is a warning, so a laptop without everything set
 * still runs.
 */

export type BootCheck = () => Promise<string | null> | string | null

/** What is wrong with one secret, or null. */
export function secretProblem(
  name: string,
  value: string | null | undefined,
  {
    placeholders = [],
    minLength = 32,
  }: { placeholders?: readonly string[]; minLength?: number } = {},
): string | null {
  const trimmed = value?.trim() ?? ""
  if (!trimmed) return `${name} is not set`
  if (placeholders.includes(trimmed))
    return `${name} is still the .env.example placeholder`
  if (trimmed.length < minLength)
    return `${name} is shorter than ${minLength} characters`
  return null
}

export class BootRefusedError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Refusing to start: ${problems.join("; ")}`)
    this.name = "BootRefusedError"
  }
}

/**
 * Runs every check (a check that throws counts as a problem) and, in
 * production, throws BootRefusedError naming them all; elsewhere it warns.
 * Returns the problems either way.
 */
export async function runBootChecks(
  checks: readonly BootCheck[],
  {
    production = process.env.NODE_ENV === "production",
    warn = (message: string) => console.warn(message),
  }: { production?: boolean; warn?: (message: string) => void } = {},
): Promise<string[]> {
  const problems: string[] = []

  for (const check of checks) {
    try {
      const problem = await check()
      if (problem) problems.push(problem)
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error))
    }
  }

  if (problems.length > 0) {
    if (production) throw new BootRefusedError(problems)
    warn(`Not ready for production: ${problems.join("; ")}`)
  }

  return problems
}
