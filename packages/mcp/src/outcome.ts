import type { CallToolResult } from "@modelcontextprotocol/server"
import { z } from "zod"

/**
 * What a tool's run comes to, before it is an MCP result. Every tool made
 * with defineTool answers one of these ways, mapped to a result in one
 * place (toCallToolResult):
 *
 * - ok(value): it did what it was asked. A tool that declares an output
 *   schema gets `value` as structuredContent, with its JSON as the text; a
 *   tool that answers in prose passes the text as the value.
 * - toolError(message, { code, hint }): it did not, and says why. Sent with
 *   isError, the message (and the hint after it) as the text and the code
 *   in `_meta[meta.error]`, so the code is never lost. An assistant reads
 *   it and tries again; a protocol error is only for an unknown tool or a
 *   malformed request, which the SDK answers. A refusal may carry a
 *   structured value too (`structured`: notWritten in write.ts does), which
 *   is then its structuredContent.
 * - needsOwner(owner, text): it waits for the owner: a permission request
 *   or a server to connect. The text ends with the link the assistant hands
 *   over (owner.ts linkLastText); structuredContent carries the same as
 *   NEEDS_OWNER, on every tool, declared in the output schema of the tools
 *   that have one.
 * - passOn(result): an answer made elsewhere (an upstream tool's, a
 *   permission request's), passed on as it is. A request to the owner in it
 *   can be recognised by its link (serve.ts ownerLink).
 */

/** The codes this package itself answers with. */
export type KnownToolErrorCode =
  /** The arguments do not fit the tool's input schema; nothing ran. */
  | "invalid_arguments"
  /** The arguments fit the schema but not the tool; nothing ran. */
  | "validation"
  /** Too many calls of this kind in a short time; nothing ran. */
  | "rate_limited"
  /** A write that would change nothing (write.ts). */
  | "no_change"
  /** A fault in the server itself. */
  | "internal"

/** Why a tool did not do what it was asked, for a client to act on. */
export type ToolErrorCode = KnownToolErrorCode | (string & {})

/**
 * Where a result's error code and hint are, and a structured answer's
 * notes (a renamed argument), in its `_meta`.
 */
export type MetaKeys = { error: string; notes: string }

/** `<prefix>/error` and `<prefix>/notes`: PCP passes "gg.pcp". */
export function metaKeys(prefix: string): MetaKeys {
  return { error: `${prefix}/error`, notes: `${prefix}/notes` }
}

/** The keys used when an app names none. */
export const DEFAULT_META_KEYS: MetaKeys = metaKeys("kaperkunde")

/**
 * A call that waits for the owner, as structuredContent: the link to hand
 * over and what it is for. An app widens it with its own fields
 * (needsOwnerSchema): the reasons it has, a server's links.
 */
export const NEEDS_OWNER = z.object({
  kind: z.literal("needs_owner"),
  /** Why: "permission", "connect", "confirm". */
  reason: z.string(),
  /** The page the owner opens. */
  url: z.string(),
  /** A few words for the link. */
  label: z.string(),
  /** The request's id, for the tool that checks on it. */
  request: z.string().optional(),
  /**
   * The whole answer in words, as its text says it: what the owner is
   * asked and how to hand the link over. Set for every tool (serve.ts), so
   * a client that shows structuredContent in place of the text loses none
   * of it.
   */
  message: z.string().optional(),
})

/** NEEDS_OWNER with an app's own fields, or narrower ones in its place. */
export function needsOwnerSchema<S extends z.ZodRawShape>(shape: S) {
  return NEEDS_OWNER.extend(shape)
}

export type NeedsOwner = z.infer<typeof NEEDS_OWNER> & Record<string, unknown>

export type Outcome =
  | { type: "ok"; value: unknown; text?: string }
  | {
      type: "error"
      message: string
      code: ToolErrorCode
      hint?: string
      /** What the log line keeps instead of the message. */
      logAs?: string
      /** A structured answer beside the words, for a declared output. */
      structured?: unknown
    }
  | { type: "needs_owner"; owner: NeedsOwner; text: string }
  | { type: "result"; result: CallToolResult }

/**
 * It did what it was asked. `text` replaces the JSON of a structured
 * value, for a value whose text is long or better said otherwise.
 */
export function ok(value: unknown, { text }: { text?: string } = {}): Outcome {
  return { type: "ok", value, ...(text !== undefined ? { text } : {}) }
}

/** It did not, and says why; nothing it was asked to do happened. */
export function toolError(
  message: string,
  {
    code = "validation",
    hint,
    logAs,
    structured,
  }: {
    code?: ToolErrorCode
    hint?: string
    logAs?: string
    structured?: unknown
  } = {},
): Outcome {
  return {
    type: "error",
    message,
    code,
    ...(hint ? { hint } : {}),
    ...(logAs ? { logAs } : {}),
    ...(structured !== undefined ? { structured } : {}),
  }
}

/** It waits for the owner; `text` ends with the link to hand over. */
export function needsOwner(owner: NeedsOwner, text: string): Outcome {
  return { type: "needs_owner", owner, text }
}

/** An answer made elsewhere, passed on as it is. */
export function passOn(result: CallToolResult): Outcome {
  return { type: "result", result }
}

/** A thrown error an app recognises: its words are for the assistant. */
export type ExpectedError = {
  message: string
  code: ToolErrorCode
  hint?: string
}

/** Recognises an app's own errors (PCP's PcpError); undefined for a fault. */
export type ExpectedErrorHook = (error: unknown) => ExpectedError | undefined

/** What is said of a fault, whose own words stay on the server. */
export const INTERNAL_ERROR_MESSAGE = "Something went wrong on the server."

/**
 * What a thrown error comes to: an expected error's own words and code, or
 * a fault, whose words are never passed on.
 */
export function errorOutcome(
  error: unknown,
  {
    expectedError,
    internalMessage = INTERNAL_ERROR_MESSAGE,
  }: { expectedError?: ExpectedErrorHook; internalMessage?: string } = {},
): Outcome {
  const expected = expectedError?.(error)

  return expected
    ? toolError(expected.message, { code: expected.code, hint: expected.hint })
    : toolError(internalMessage, { code: "internal" })
}

/** A line in front of an outcome's text: a renamed argument's note, say. */
export function withLead(lead: string, outcome: Outcome): Outcome {
  switch (outcome.type) {
    case "error":
      return { ...outcome, message: `${lead}\n\n${outcome.message}` }
    case "needs_owner":
      return { ...outcome, text: `${lead}\n\n${outcome.text}` }
    case "result": {
      const [first, ...rest] = outcome.result.content

      return first?.type === "text"
        ? passOn({
            ...outcome.result,
            content: [{ ...first, text: `${lead}\n\n${first.text}` }, ...rest],
          })
        : outcome
    }
    case "ok":
      return typeof outcome.value === "string" && outcome.text === undefined
        ? { ...outcome, value: `${lead}\n\n${outcome.value}` }
        : outcome
  }
}

/** A value's JSON as an answer's text. */
export function jsonText(value: unknown): string {
  return JSON.stringify(value, null, 1)
}

export type ResultOptions = {
  /** The tool declares an output schema: ok values are structuredContent. */
  structured?: boolean
  /** Lines in front of the answer, each a text of its own. */
  notes?: string[]
  /** Where the code and the notes go in `_meta`; DEFAULT_META_KEYS. */
  meta?: MetaKeys
}

/**
 * The MCP result for an outcome. `structured` says the tool declares an
 * output schema: its ok values are structuredContent, with their JSON as
 * text. `notes` go first, each a text of its own (a renamed argument).
 */
export function toCallToolResult(
  outcome: Outcome,
  {
    structured = false,
    notes = [],
    meta = DEFAULT_META_KEYS,
  }: ResultOptions = {},
): CallToolResult {
  const lead = notes.map((note) => ({ type: "text" as const, text: note }))
  let result: CallToolResult

  switch (outcome.type) {
    case "ok": {
      const text =
        outcome.text ??
        (typeof outcome.value === "string" && !structured
          ? outcome.value
          : jsonText(outcome.value))

      result = {
        content: [{ type: "text", text }],
        ...(structured ? { structuredContent: outcome.value as never } : {}),
      }
      break
    }
    case "error":
      result = {
        content: [
          {
            type: "text",
            text: outcome.hint
              ? `${outcome.message}\n\n${outcome.hint}`
              : outcome.message,
          },
        ],
        ...(outcome.structured !== undefined
          ? { structuredContent: outcome.structured as never }
          : {}),
        isError: true,
        _meta: {
          [meta.error]: {
            code: outcome.code,
            ...(outcome.hint ? { hint: outcome.hint } : {}),
          },
        },
      }
      break
    case "needs_owner":
      result = {
        content: [{ type: "text", text: outcome.text }],
        structuredContent: outcome.owner,
      }
      break
    case "result":
      result = outcome.result
  }

  if (lead.length === 0) {
    return result
  }

  return {
    ...result,
    content: [...lead, ...result.content],
    ...(result.structuredContent !== undefined
      ? { _meta: { ...result._meta, [meta.notes]: notes } }
      : {}),
  }
}

/** The error code a result carries, when this package wrote it. */
export function errorCodeOf(
  result: CallToolResult,
  meta: MetaKeys = DEFAULT_META_KEYS,
): ToolErrorCode | undefined {
  const found = result._meta?.[meta.error] as { code?: unknown } | undefined

  return typeof found?.code === "string" ? found.code : undefined
}
