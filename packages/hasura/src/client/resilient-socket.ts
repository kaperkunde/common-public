import type { Client, Sink, SubscribePayload } from "graphql-ws"

import { browserPage, type PageSignals, type ReturnKind } from "./page"
import {
  isConnectionFailure,
  isNewReturn,
  nextLossStep,
  onReturnStep,
  reconnectPolicy,
  type GiveUpReason,
  type ReconnectPolicy,
  type Round,
  type SocketState,
} from "./reconnect"

/** Where the live connection stands, as a screen would say it. */
export type ReconnectStatus =
  /** Connected, or nothing to connect for. */
  | { kind: "ok" }
  /** Down, and being tried again by itself; subscriptions keep their data meanwhile. */
  | { kind: "reconnecting"; since: number }
  /** Tried and given up: the subscriptions have been told, so the manual screen shows. */
  | { kind: "lost"; reason: GiveUpReason }

export type ResilientSocketOptions = {
  /**
   * The graphql-ws client underneath. Make it with `retryAttempts: 0`: the
   * tries are this wrapper's, so they wait while the page is hidden.
   */
  client: Client
  /**
   * Run before each try (a fresh token, usually). `cause` is what closed the
   * socket. A throw, or taking longer than the round has left, gives up.
   */
  prepare?: (cause: unknown) => Promise<void> | void
  policy?: Partial<ReconnectPolicy>
  page?: PageSignals
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export type ResilientSocket = Client & {
  status: () => ReconnectStatus
  /** Be told when the status changes. Returns the way to stop. */
  onStatus: (listener: (status: ReconnectStatus) => void) => () => void
  /** What the socket underneath is doing, and when it last said anything. */
  socketState: () => { state: SocketState; lastActivityAt: number }
}

type Entry = {
  payload: SubscribePayload
  sink: Sink<unknown>
  stop?: () => void
  parked: boolean
  done: boolean
}

/**
 * A graphql-ws client whose subscriptions survive the socket dropping.
 *
 * A subscription whose socket closes is parked instead of failed, so Apollo
 * keeps its data and nothing on screen flashes empty or unmounts (a playing
 * deck keeps playing). Parked subscriptions are subscribed again on the same
 * client once the page is visible, by the rules in `./reconnect`; only when a
 * round gives up are they failed, which is what draws the manual screen. A
 * return to the page after a long silence reconnects an open socket that may
 * be dead without knowing it. Errors that are about the subscription itself
 * (GraphQL errors) pass straight through.
 */
export const createResilientSocket = (
  options: ResilientSocketOptions,
): ResilientSocket => {
  const inner = options.client
  const policy = reconnectPolicy(options.policy)
  const page = options.page ?? browserPage()
  const now = options.now ?? Date.now
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer =
    options.clearTimer ??
    ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))

  const entries = new Set<Entry>()
  const listeners = new Set<(status: ReconnectStatus) => void>()
  let status: ReconnectStatus = { kind: "ok" }
  let socket: SocketState = "idle"
  let lastActivityAt = now()
  let round: Round | null = null
  let cause: unknown
  let stepTimer: unknown
  let deadline: unknown
  let preparing = false
  let waiting = false
  let lastReturnAt: number | null = null
  let disposed = false

  const setStatus = (next: ReconnectStatus) => {
    if (next.kind === status.kind) return
    status = next
    listeners.forEach((listener) => listener(next))
  }

  const clear = (handle: unknown) => {
    if (handle !== undefined) clearTimer(handle)
  }

  const endRound = () => {
    clear(stepTimer)
    clear(deadline)
    stepTimer = undefined
    deadline = undefined
    round = null
    waiting = false
  }

  const finish = (entry: Entry) => {
    entry.done = true
    entries.delete(entry)
  }

  const start = (entry: Entry) => {
    entry.parked = false
    entry.stop = inner.subscribe(entry.payload, {
      next: (value) => {
        if (!entry.done) entry.sink.next(value)
      },
      complete: () => {
        if (entry.done || entry.parked) return
        finish(entry)
        entry.sink.complete()
      },
      error: (error) => {
        if (entry.done) return
        if (disposed || !isConnectionFailure(error)) {
          finish(entry)
          entry.sink.error(error)
          return
        }
        entry.parked = true
        cause = error
        noticeLoss()
      },
    })
  }

  const giveUp = (reason: GiveUpReason) => {
    endRound()
    const failed = [...entries]
    setStatus({ kind: "lost", reason })
    // A connect that hangs would otherwise keep its subscriptions waiting.
    failed.forEach((entry) => {
      finish(entry)
      entry.stop?.()
      entry.sink.error(
        cause ?? { code: 1006, reason: `Connection lost (${reason})` },
      )
    })
  }

  const tryAgain = async () => {
    stepTimer = undefined
    if (disposed || !round) return
    round.attempts += 1
    const parked = [...entries].filter((entry) => entry.parked)
    if (parked.length === 0) {
      endRound()
      setStatus({ kind: "ok" })
      return
    }
    if (options.prepare) {
      preparing = true
      const left = Math.max(0, policy.budgetMs - (now() - round.startedAt))
      let timer: unknown
      const outcome = await Promise.race([
        Promise.resolve()
          .then(() => options.prepare?.(cause))
          .then(
            () => "ready" as const,
            () => "refused" as const,
          ),
        new Promise<"late">((resolve) => {
          timer = setTimer(() => resolve("late"), left)
        }),
      ])
      clear(timer)
      preparing = false
      if (disposed || !round) return
      if (outcome !== "ready") {
        // Hidden meanwhile: a token fetch that stalled in a pocket is not a refusal.
        if (!page.state().visible) return step()
        return giveUp(outcome === "late" ? "budget" : "refused")
      }
    }
    for (const entry of entries) if (entry.parked) start(entry)
  }

  const step = () => {
    if (disposed || preparing || stepTimer !== undefined) return
    const decision = nextLossStep({
      round,
      page: page.state(),
      now: now(),
      policy,
    })
    if (decision.kind === "wait") {
      // A round that started visible starts again, whole, when the page is back.
      endRound()
      waiting = true
      setStatus({ kind: "reconnecting", since: now() })
      return
    }
    if (decision.kind === "give-up") return giveUp(decision.reason)
    if (!round) {
      round = { startedAt: now(), attempts: 0 }
      waiting = false
      setStatus({ kind: "reconnecting", since: round.startedAt })
      deadline = setTimer(onDeadline, policy.budgetMs)
    }
    stepTimer = setTimer(() => void tryAgain(), decision.delayMs)
  }

  const onDeadline = () => {
    deadline = undefined
    if (disposed || !round || status.kind !== "reconnecting") return
    if (!page.state().visible) {
      // A connect hanging in the background is let go of; the subscriptions
      // park, and the page coming back starts a whole round.
      endRound()
      waiting = true
      inner.terminate()
      return
    }
    giveUp("budget")
  }

  const noticeLoss = () => {
    socket = "closed"
    step()
  }

  const offInner = [
    inner.on("connecting", () => {
      socket = "connecting"
    }),
    inner.on("connected", () => {
      socket = "open"
      lastActivityAt = now()
      if (![...entries].some((entry) => entry.parked)) {
        endRound()
        setStatus({ kind: "ok" })
      }
    }),
    inner.on("message", () => {
      lastActivityAt = now()
    }),
    inner.on("closed", () => {
      socket = "closed"
    }),
  ]

  const onPage = (kind: ReturnKind | "hidden") => {
    if (disposed || kind === "hidden") return
    const at = now()
    if (!isNewReturn(lastReturnAt, at, policy)) return
    lastReturnAt = at
    if (waiting || (status.kind === "reconnecting" && !round)) {
      waiting = false
      return step()
    }
    const decision = onReturnStep({
      page: page.state(),
      socket,
      lastActivityAt,
      now: at,
      policy,
    })
    // Possibly dead without knowing it: close it and let the round bring it back.
    if (decision === "reconnect") inner.terminate()
  }
  const offPage = page.watch(onPage)

  return {
    on: inner.on,
    subscribe: (payload, sink) => {
      const entry: Entry = {
        payload,
        sink: sink as Sink<unknown>,
        parked: false,
        done: false,
      }
      entries.add(entry)
      if (status.kind === "lost") setStatus({ kind: "ok" })
      if (round || waiting) {
        // Joins the round: subscribed with the others when it next tries.
        entry.parked = true
      } else {
        start(entry)
      }
      return () => {
        if (entry.done) return
        finish(entry)
        entry.stop?.()
      }
    },
    iterate: (payload) => inner.iterate(payload),
    terminate: () => inner.terminate(),
    dispose: () => {
      disposed = true
      endRound()
      offPage()
      offInner.forEach((off) => off())
      listeners.clear()
      return inner.dispose()
    },
    status: () => status,
    onStatus: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    socketState: () => ({ state: socket, lastActivityAt }),
  }
}
