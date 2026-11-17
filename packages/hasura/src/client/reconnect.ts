/**
 * When a live connection that dropped is tried again by itself, and when the
 * reader is shown the manual screen instead. Pure: every function takes the
 * time and the page's state and returns a decision, so the rules are tested
 * without a socket, a browser or a clock.
 *
 * The shape of it: a socket that drops parks its subscriptions rather than
 * failing them. While the page is hidden nothing is tried (a phone in a
 * pocket, a laptop asleep): the round waits for the page to come back. Once
 * it is visible a round of a few tries with backoff starts, each fetching a
 * fresh token first where the close says the old one was refused. Only when
 * the round runs out (its tries or its time), the device is offline, or the
 * token cannot be had, is the loss passed on and the manual screen drawn.
 */

export type ReconnectPolicy = {
  /** How long one visible round may take before it gives up. */
  budgetMs: number
  /** Tries in one round. */
  maxAttempts: number
  /** Wait before each try, by its index; the last repeats. */
  delaysMs: readonly number[]
  /** Silence on an open socket after which a return checks it by reconnecting. */
  staleAfterMs: number
  /** Return events closer together than this are one return. */
  coalesceMs: number
}

export const DEFAULT_RECONNECT_POLICY: ReconnectPolicy = {
  budgetMs: 15_000,
  maxAttempts: 5,
  delaysMs: [0, 1_000, 2_000, 4_000, 6_000],
  staleAfterMs: 45_000,
  coalesceMs: 1_000,
}

export const reconnectPolicy = (
  overrides?: Partial<ReconnectPolicy>,
): ReconnectPolicy => ({ ...DEFAULT_RECONNECT_POLICY, ...overrides })

export type PageState = {
  /** The document is showing (not a background tab, a locked phone, a closed lid). */
  visible: boolean
  /** `navigator.onLine`, which only ever means "certainly offline" when false. */
  online: boolean
}

/** A round of tries, started the first time the page was visible with a loss. */
export type Round = { startedAt: number; attempts: number }

export type GiveUpReason = "offline" | "attempts" | "budget" | "refused"

export type LossStep =
  /** Hidden: try nothing until the page is visible again, then start afresh. */
  | { kind: "wait" }
  | { kind: "retry"; delayMs: number }
  | { kind: "give-up"; reason: GiveUpReason }

const delayFor = (attempt: number, policy: ReconnectPolicy) =>
  policy.delaysMs.length === 0
    ? 0
    : policy.delaysMs[Math.min(attempt, policy.delaysMs.length - 1)]!

/**
 * What to do with a connection that is down. `round` is null before the
 * first try of a round; `refused` is true once the token could not be had.
 */
export const nextLossStep = (input: {
  round: Round | null
  page: PageState
  now: number
  refused?: boolean
  policy?: ReconnectPolicy
}): LossStep => {
  const policy = input.policy ?? DEFAULT_RECONNECT_POLICY
  if (input.refused) return { kind: "give-up", reason: "refused" }
  if (!input.page.visible) return { kind: "wait" }
  if (!input.page.online) return { kind: "give-up", reason: "offline" }
  const round = input.round
  if (!round) return { kind: "retry", delayMs: delayFor(0, policy) }
  if (round.attempts >= policy.maxAttempts)
    return { kind: "give-up", reason: "attempts" }
  const elapsed = input.now - round.startedAt
  const delayMs = delayFor(round.attempts, policy)
  if (elapsed + delayMs >= policy.budgetMs)
    return { kind: "give-up", reason: "budget" }
  return { kind: "retry", delayMs }
}

export type SocketState = "idle" | "connecting" | "open" | "closed"

/**
 * What a return to the page (visible again, restored from the back-forward
 * cache, back online, focused) asks of a socket. An open socket that has
 * heard nothing for `staleAfterMs` may be dead without knowing it (a phone's
 * radio was off, a laptop slept): it is reconnected, which resubscribes
 * everything quietly. A socket that is down is already in a round, which the
 * return resumes by itself.
 */
export const onReturnStep = (input: {
  page: PageState
  socket: SocketState
  lastActivityAt: number
  now: number
  policy?: ReconnectPolicy
}): "nothing" | "reconnect" => {
  const policy = input.policy ?? DEFAULT_RECONNECT_POLICY
  if (!input.page.visible || !input.page.online) return "nothing"
  if (input.socket !== "open") return "nothing"
  return input.now - input.lastActivityAt >= policy.staleAfterMs
    ? "reconnect"
    : "nothing"
}

/** Whether a return event is a new return or the same one again (visibility, focus and pageshow arrive together). */
export const isNewReturn = (
  lastHandledAt: number | null,
  now: number,
  policy: ReconnectPolicy = DEFAULT_RECONNECT_POLICY,
): boolean => lastHandledAt === null || now - lastHandledAt >= policy.coalesceMs

/**
 * Whether a close says the token was refused, so the next try needs a fresh
 * one rather than the same again. Hasura closes with 4400 or 4403 and words
 * naming the JWT when a token has expired.
 */
export const isAuthClose = (cause: unknown): boolean => {
  if (!cause || typeof cause !== "object") return false
  const { code, reason, message } = cause as {
    code?: unknown
    reason?: unknown
    message?: unknown
  }
  if (code === 4400 || code === 4401 || code === 4403) return true
  const words = [reason, message]
    .filter((w): w is string => typeof w === "string")
    .join(" ")
  return /jwt|token|unauthori[sz]ed|forbidden|expired/i.test(words)
}

/**
 * Whether a subscription's error is the connection going away (parked and
 * tried again) rather than an answer about the subscription itself (passed on
 * at once). graphql-ws hands a subscription a list of GraphQL errors for the
 * latter and a close event, an error event or an `Error` for the former.
 */
export const isConnectionFailure = (error: unknown): boolean =>
  !Array.isArray(error)
