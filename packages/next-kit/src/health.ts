export type HealthCheck = () => Promise<unknown> | unknown

export type HealthRouteOptions = {
  /**
   * Named checks. One passes if it resolves without throwing and without
   * returning `false`. They run in parallel.
   */
  checks?: Record<string, HealthCheck>
  /** How long one check may take before it counts as failed. Default 5000 ms. */
  timeoutMs?: number
}

export type HealthBody = {
  status: "ok" | "failing"
  checks: Record<string, "ok" | "failed">
}

const withTimeout = async (run: HealthCheck, ms: number): Promise<boolean> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      Promise.resolve().then(run),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), ms)
      }),
    ])
    return result !== false
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/**
 * A route handler for a health endpoint: `export const GET = healthRoute({ checks })`
 * in an app-router `route.ts`. 200 with `{ status: "ok" }` when every check
 * passes, 503 with `{ status: "failing" }` and which ones failed otherwise. The
 * body names checks, never errors: a health endpoint is public.
 */
export const healthRoute = (options: HealthRouteOptions = {}) => {
  const timeoutMs = options.timeoutMs ?? 5000
  return async (): Promise<Response> => {
    const entries = Object.entries(options.checks ?? {})
    const outcomes = await Promise.all(
      entries.map(
        async ([name, run]) =>
          [name, await withTimeout(run, timeoutMs)] as const,
      ),
    )
    const checks = Object.fromEntries(
      outcomes.map(([name, passed]) => [name, passed ? "ok" : "failed"]),
    ) as HealthBody["checks"]
    const healthy = outcomes.every(([, passed]) => passed)
    const body: HealthBody = { status: healthy ? "ok" : "failing", checks }
    return new Response(JSON.stringify(body), {
      status: healthy ? 200 : 503,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    })
  }
}
