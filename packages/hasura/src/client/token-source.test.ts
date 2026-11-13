import { describe, expect, it, vi } from "vitest"

import { createTokenSource } from "./token-source"

const jwt = (exp: number) =>
  `h.${btoa(JSON.stringify({ exp })).replace(/=+$/, "")}.s`

const harness = (tokens: string[], start = 0) => {
  let now = start
  const timers: { fn: () => void; at: number; id: number }[] = []
  let next = 0
  const getToken = vi.fn(async () => tokens.shift() ?? "last")
  const onChange = vi.fn()
  const onError = vi.fn()
  const source = createTokenSource({
    getToken,
    onChange,
    onError,
    refreshBeforeMs: 10_000,
    now: () => now,
    setTimer: (fn, ms) => {
      const id = ++next
      timers.push({ fn, at: now + ms, id })
      return id
    },
    clearTimer: (id) => {
      const at = timers.findIndex((t) => t.id === id)
      if (at >= 0) timers.splice(at, 1)
    },
  })
  return {
    source,
    getToken,
    onChange,
    onError,
    timers,
    advance: (ms: number) => {
      now += ms
    },
  }
}

describe("createTokenSource", () => {
  it("fetches once and reuses a token that has time left", async () => {
    const h = harness([jwt(1000)])
    expect(await h.source.get()).toBe(jwt(1000))
    expect(await h.source.get()).toBe(jwt(1000))
    expect(h.getToken).toHaveBeenCalledTimes(1)
    expect(h.source.peek()).toBe(jwt(1000))
  })

  it("shares one fetch between simultaneous callers", async () => {
    const h = harness([jwt(1000)])
    await Promise.all([h.source.get(), h.source.get()])
    expect(h.getToken).toHaveBeenCalledTimes(1)
  })

  it("schedules a refresh before expiry and announces the new token", async () => {
    const h = harness([jwt(100), jwt(200)])
    await h.source.get()
    expect(h.timers).toHaveLength(1)
    expect(h.timers[0]!.at).toBe(90_000)
    h.advance(90_000)
    h.timers[0]!.fn()
    await vi.waitFor(() => expect(h.onChange).toHaveBeenCalledTimes(2))
    expect(h.source.peek()).toBe(jwt(200))
  })

  it("fetches again on get once inside the refresh margin", async () => {
    const h = harness([jwt(100), jwt(300)])
    await h.source.get()
    h.advance(95_000)
    expect(await h.source.get()).toBe(jwt(300))
  })

  it("does not announce an unchanged token", async () => {
    const h = harness([jwt(100), jwt(100)])
    await h.source.get()
    h.advance(95_000)
    await h.source.get()
    expect(h.onChange).toHaveBeenCalledTimes(1)
  })

  it("reports a failed scheduled refresh and keeps the old token", async () => {
    const h = harness([jwt(100)])
    await h.source.get()
    h.getToken.mockRejectedValueOnce(new Error("offline"))
    h.timers[0]!.fn()
    await vi.waitFor(() => expect(h.onError).toHaveBeenCalled())
    expect(h.source.peek()).toBe(jwt(100))
  })

  it("takes a token handed in with set and reschedules", () => {
    const h = harness([])
    h.source.set(jwt(500))
    expect(h.onChange).toHaveBeenCalledWith(jwt(500))
    expect(h.timers).toHaveLength(1)
    h.source.set(jwt(600))
    expect(h.timers).toHaveLength(1)
    expect(h.timers[0]!.at).toBe(590_000)
  })

  it("does not schedule for a token without exp, and dispose stops the timer", async () => {
    const h = harness(["opaque"])
    await h.source.get()
    expect(h.timers).toHaveLength(0)
    const g = harness([jwt(100)])
    await g.source.get()
    g.source.dispose()
    expect(g.timers).toHaveLength(0)
  })
})
