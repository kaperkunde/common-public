/**
 * A fixed-window counter in this process's memory. Enough to blunt password
 * guessing and runaway clients on one instance; not shared between replicas
 * and reset on restart.
 *
 * The store lives on globalThis, because Next bundles a module once per
 * runtime and route and a plain module-level Map would be several maps. It
 * holds at most MAX_ENTRIES windows, since keys come from values a caller can
 * make up (a forged address): past that the window touched longest ago is
 * dropped, which only gives that one key a fresh count. Keys ending in ":*"
 * are instance-wide caps and are never the one dropped.
 */

type Window = { count: number; expiresAt: number }

const MAX_ENTRIES = 10_000
const PRUNE_INTERVAL_MS = 60_000
const STORE = Symbol.for("@kaperkunde/security/rate-limit")

type Store = { windows: Map<string, Window>; lastPruned: number }

function store(): Store {
  const holder = globalThis as unknown as Record<symbol, Store | undefined>
  holder[STORE] ??= { windows: new Map(), lastPruned: 0 }
  return holder[STORE]
}

export type RateLimit = { max: number; windowMs: number }

export type RateLimitResult = {
  allowed: boolean
  /** How long until the window ends; 0 when allowed. */
  retryAfterMs: number
}

function prune(s: Store, now: number) {
  if (now - s.lastPruned < PRUNE_INTERVAL_MS) return
  s.lastPruned = now
  for (const [key, w] of s.windows)
    if (now >= w.expiresAt) s.windows.delete(key)
}

function evictOne(windows: Map<string, Window>) {
  for (const key of windows.keys()) {
    if (key.endsWith(":*")) continue
    windows.delete(key)
    return
  }
}

/** Counts one attempt under `key`; refused once `max` have been counted in the window. */
export function checkRateLimit(
  key: string,
  { max, windowMs }: RateLimit,
  now: number = Date.now(),
): RateLimitResult {
  const s = store()
  prune(s, now)
  const entry = s.windows.get(key)

  if (!entry || now >= entry.expiresAt) {
    s.windows.delete(key)
    if (s.windows.size >= MAX_ENTRIES) evictOne(s.windows)
    s.windows.set(key, { count: 1, expiresAt: now + windowMs })
    return { allowed: true, retryAfterMs: 0 }
  }

  // Re-inserted so the Map's order is the order of last use.
  s.windows.delete(key)
  s.windows.set(key, entry)

  if (entry.count >= max) {
    return { allowed: false, retryAfterMs: entry.expiresAt - now }
  }

  entry.count++
  return { allowed: true, retryAfterMs: 0 }
}

/**
 * Gives back one count taken in the current window, for an attempt that
 * turned out not to be one the limit is for (a right password is not a
 * guess). Never below zero, and nothing for a window already gone.
 */
export function refundRateLimit(key: string, now: number = Date.now()): void {
  const entry = store().windows.get(key)
  if (entry && now < entry.expiresAt && entry.count > 0) entry.count--
}

/** Tests: how many windows are held. */
export function rateLimitSize(): number {
  return store().windows.size
}

/** Tests: forget every window. */
export function resetRateLimits(): void {
  store().windows.clear()
}
