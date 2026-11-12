import { describe, expect, it } from "vitest"

import {
  HookPayloadError,
  parseCronTrigger,
  parseEventTrigger,
  verifyHookSecret,
} from "./hooks"

describe("verifyHookSecret", () => {
  it("admits only the exact secret", () => {
    expect(verifyHookSecret("abc", "abc")).toBe(true)
    expect(verifyHookSecret("abd", "abc")).toBe(false)
    expect(verifyHookSecret("ab", "abc")).toBe(false)
  })
  it("admits nothing without a secret or a single header", () => {
    expect(verifyHookSecret("abc", undefined)).toBe(false)
    expect(verifyHookSecret("abc", "")).toBe(false)
    expect(verifyHookSecret(undefined, "abc")).toBe(false)
    expect(verifyHookSecret(["abc"], "abc")).toBe(false)
    expect(verifyHookSecret(null, "abc")).toBe(false)
  })
})

const event = {
  id: "e1",
  created_at: "2026-01-01T00:00:00Z",
  trigger: { name: "t" },
  table: { schema: "public", name: "things" },
  delivery_info: { max_retries: 3, current_retry: 1 },
  event: {
    op: "UPDATE",
    session_variables: { "X-Hasura-Role": "user", "x-hasura-user-id": "u1" },
    data: { old: { id: 1 }, new: { id: 1, a: 2 } },
  },
}

describe("parseEventTrigger", () => {
  it("reads the event", () => {
    expect(parseEventTrigger(event)).toEqual({
      id: "e1",
      trigger: "t",
      table: { schema: "public", name: "things" },
      op: "UPDATE",
      old: { id: 1 },
      new: { id: 1, a: 2 },
      sessionVariables: { "x-hasura-role": "user", "x-hasura-user-id": "u1" },
      createdAt: "2026-01-01T00:00:00Z",
      currentRetry: 1,
      maxRetries: 3,
    })
  })
  it("gives null rows for an insert and defaults for a bare event", () => {
    const parsed = parseEventTrigger({
      ...event,
      delivery_info: undefined,
      event: { op: "INSERT", data: { old: null, new: { id: 2 } } },
    })
    expect(parsed.old).toBeNull()
    expect(parsed.sessionVariables).toEqual({})
    expect(parsed.maxRetries).toBe(0)
  })
  it("refuses what is not an event", () => {
    expect(() => parseEventTrigger(null)).toThrow(HookPayloadError)
    expect(() =>
      parseEventTrigger({ ...event, event: { op: "X", data: {} } }),
    ).toThrow(/operation/)
    expect(() => parseEventTrigger({ ...event, id: 1 })).toThrow(/id/)
    expect(() => parseEventTrigger({ ...event, table: {} })).toThrow(/table/)
  })
})

describe("parseCronTrigger", () => {
  it("reads the cron payload", () => {
    expect(
      parseCronTrigger({
        id: "c",
        name: "sweep",
        scheduled_time: "2026-01-01T00:01:00Z",
        payload: { a: 1 },
        comment: "x",
      }),
    ).toEqual({
      id: "c",
      name: "sweep",
      scheduledTime: "2026-01-01T00:01:00Z",
      payload: { a: 1 },
      comment: "x",
    })
  })
  it("refuses a body without a name or time", () => {
    expect(() => parseCronTrigger({ name: "x" })).toThrow(HookPayloadError)
    expect(() => parseCronTrigger("x")).toThrow(HookPayloadError)
  })
})
