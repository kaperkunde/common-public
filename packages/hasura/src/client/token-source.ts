/** Reads `exp` (seconds since the epoch) out of a JWT; null if it cannot. */
const expiryOf = (token: string): number | null => {
  const part = token.split(".")[1]
  if (!part) return null
  try {
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/")
    const payload: unknown = JSON.parse(atob(base64))
    const exp =
      payload && typeof payload === "object"
        ? (payload as { exp?: unknown }).exp
        : undefined
    return typeof exp === "number" ? exp : null
  } catch {
    return null
  }
}

export type TokenSourceOptions = {
  /** Fetches a fresh token (the session's, usually). Called again before the last one expires. */
  getToken: () => Promise<string> | string
  /** How long before `exp` a new token is fetched. Default 60 seconds. */
  refreshBeforeMs?: number
  /** Called when a refresh produced a different token (the socket reconnects with it). */
  onChange?: (token: string) => void
  /** Called when a scheduled refresh failed; the old token stays until it expires. */
  onError?: (error: unknown) => void
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export type TokenSource = {
  /** The current token, fetching if none is held or it is about to expire. */
  get: () => Promise<string>
  /** The last token fetched, without fetching. */
  peek: () => string | undefined
  /** Replaces the held token (a session handed a new one) and reschedules. */
  set: (token: string) => void
  /** Stops the timer. */
  dispose: () => void
}

/**
 * Holds the token a connection uses and replaces it before it expires:
 * a timer fires `refreshBeforeMs` ahead of `exp`, asks `getToken`, and
 * announces a changed token so a live socket can reconnect with it.
 */
export const createTokenSource = (options: TokenSourceOptions): TokenSource => {
  const refreshBefore = options.refreshBeforeMs ?? 60_000
  const now = options.now ?? Date.now
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer =
    options.clearTimer ??
    ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  let token: string | undefined
  let expiresAt: number | null = null
  let timer: unknown
  let disposed = false
  let inflight: Promise<string> | undefined

  const schedule = () => {
    if (timer !== undefined) clearTimer(timer)
    timer = undefined
    if (disposed || expiresAt === null) return
    const wait = Math.max(0, expiresAt * 1000 - refreshBefore - now())
    timer = setTimer(() => {
      timer = undefined
      refresh().catch((error) => options.onError?.(error))
    }, wait)
  }

  const adopt = (next: string) => {
    const changed = next !== token
    token = next
    expiresAt = expiryOf(next)
    schedule()
    return changed
  }

  const refresh = async (): Promise<string> => {
    if (inflight) return inflight
    inflight = (async () => {
      try {
        const next = await options.getToken()
        if (adopt(next)) options.onChange?.(next)
        return next
      } finally {
        inflight = undefined
      }
    })()
    return inflight
  }

  const stale = () =>
    expiresAt !== null && now() >= expiresAt * 1000 - refreshBefore

  return {
    get: async () => (token === undefined || stale() ? refresh() : token),
    peek: () => token,
    set: (next) => {
      if (adopt(next)) options.onChange?.(next)
    },
    dispose: () => {
      disposed = true
      if (timer !== undefined) clearTimer(timer)
      timer = undefined
    },
  }
}
