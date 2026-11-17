import { describe, expect, it } from "vitest"

import {
  DEFAULT_RECONNECT_POLICY,
  isAuthClose,
  isConnectionFailure,
  isNewReturn,
  nextLossStep,
  onReturnStep,
} from "./reconnect"

const shown = { visible: true, online: true }
const hidden = { visible: false, online: true }

describe("nextLossStep", () => {
  it("tries at once when the page is shown and no round has started", () => {
    expect(nextLossStep({ round: null, page: shown, now: 0 })).toEqual({
      kind: "retry",
      delayMs: 0,
    })
  })

  it("waits, spending nothing, while the page is hidden", () => {
    expect(nextLossStep({ round: null, page: hidden, now: 0 })).toEqual({
      kind: "wait",
    })
    // even a round that had run out does not give up in the background
    expect(
      nextLossStep({
        round: { startedAt: 0, attempts: 99 },
        page: hidden,
        now: 60_000,
      }),
    ).toEqual({ kind: "wait" })
    expect(
      nextLossStep({
        round: null,
        page: { visible: false, online: false },
        now: 0,
      }),
    ).toEqual({ kind: "wait" })
  })

  it("backs off between tries", () => {
    const delays = [0, 1, 2, 3, 4].map((attempts) => {
      const step = nextLossStep({
        round: { startedAt: 0, attempts },
        page: shown,
        now: 0,
      })
      return step.kind === "retry" ? step.delayMs : step.kind
    })
    expect(delays).toEqual([0, 1_000, 2_000, 4_000, 6_000])
  })

  it("gives up once the round's tries are spent", () => {
    expect(
      nextLossStep({
        round: { startedAt: 0, attempts: DEFAULT_RECONNECT_POLICY.maxAttempts },
        page: shown,
        now: 1_000,
      }),
    ).toEqual({ kind: "give-up", reason: "attempts" })
  })

  it("gives up once the round's time is spent", () => {
    expect(
      nextLossStep({
        round: { startedAt: 0, attempts: 2 },
        page: shown,
        now: 13_500,
      }),
    ).toEqual({ kind: "give-up", reason: "budget" })
  })

  it("gives up at once on a shown page that is offline", () => {
    expect(
      nextLossStep({
        round: null,
        page: { visible: true, online: false },
        now: 0,
      }),
    ).toEqual({ kind: "give-up", reason: "offline" })
  })

  it("gives up when the token could not be had", () => {
    expect(
      nextLossStep({ round: null, page: shown, now: 0, refused: true }),
    ).toEqual({ kind: "give-up", reason: "refused" })
  })
})

describe("onReturnStep", () => {
  const base = { page: shown, socket: "open" as const, now: 100_000 }

  it("reconnects an open socket that has said nothing for a long time", () => {
    expect(onReturnStep({ ...base, lastActivityAt: 0 })).toBe("reconnect")
  })

  it("leaves a socket that has been talking", () => {
    expect(onReturnStep({ ...base, lastActivityAt: 90_000 })).toBe("nothing")
  })

  it("leaves a socket that is not open (a round has it) and a hidden page", () => {
    expect(onReturnStep({ ...base, socket: "closed", lastActivityAt: 0 })).toBe(
      "nothing",
    )
    expect(onReturnStep({ ...base, socket: "idle", lastActivityAt: 0 })).toBe(
      "nothing",
    )
    expect(onReturnStep({ ...base, page: hidden, lastActivityAt: 0 })).toBe(
      "nothing",
    )
  })
})

describe("isNewReturn", () => {
  it("takes events that arrive together as one return", () => {
    expect(isNewReturn(null, 5)).toBe(true)
    expect(isNewReturn(1_000, 1_400)).toBe(false)
    expect(isNewReturn(1_000, 2_000)).toBe(true)
  })
})

describe("isAuthClose", () => {
  it("knows Hasura's refusals of a token", () => {
    expect(isAuthClose({ code: 4400, reason: "Bad request" })).toBe(true)
    expect(isAuthClose({ code: 4403, reason: "Forbidden" })).toBe(true)
    expect(
      isAuthClose({ code: 4500, reason: "Could not verify JWT: JWTExpired" }),
    ).toBe(true)
  })

  it("does not take a dropped connection for one", () => {
    expect(isAuthClose({ code: 1006, reason: "" })).toBe(false)
    expect(isAuthClose({ code: 4499, reason: "Terminated" })).toBe(false)
    expect(isAuthClose(undefined)).toBe(false)
  })
})

describe("isConnectionFailure", () => {
  it("parks a close and passes GraphQL errors on", () => {
    expect(isConnectionFailure({ code: 1006, reason: "" })).toBe(true)
    expect(isConnectionFailure(new Error("socket"))).toBe(true)
    expect(isConnectionFailure([{ message: "no such field" }])).toBe(false)
  })
})
