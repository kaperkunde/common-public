import { z } from "zod"

import { ok, toolError, type Outcome, type ToolErrorCode } from "./outcome"

/**
 * The shared shape of a structured answer, for the tools that want one:
 * `ok`, `warnings`, a machine-readable `code` and `error` when it failed,
 * and for a write `changed`, `unchanged` and `dryRun` (and `pending` while
 * it carries on), so a no-op is visible as one. The tool's own fields sit
 * beside them, optional, since a failure may have none of them.
 *
 *   output: writeOutput({ moved: z.array(z.number()).describe("…") })
 *   run: async () => written({ text: "Moved 2.", changed, data: { moved } })
 *
 * written() turns a write that changed nothing (and is not still going)
 * into the `no_change` failure: a no-op is never reported as success.
 * A dry run counts what it would change, so one that would change nothing
 * is `no_change` too.
 */

/** What a write names as changed, or as asked about and left alone. */
export type Ref = { type: string; id: string | number; detail?: string }

/** A Ref's schema; `types` narrows `type` to an app's own kinds of thing. */
export function refSchema(
  types?: readonly [string, ...string[]],
): z.ZodType<Ref> {
  return z.object({
    type: (types ? z.enum(types) : z.string()).describe(
      "What kind of thing it is.",
    ),
    id: z.union([z.string(), z.number().int()]).describe("Its id."),
    detail: z
      .string()
      .optional()
      .describe("What happened to it, or why nothing did."),
  })
}

const REF = refSchema()

function readBase() {
  return {
    ok: z.boolean().describe("Whether it did what was asked."),
    code: z.string().optional().describe("Why not, when ok is false."),
    error: z
      .string()
      .optional()
      .describe("Why not, in words, when ok is false."),
    warnings: z
      .array(z.string())
      .describe("What it did but would like you to know."),
  }
}

function writeBase(ref: z.ZodType<Ref>) {
  return {
    ...readBase(),
    dryRun: z
      .boolean()
      .describe("Whether this was a plan only, with nothing written."),
    pending: z
      .boolean()
      .optional()
      .describe(
        "Still running when this answered; it carries on and lands where the words say.",
      ),
    changed: z
      .array(ref)
      .describe("What it changed (or, in a dry run, would change)."),
    unchanged: z
      .array(ref)
      .describe("What it was asked to change and left as it was, with why."),
  }
}

/** A read's output schema: the shared fields and the tool's own, optional. */
export function readOutput<S extends z.ZodRawShape>(shape: S) {
  return z.object({ ...readBase(), ...z.object(shape).partial().shape })
}

/** A write's output schema: the shared fields and the tool's own, optional. */
export function writeOutput<S extends z.ZodRawShape>(
  shape: S,
  { ref = REF }: { ref?: z.ZodType<Ref> } = {},
) {
  return z.object({ ...writeBase(ref), ...z.object(shape).partial().shape })
}

/** Warnings said in the words too, unless the words already say them. */
export function withWarnings(
  text: string,
  warnings: readonly string[],
): string {
  const unsaid = warnings.filter((warning) => !text.includes(warning))

  return unsaid.length === 0
    ? text
    : [text, "", ...unsaid.map((warning) => `Note: ${warning}`)].join("\n")
}

type Data = Record<string, unknown>

/** A read that did what was asked. */
export function answered({
  text,
  data = {},
  warnings = [],
}: {
  text: string
  data?: Data
  warnings?: string[]
}): Outcome {
  return ok(
    { ok: true, warnings, ...data },
    { text: withWarnings(text, warnings) },
  )
}

/** A read that did not. */
export function refused(
  code: ToolErrorCode,
  text: string,
  { data = {}, warnings = [] }: { data?: Data; warnings?: string[] } = {},
): Outcome {
  return toolError(withWarnings(text, warnings), {
    code,
    structured: { ok: false, code, error: text, warnings, ...data },
  })
}

export type WriteReport = {
  text: string
  changed: Ref[]
  unchanged?: Ref[]
  dryRun?: boolean
  /** Still going when it answered (a long tool's stillGoing). */
  pending?: boolean
  warnings?: string[]
  data?: Data
}

/** A write that did not, with whatever it did or would have done. */
export function notWritten(
  code: ToolErrorCode,
  text: string,
  {
    changed = [],
    unchanged = [],
    dryRun = false,
    warnings = [],
    data = {},
  }: Partial<Omit<WriteReport, "text" | "pending">> = {},
): Outcome {
  return toolError(withWarnings(text, warnings), {
    code,
    structured: {
      ok: false,
      code,
      error: text,
      warnings,
      dryRun,
      changed,
      unchanged,
      ...data,
    },
  })
}

/**
 * A write that did what was asked. One that changed nothing, and is not
 * still going, is the `no_change` failure instead, in its own words.
 */
export function written({
  text,
  changed,
  unchanged = [],
  dryRun = false,
  pending = false,
  warnings = [],
  data = {},
}: WriteReport): Outcome {
  if (changed.length === 0 && !pending) {
    return notWritten("no_change", text, { unchanged, dryRun, warnings, data })
  }

  return ok(
    {
      ok: true,
      warnings,
      dryRun,
      ...(pending ? { pending: true } : {}),
      changed,
      unchanged,
      ...data,
    },
    { text: withWarnings(text, warnings) },
  )
}
