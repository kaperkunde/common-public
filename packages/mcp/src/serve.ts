import type {
  CallToolResult,
  McpServer,
  ServerContext,
} from "@modelcontextprotocol/server"

import {
  applyAliases,
  publishedSchema,
  type LogNames,
  type Tool,
  type ToolContext,
} from "./define"
import { awaitPatiently } from "./long"
import {
  DEFAULT_META_KEYS,
  errorOutcome,
  INTERNAL_ERROR_MESSAGE,
  passOn,
  toCallToolResult,
  toolError,
  type ExpectedErrorHook,
  type MetaKeys,
  type NeedsOwner,
  type Outcome,
  type ToolErrorCode,
} from "./outcome"
import {
  argumentsRefusal,
  sameJson,
  validate,
  zodProblems,
  type StringPlaceholder,
} from "./validate"

/**
 * How a call of a tool defined with defineTool runs, from the arguments as
 * the client sent them to the result it gets back, with its log line: old
 * names renamed, the arguments checked, the run (patiently, for a long
 * tool), and its outcome mapped to a result, which is checked against the
 * output schema the tool declares.
 */

/** What the log line keeps for arguments that did not fit. */
export const ARGUMENTS_DID_NOT_FIT =
  "The arguments did not fit the tool's input schema."
/** What it keeps for a refusal it may not quote, or another tool's error. */
export const TOOL_REPORTED_ERROR = "The tool reported an error."

export type CallLine<Note = undefined> = {
  tool: string
  names: LogNames
  ok: boolean
  ms: number
  /** Why it failed, in words the log may keep. */
  error?: string
  /** The failure's code, when this package wrote it. */
  code?: ToolErrorCode
  /** What the app's `scope` handed the call (PCP: its log note). */
  note: Note
}

/** What the server should hear about, but no client. */
export type ServeEvent =
  | { kind: "threw"; tool: string; error: unknown }
  | { kind: "output_mismatch"; tool: string; problems: string[] }
  | { kind: "finished_late"; tool: string; ok: boolean; code?: ToolErrorCode }

export type ServeOptions<App = unknown, Note = undefined> = {
  /** Handed every run as ctx.app: the caller, say. */
  app?: App
  /** Where codes and notes go in `_meta`; DEFAULT_META_KEYS. */
  meta?: MetaKeys
  /** Recognises the app's own thrown errors; anything else is a fault. */
  expectedError?: ExpectedErrorHook
  /** What a fault is answered with; INTERNAL_ERROR_MESSAGE. */
  internalMessage?: string
  /** Objects that may stand for a string in the arguments. */
  placeholders?: readonly StringPlaceholder[]
  /**
   * Reads a request to the owner out of an answer passed on (ownerLinkIn),
   * so it is marked as needsOwner's are.
   */
  ownerLink?: (result: CallToolResult) => NeedsOwner | null
  /** Writes the call's log line. */
  log?: (line: CallLine<Note>) => void
  /** Runs each call inside the app's own scope (PCP: withLogNote). */
  scope?: (
    run: (note: Note) => Promise<CallToolResult>,
  ) => Promise<CallToolResult>
  /** Hears about faults; console.error and console.info by default. */
  report?: (event: ServeEvent) => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function defaultReport(event: ServeEvent): void {
  switch (event.kind) {
    case "threw":
      console.error("[mcp] tool failed", {
        tool: event.tool,
        error: event.error,
      })
      break
    case "output_mismatch":
      console.error("[mcp] answer does not fit the output schema", {
        tool: event.tool,
        problems: event.problems,
      })
      break
    case "finished_late":
      console.info(
        `[mcp] ${event.tool} finished after answering that it was still going: ${event.ok ? "done" : `failed (${event.code ?? "error"})`}`,
      )
  }
}

/**
 * The request to the owner an answer ends with: its link, the last line of
 * its text, under `prefix` (PCP's `<address>/permissions/`), the rest of the
 * address the request's id. The link alone, or as a markdown link whose
 * label it keeps. Null when it asks nothing.
 */
export function ownerLinkIn(
  result: CallToolResult,
  {
    prefix,
    label: fallback,
    reason = "permission",
  }: { prefix: string; label: string; reason?: string },
): NeedsOwner | null {
  const texts = result.content.filter((part) => part.type === "text")
  const last = texts.at(-1)?.text.trimEnd().split("\n").at(-1)?.trim() ?? ""
  const markdown = /^\[([^\]]*)\]\((.*)\)$/.exec(last)
  const url = markdown?.[2] ?? last
  const label = markdown?.[1]?.trim() || fallback

  if (!url.startsWith(prefix) || /\s/.test(url)) {
    return null
  }

  let request: string

  try {
    request = decodeURIComponent(url.slice(prefix.length))
  } catch {
    return null
  }

  return request && !request.includes("/")
    ? { kind: "needs_owner", reason, url, label, request }
    : null
}

/** An answer made elsewhere that asks the owner, marked as needsOwner's are. */
function markOwner(
  outcome: Outcome,
  ownerLink: ServeOptions["ownerLink"],
): Outcome {
  if (
    !ownerLink ||
    outcome.type !== "result" ||
    outcome.result.isError === true ||
    outcome.result.structuredContent !== undefined
  ) {
    return outcome
  }

  const owner = ownerLink(outcome.result)

  return owner
    ? passOn({ ...outcome.result, structuredContent: owner })
    : outcome
}

/** A result's text, its text blocks one after another. */
function textOfResult(result: CallToolResult): string {
  return result.content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n\n")
}

/** Whether a result's text is its structuredContent's JSON and nothing more. */
function textIsStructured(result: CallToolResult): boolean {
  const texts = result.content.filter((part) => part.type === "text")

  if (texts.length !== 1 || result.content.length !== 1) {
    return false
  }

  try {
    return sameJson(JSON.parse(texts[0]!.text), result.structuredContent)
  } catch {
    return false
  }
}

/**
 * The result as every client reads it whole. Some clients show
 * structuredContent in place of the text, so what the text says must be
 * there too: a needs_owner answer carries its text as `message`, and a tool
 * that declares no output schema sends structuredContent only when its text
 * is that value's JSON and nothing more (a note, a lead or a preview that
 * the value does not hold would be lost otherwise; the text alone is a
 * whole answer).
 */
export function fitForClients(
  result: CallToolResult,
  declared: boolean,
): CallToolResult {
  const structured = result.structuredContent as
    { kind?: unknown; message?: unknown } | undefined

  if (structured === undefined || result.isError === true) {
    return result
  }

  if (structured.kind === "needs_owner") {
    return typeof structured.message === "string"
      ? result
      : {
          ...result,
          structuredContent: { ...structured, message: textOfResult(result) },
        }
  }

  if (declared || textIsStructured(result)) {
    return result
  }

  const rest: CallToolResult = { ...result }
  delete rest.structuredContent
  return rest
}

/** What a tool names for its log line, from arguments not yet checked. */
function logNames(tool: Tool<never>, args: Record<string, unknown>): LogNames {
  try {
    const names = tool.log?.(args) ?? {}

    return Object.fromEntries(
      Object.entries(names).filter(([, value]) => typeof value === "string"),
    )
  } catch {
    return {}
  }
}

/** The run's context: the request's signal, the log's names, progress. */
function toolContext<App>(
  request: ServerContext,
  names: LogNames,
  app: App,
): ToolContext<App> {
  const token = request.mcpReq._meta?.progressToken
  let last = -Infinity

  return {
    signal: request.mcpReq.signal,
    request,
    logAs: (more) => Object.assign(names, more),
    wantsProgress: token !== undefined,
    app,
    async progress(progress, more = {}) {
      // Progress only goes up, as the protocol has it.
      if (token === undefined || !(progress > last)) {
        return
      }

      last = progress

      try {
        await request.mcpReq.notify({
          method: "notifications/progress",
          params: { progressToken: token, progress, ...more },
        })
      } catch {
        // The client went away; the run carries on.
      }
    },
  }
}

/** One call of a tool, start to end. */
export function serveTool<App = unknown, Note = undefined>(
  tool: Tool<App>,
  sent: unknown,
  request: ServerContext,
  options: ServeOptions<App, Note> = {},
): Promise<CallToolResult> {
  const meta = options.meta ?? DEFAULT_META_KEYS
  const report = options.report ?? defaultReport
  const scope =
    options.scope ??
    ((run: (note: Note) => Promise<CallToolResult>) => run(undefined as Note))
  const failed = (error: unknown): Outcome => {
    const outcome = errorOutcome(error, {
      expectedError: options.expectedError,
      internalMessage: options.internalMessage,
    })

    if (outcome.type === "error" && outcome.code === "internal") {
      report({ kind: "threw", tool: tool.name, error })
    }

    return outcome
  }

  return scope(async (note) => {
    const started = Date.now()
    const names: LogNames = {}
    let notes: string[] = []
    let outcome: Outcome

    try {
      const renamed = applyAliases(isRecord(sent) ? sent : {}, tool.aliases)
      notes = renamed.notes
      Object.assign(names, logNames(tool as Tool<never>, renamed.args))

      const problems = renamed.conflict
        ? [renamed.conflict]
        : validate(tool.inputSchema(), renamed.args, {
            placeholders: options.placeholders,
          })

      if (problems.length > 0) {
        outcome = toolError(
          argumentsRefusal(tool.name, problems, {
            lead: "nothing was done",
            hint: tool.invalidHint?.(renamed.args),
          }),
          { code: "invalid_arguments", logAs: ARGUMENTS_DID_NOT_FIT },
        )
      } else {
        const parsed = tool.input.safeParse(renamed.args)

        if (parsed.success) {
          const ctx = toolContext(request, names, options.app as App)
          const work = Promise.resolve()
            .then(() => tool.run(parsed.data, ctx))
            .catch(failed)

          outcome = tool.long
            ? await awaitPatiently(work, {
                spec: tool.long,
                args: parsed.data,
                title: tool.title,
                streamed: ctx.wantsProgress,
                progress: ctx.progress,
                onLate: (late) =>
                  report({
                    kind: "finished_late",
                    tool: tool.name,
                    ok: late.type !== "error",
                    ...(late.type === "error" ? { code: late.code } : {}),
                  }),
              })
            : await work
        } else {
          outcome = toolError(
            argumentsRefusal(tool.name, zodProblems(parsed.error.issues), {
              lead: "nothing was done",
            }),
            { code: "invalid_arguments", logAs: ARGUMENTS_DID_NOT_FIT },
          )
        }
      }
    } catch (error) {
      outcome = failed(error)
    }

    outcome = markOwner(outcome, options.ownerLink)
    const declared = tool.output !== undefined
    let result = fitForClients(
      toCallToolResult(outcome, { structured: declared, notes, meta }),
      declared,
    )

    // What a tool declares it answers, it answers: anything else is a bug.
    // Checked against the schema as published, by the same check as
    // arguments: an extra key is as wrong as a missing one. A refusal is
    // checked only when it carries a structured answer.
    if (
      declared &&
      (result.isError !== true || result.structuredContent !== undefined)
    ) {
      const problems = validate(tool.outputSchema(), result.structuredContent, {
        schemaName: "outputSchema",
        whole: "The answer",
        arguments: false,
      })

      if (problems.length > 0) {
        report({ kind: "output_mismatch", tool: tool.name, problems })
        outcome = toolError(options.internalMessage ?? INTERNAL_ERROR_MESSAGE, {
          code: "internal",
        })
        result = toCallToolResult(outcome, { notes, meta })
      }
    }

    const isError = result.isError === true

    options.log?.({
      tool: tool.name,
      names,
      ok: !isError,
      ms: Date.now() - started,
      ...(isError
        ? {
            error:
              outcome.type === "error"
                ? (outcome.logAs ??
                  (tool.quiet
                    ? TOOL_REPORTED_ERROR
                    : outcome.message.slice(0, 200)))
                : TOOL_REPORTED_ERROR,
            ...(outcome.type === "error" ? { code: outcome.code } : {}),
          }
        : {}),
      note,
    })

    return result
  })
}

/** Registers a tool on an MCP server, served as above. */
export function registerTool<App = unknown, Note = undefined>(
  server: McpServer,
  tool: Tool<App>,
  options: ServeOptions<App, Note> = {},
): void {
  const output = tool.output
    ? publishedSchema(() => tool.outputSchema()!)
    : undefined

  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: publishedSchema(() => tool.inputSchema()),
      ...(output ? { outputSchema: output } : {}),
      annotations: tool.annotations,
      ...(tool.meta ? { _meta: tool.meta } : {}),
    },
    (args, ctx) => serveTool(tool, args, ctx, options),
  )
}

/** Registers every tool, refusing a name given twice before any is. */
export function registerTools<App = unknown, Note = undefined>(
  server: McpServer,
  tools: ReadonlyArray<Tool<App>>,
  options: ServeOptions<App, Note> = {},
): void {
  const seen = new Set<string>()

  for (const tool of tools) {
    if (seen.has(tool.name)) {
      throw new Error(`The tool ${tool.name} is defined twice.`)
    }

    seen.add(tool.name)
  }

  for (const tool of tools) {
    registerTool(server, tool, options)
  }
}
