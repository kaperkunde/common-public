import type { Client, Sink } from "graphql-ws"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { PageSignals, ReturnKind } from "./page"
import { createResilientSocket } from "./resilient-socket"

/** A graphql-ws client that connects when told to and drops when told to. */
const fakeClient = () => {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  const subs = new Set<Sink<unknown>>()
  const emit = (event: string, ...args: unknown[]) =>
    listeners.get(event)?.forEach((listener) => listener(...args))
  let subscribes = 0
  let refusing = false
  const client = {
    on: (event: string, listener: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(listener)
      return () => listeners.get(event)!.delete(listener)
    },
    subscribe: (_payload: unknown, sink: Sink<unknown>) => {
      subscribes += 1
      if (refusing) {
        // the server is not there: every connect fails at once
        queueMicrotask(() => sink.error({ code: 1006, reason: "" }))
        return () => undefined
      }
      subs.add(sink)
      return () => subs.delete(sink)
    },
    iterate: () => {
      throw new Error("not used")
    },
    terminate: vi.fn(() => drop({ code: 4499, reason: "Terminated" })),
    dispose: vi.fn(),
  }
  const drop = (cause: unknown) => {
    emit("closed", cause)
    const sinks = [...subs]
    subs.clear()
    sinks.forEach((sink) => sink.error(cause))
  }
  return {
    client: client as unknown as Client,
    raw: client,
    connect: () => emit("connected"),
    message: () => emit("message"),
    drop,
    push: (value: unknown) => subs.forEach((sink) => sink.next(value)),
    subscribes: () => subscribes,
    refuse: () => {
      refusing = true
    },
    live: () => subs.size,
  }
}

/** A page the test shows, hides and brings back. */
const fakePage = () => {
  let state = { visible: true, online: true }
  const listeners = new Set<(kind: ReturnKind | "hidden") => void>()
  const signals: PageSignals = {
    state: () => state,
    watch: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return {
    signals,
    hide: () => {
      state = { ...state, visible: false }
      listeners.forEach((l) => l("hidden"))
    },
    show: (kind: ReturnKind = "visible") => {
      state = { ...state, visible: true }
      listeners.forEach((l) => l(kind))
    },
    offline: () => {
      state = { ...state, online: false }
    },
  }
}

const sink = () => ({ next: vi.fn(), error: vi.fn(), complete: vi.fn() })

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

const setUp = (prepare?: (cause: unknown) => Promise<void> | void) => {
  const inner = fakeClient()
  const page = fakePage()
  const socket = createResilientSocket({
    client: inner.client,
    page: page.signals,
    prepare,
  })
  return { inner, page, socket }
}

describe("createResilientSocket", () => {
  it("parks a dropped subscription and brings it back without failing it", async () => {
    const { inner, socket } = setUp()
    const s = sink()
    socket.subscribe({ query: "subscription { a }" }, s)
    inner.connect()
    inner.push({ data: { a: 1 } })

    inner.drop({ code: 1006, reason: "" })
    expect(socket.status().kind).toBe("reconnecting")
    await vi.advanceTimersByTimeAsync(0)
    expect(inner.subscribes()).toBe(2)
    inner.connect()
    inner.push({ data: { a: 2 } })

    expect(s.error).not.toHaveBeenCalled()
    expect(s.next).toHaveBeenCalledTimes(2)
    expect(socket.status().kind).toBe("ok")
  })

  it("tries nothing while the page is hidden, and starts when it is shown", async () => {
    const { inner, page, socket } = setUp()
    const s = sink()
    socket.subscribe({ query: "subscription { a }" }, s)
    inner.connect()

    page.hide()
    inner.drop({ code: 1006, reason: "" })
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(inner.subscribes()).toBe(1)
    expect(s.error).not.toHaveBeenCalled()

    page.show()
    await vi.advanceTimersByTimeAsync(0)
    expect(inner.subscribes()).toBe(2)
    inner.connect()
    expect(socket.status().kind).toBe("ok")
    expect(s.error).not.toHaveBeenCalled()
  })

  it("gives up after a few tries with backoff, and only then fails the subscription", async () => {
    const { inner, socket } = setUp()
    const s = sink()
    socket.subscribe({ query: "subscription { a }" }, s)
    inner.connect()
    inner.refuse()
    inner.drop({ code: 1006, reason: "" })

    await vi.advanceTimersByTimeAsync(5_000)
    expect(s.error).not.toHaveBeenCalled()
    expect(socket.status().kind).toBe("reconnecting")
    await vi.advanceTimersByTimeAsync(15_000)
    // the first subscribe, then five tries at 0, 1, 3, 7 and 13 seconds
    expect(inner.subscribes()).toBe(6)
    expect(s.error).toHaveBeenCalledOnce()
    expect(socket.status()).toEqual({ kind: "lost", reason: "attempts" })
  })

  it("gives up when a connect hangs past the round's time", async () => {
    const { inner, socket } = setUp()
    const s = sink()
    socket.subscribe({ query: "subscription { a }" }, s)
    inner.connect()
    inner.drop({ code: 1006, reason: "" })
    await vi.advanceTimersByTimeAsync(0)
    // resubscribed, and the connect never answers
    await vi.advanceTimersByTimeAsync(15_000)
    expect(s.error).toHaveBeenCalledOnce()
    expect(socket.status()).toEqual({ kind: "lost", reason: "budget" })
  })

  it("does not give up in the background when the round's time runs out there", async () => {
    const { inner, page, socket } = setUp()
    const s = sink()
    socket.subscribe({ query: "subscription { a }" }, s)
    inner.connect()
    inner.drop({ code: 1006, reason: "" })
    await vi.advanceTimersByTimeAsync(0)
    page.hide()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(s.error).not.toHaveBeenCalled()
    page.show()
    await vi.advanceTimersByTimeAsync(0)
    expect(inner.subscribes()).toBe(3)
  })

  it("gives up at once on a shown page that is offline", async () => {
    const { inner, page, socket } = setUp()
    const s = sink()
    socket.subscribe({ query: "subscription { a }" }, s)
    inner.connect()
    page.offline()
    inner.drop({ code: 1006, reason: "" })
    expect(s.error).toHaveBeenCalledOnce()
    expect(socket.status()).toEqual({ kind: "lost", reason: "offline" })
  })

  it("fetches a fresh token first, and gives up when it cannot be had", async () => {
    const prepare = vi.fn(async () => {
      throw new Error("signed out")
    })
    const { inner, socket } = setUp(prepare)
    const s = sink()
    socket.subscribe({ query: "subscription { a }" }, s)
    inner.connect()
    inner.drop({ code: 4400, reason: "JWTExpired" })
    await vi.advanceTimersByTimeAsync(0)
    expect(prepare).toHaveBeenCalledWith({ code: 4400, reason: "JWTExpired" })
    expect(s.error).toHaveBeenCalledOnce()
    expect(socket.status()).toEqual({ kind: "lost", reason: "refused" })
  })

  it("passes a GraphQL error straight on", () => {
    const { inner, socket } = setUp()
    const s = sink()
    socket.subscribe({ query: "subscription { a }" }, s)
    inner.connect()
    // graphql-ws hands a subscription its GraphQL errors as a list
    const errors = [{ message: "field 'a' not found" }]
    inner.drop(errors)
    expect(s.error).toHaveBeenCalledWith(errors)
    expect(socket.status().kind).toBe("ok")
  })

  it("reconnects an open socket that has been silent when the page comes back", async () => {
    const { inner, page, socket } = setUp()
    const s = sink()
    socket.subscribe({ query: "subscription { a }" }, s)
    inner.connect()
    page.hide()
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    page.show("pageshow")
    expect(inner.raw.terminate).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(0)
    expect(inner.subscribes()).toBe(2)
    // the visibilitychange and focus that come with it are the same return
    page.show("focus")
    expect(inner.raw.terminate).toHaveBeenCalledOnce()
    expect(s.error).not.toHaveBeenCalled()
  })

  it("leaves a socket that has been talking alone on return", async () => {
    const { inner, page, socket } = setUp()
    socket.subscribe({ query: "subscription { a }" }, sink())
    inner.connect()
    await vi.advanceTimersByTimeAsync(30_000)
    inner.message()
    await vi.advanceTimersByTimeAsync(20_000)
    page.show("focus")
    expect(inner.raw.terminate).not.toHaveBeenCalled()
  })

  it("lets an unsubscribed parked subscription go", async () => {
    const { inner, page, socket } = setUp()
    const s = sink()
    const stop = socket.subscribe({ query: "subscription { a }" }, s)
    inner.connect()
    page.hide()
    inner.drop({ code: 1006, reason: "" })
    stop()
    page.show()
    await vi.advanceTimersByTimeAsync(0)
    expect(inner.subscribes()).toBe(1)
    expect(socket.status().kind).toBe("ok")
  })
})
