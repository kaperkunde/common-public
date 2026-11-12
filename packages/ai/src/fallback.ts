/**
 * Whether a call that failed on one model is worth asking once more of a
 * fallback model.
 *
 * Worth it when the trouble was the model's or its provider's: a server error,
 * an overloaded or rate-limited provider, a model no longer served, a timeout.
 * Not worth it when the trouble is the caller's: an abort, or a refusal the app
 * raised itself (a balance run out, a pause). An app's own refusal says which
 * it is with a boolean `fallbackWorthy` property (see {@link BackendRefusedError}).
 *
 * Pure, and by name rather than by class, so it reads errors from every module
 * without importing any of them.
 */
type Shaped = {
  name?: unknown
  message?: unknown
  statusCode?: unknown
  isRetryable?: unknown
  fallbackWorthy?: unknown
  lastError?: unknown
}

/** Statuses that say the model is not there, beside the ones a provider calls retryable. */
const UNAVAILABLE = [404, 408, 409, 429, 529]

export const fallbackWorthy = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false
  const shaped = error as Shaped
  if (typeof shaped.fallbackWorthy === "boolean") return shaped.fallbackWorthy
  switch (shaped.name) {
    case "AbortError":
      return false
    case "TimeoutError":
      return true
    case "AI_RetryError":
      return fallbackWorthy(shaped.lastError)
    case "AI_APICallError":
      return (
        shaped.isRetryable === true ||
        (typeof shaped.statusCode === "number" &&
          (shaped.statusCode >= 500 || UNAVAILABLE.includes(shaped.statusCode)))
      )
    default:
      return shaped.name === "TypeError" && shaped.message === "fetch failed"
  }
}
