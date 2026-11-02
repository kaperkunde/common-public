import { describe, expect, it } from "vitest"
import { z } from "zod"

import {
  DEFAULT_META_KEYS,
  errorCodeOf,
  errorOutcome,
  needsOwner,
  ok,
  passOn,
  toCallToolResult,
  toolError,
  metaKeys,
  needsOwnerSchema,
  NEEDS_OWNER,
  withLead,
} from "./outcome"

const ERROR_META_KEY = DEFAULT_META_KEYS.error

/** An app's own error, as PCP's PcpError is. */
class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

const expectedError = (error: unknown) =>
  error instanceof AppError
    ? { message: error.message, code: error.code }
    : undefined

describe("toCallToolResult", () => {
  it("answers a structured value as structuredContent and its JSON", () => {
    expect(toCallToolResult(ok({ a: 1 }), { structured: true })).toEqual({
      content: [{ type: "text", text: '{\n "a": 1\n}' }],
      structuredContent: { a: 1 },
    })
    expect(
      toCallToolResult(ok({ a: 1 }, { text: "One a." }), { structured: true }),
    ).toEqual({
      content: [{ type: "text", text: "One a." }],
      structuredContent: { a: 1 },
    })
  })

  it("answers prose as text alone", () => {
    expect(toCallToolResult(ok("Done."))).toEqual({
      content: [{ type: "text", text: "Done." }],
    })
  })

  it("keeps an error's code and hint", () => {
    const result = toCallToolResult(
      toolError("No server called x.", {
        code: "not_found",
        hint: "search finds them.",
      }),
    )

    expect(result).toEqual({
      content: [
        { type: "text", text: "No server called x.\n\nsearch finds them." },
      ],
      isError: true,
      _meta: {
        [ERROR_META_KEY]: { code: "not_found", hint: "search finds them." },
      },
    })
    expect(errorCodeOf(result)).toBe("not_found")
    expect(errorCodeOf({ content: [] })).toBeUndefined()
  })

  it("puts the code under the app's own prefix", () => {
    const pcp = metaKeys("gg.pcp")
    const result = toCallToolResult(toolError("No.", { code: "forbidden" }), {
      meta: pcp,
    })

    expect(result._meta).toEqual({ "gg.pcp/error": { code: "forbidden" } })
    expect(errorCodeOf(result, pcp)).toBe("forbidden")
    expect(errorCodeOf(result)).toBeUndefined()
  })

  it("carries a refusal's structured answer beside its words", () => {
    expect(
      toCallToolResult(
        toolError("Nothing to do.", {
          code: "no_change",
          structured: { ok: false },
        }),
        { structured: true },
      ),
    ).toEqual({
      content: [{ type: "text", text: "Nothing to do." }],
      structuredContent: { ok: false },
      isError: true,
      _meta: { [ERROR_META_KEY]: { code: "no_change" } },
    })
  })

  it("marks a call that waits for the owner, its link last", () => {
    const owner = {
      kind: "needs_owner" as const,
      reason: "permission" as const,
      url: "https://pcp.x/permissions/r1",
      label: "Answer the request in PCP",
      request: "r1",
    }
    const result = toCallToolResult(
      needsOwner(owner, "Not done yet.\n\nhttps://pcp.x/permissions/r1"),
    )

    expect(result.structuredContent).toEqual(owner)
    expect(result.isError).toBeUndefined()
  })

  it("passes on an answer made elsewhere, notes in front", () => {
    const answer = { content: [{ type: "text" as const, text: "ran" }] }

    expect(toCallToolResult(passOn(answer))).toBe(answer)
    expect(
      toCallToolResult(passOn(answer), {
        notes: ["a was renamed to b; use b."],
      }).content,
    ).toEqual([
      { type: "text", text: "a was renamed to b; use b." },
      { type: "text", text: "ran" },
    ])
  })
})

describe("errorOutcome", () => {
  it("keeps an expected error's words and code, and hides anything else", () => {
    expect(
      errorOutcome(new AppError("forbidden", "Not yours."), { expectedError }),
    ).toEqual({ type: "error", message: "Not yours.", code: "forbidden" })
    expect(errorOutcome(new Error("stack details"), { expectedError })).toEqual(
      {
        type: "error",
        message: "Something went wrong on the server.",
        code: "internal",
      },
    )
    expect(
      errorOutcome(new AppError("forbidden", "Not yours."), {
        internalMessage: "Something went wrong inside PCP.",
      }),
    ).toMatchObject({
      message: "Something went wrong inside PCP.",
      code: "internal",
    })
  })
})

describe("needsOwnerSchema", () => {
  it("widens NEEDS_OWNER with an app's own fields", () => {
    const pcp = needsOwnerSchema({ reason: z.enum(["permission", "connect"]) })
    const owner = {
      kind: "needs_owner",
      reason: "permission",
      url: "https://x/permissions/r1",
      label: "Allow it?",
    }

    expect(NEEDS_OWNER.safeParse({ ...owner, reason: "confirm" }).success).toBe(
      true,
    )
    expect(pcp.safeParse(owner).success).toBe(true)
    expect(pcp.safeParse({ ...owner, reason: "confirm" }).success).toBe(false)
  })
})

describe("withLead", () => {
  it("puts a line in front of every kind of text", () => {
    expect(withLead("Lead.", ok("Body."))).toEqual(ok("Lead.\n\nBody."))
    expect(withLead("Lead.", toolError("Bad."))).toMatchObject({
      message: "Lead.\n\nBad.",
    })
    expect(
      toCallToolResult(
        withLead(
          "Lead.",
          passOn({ content: [{ type: "text", text: "Asked." }] }),
        ),
      ).content,
    ).toEqual([{ type: "text", text: "Lead.\n\nAsked." }])
  })
})
