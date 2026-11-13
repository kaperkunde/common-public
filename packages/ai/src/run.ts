import { generateText, streamText } from "ai"
import type {
  GenerateTextResult,
  LanguageModelUsage,
  ModelMessage,
  TextStreamPart,
  ToolSet,
} from "ai"

import { wholeInstructions, markCachePrefix } from "./cache"
import { fallbackWorthy } from "./fallback"
import { chatModel, type ResolvedBackend } from "./provider"
import { fitCall, tracedCall, type StepLike, type TraceCall } from "./trace"
import {
  requestsOf,
  type CallRequests,
  type RequestTokens,
  type StepUsageLike,
} from "./usage"

/** How the tool call is asked for, which the instructions word to match. */
export type AskShape = { toolChoice: "auto" | "required" }

/** One call to a language model, as the app describes it. `C` is the app's own context. */
export type ModelRun<TOOLS extends ToolSet, C> = {
  /** Whatever the hooks need to know: who it is for, what it is for. Passed through untouched. */
  context: C
  /** Who it is for, what for, and where it belongs: handed to `beforeCall` and `onUsage` as fields. */
  userId?: string
  purpose?: string
  scopeId?: string
  jobId?: string
  /** A line of words about what the call is doing. */
  activity?: string
  /** A short name for the trace. */
  label?: string
  model: string
  /** Asked once more when `model` fails on the provider's account (see `fallbackWorthy`). */
  fallbackModel?: string
  instructions: string | ((shape: AskShape) => string)
  /** Instructions the same for every call of their kind; cached across callers. */
  sharedInstructions?: string
  /** A tool loop over a growing conversation: cache up to the end of each step. */
  cacheConversation?: boolean
  /** The first message is the stable part and is marked for the provider's cache. */
  messages: ModelMessage[]
  tools: TOOLS
  toolChoice?: "auto" | "required"
  activeTools?: readonly (keyof TOOLS & string)[]
  toolApproval?: Parameters<typeof generateText>[0]["toolApproval"]
  stopWhen?: Parameters<typeof generateText>[0]["stopWhen"]
  /** How long the whole call may take. */
  timeoutMs?: number
  onStepFinish?: Parameters<typeof generateText>[0]["onStepFinish"]
  maxOutputTokens?: number
  /** The SDK's own retries on a failed request before the fallback is asked. Defaults to the SDK's (2). */
  maxRetries?: number
  providerOptions?: Parameters<typeof generateText>[0]["providerOptions"]
  /** Ends the call from outside (a job's pass running out of time). */
  abortSignal?: AbortSignal
  /** Stream the call, handing on each chunk; it still answers like `generateText`. */
  onStream?: (chunk: TextStreamPart<TOOLS>) => void
}

/** What `beforeCall` is told once the back end is chosen. */
export type CallContext<C> = {
  context: C
  userId?: string
  purpose?: string
  /** The back end's source: `deployment` or `own`. */
  source: string
  model: string
  /** 0 for the model asked for, 1 for the fallback. */
  attempt: 0 | 1
  backend: ResolvedBackend
}

/** What `onUsage` is told, in a `finally`, whatever happened. */
export type LlmUsageRow<C> = {
  kind: "llm"
  context: C
  userId?: string
  purpose?: string
  scopeId?: string
  jobId?: string
  activity?: string
  /** The model that actually ran. */
  model: string
  /** The backend's `source`. */
  source: string
  attempt: 0 | 1
  /** The provider's own total for the call, when it said. */
  usage?: LanguageModelUsage
  /** Each request as the provider billed it. */
  requests: RequestTokens[]
  /** The same, with the call-level totals (hour-long writes; geo, speed, tier of the first). */
  call: CallRequests
  startedAt: number
  ms: number
  failure?: string
  /**
   * True when this attempt threw. `requests` then holds every request the
   * provider reported before it did (none, if it died before the first), and
   * those tokens were consumed: record and charge them like any other.
   */
  failed?: true
  /** What kind of failure, without any of its text: a timeout, the caller's abort, or anything else. */
  failureKind?: "timeout" | "abort" | "error"
}

/** What a speech call reports. */
export type SpeechUsageRow<C = unknown> = {
  kind: "tts_chars"
  context?: C
  userId?: string
  purpose?: string
  scopeId?: string
  jobId?: string
  activity?: string
  source: string
  /** Characters sent: what the call is metered in. */
  units: number
  adapter: string
  model?: string
  voice: string
  chars: number
  seconds?: number
  startedAt: number
  ms: number
  failure?: string
}

export type UsageRow<C = unknown> = LlmUsageRow<C> | SpeechUsageRow<C>

export type ModelRunnerHooks<C> = {
  /**
   * Which back end serves this call. May throw a refusal (an
   * {@link BackendRefusedError}) before anything is owed. Either a function
   * (per call, per user) or one fixed backend.
   */
  backend:
    | ResolvedBackend
    | ((ask: {
        model: string
        context: C
      }) => Promise<ResolvedBackend> | ResolvedBackend)
  /**
   * Admission, run after the back end is chosen and before the model is asked.
   * Throwing refuses the call; a refused call is never passed to `onUsage`.
   */
  beforeCall?: (ctx: CallContext<C>) => void | Promise<void>
  /**
   * Called in a `finally` for every attempt that was made, with what the
   * provider reported. Its failure never replaces the call's own error. Whatever
   * it returns (a ledger row id) is handed to `trace` as `usageRef`.
   */
  onUsage?: (row: LlmUsageRow<C>) => unknown | Promise<unknown>
  /** An injected trace sink, called per attempt after `onUsage`; never fails the call. */
  trace?: (
    call: TraceCall,
    info: { context: C; usageRef?: string },
  ) => void | Promise<void>
  /** Whether a failure is worth the fallback model. Defaults to {@link fallbackWorthy}. */
  fallbackWorthy?: (error: unknown) => boolean
  /** Strings the error text must never carry (keys); replaced in place. */
  redact?: (text: string, backend: ResolvedBackend) => string
  /** Default call time. */
  defaultTimeoutMs?: number
  /** Called when the fallback is about to be asked. */
  onFallback?: (info: { from: string; to: string; error: unknown }) => void
}

export const DEFAULT_TIMEOUT_MS = 120 * 1000

const failureKindOf = (
  error: unknown,
  signal: AbortSignal | undefined,
): "timeout" | "abort" | "error" => {
  const name = error instanceof Error ? error.name : ""
  const cause = error instanceof Error ? error.cause : undefined
  const causeName = cause instanceof Error ? cause.name : ""
  if (name === "TimeoutError" || causeName === "TimeoutError") return "timeout"
  if (signal?.aborted || name === "AbortError" || causeName === "AbortError") {
    return "abort"
  }
  return "error"
}

const RESULT_FIELDS = [
  "content",
  "text",
  "reasoning",
  "reasoningText",
  "files",
  "sources",
  "toolCalls",
  "staticToolCalls",
  "dynamicToolCalls",
  "toolResults",
  "staticToolResults",
  "dynamicToolResults",
  "finishReason",
  "rawFinishReason",
  "usage",
  "totalUsage",
  "warnings",
  "request",
  "response",
  "responseMessages",
  "providerMetadata",
  "steps",
  "finalStep",
] as const

/**
 * A streamed call, finished: every chunk was handed on as it arrived, and what
 * is answered is the finished call in the shape `generateText` answers it.
 */
const finishStream = async <RESULT>(
  stream: { consumeStream: () => PromiseLike<void> } & Record<
    (typeof RESULT_FIELDS)[number],
    unknown
  >,
  failed: () => unknown,
): Promise<RESULT> => {
  await stream.consumeStream()
  const failure = failed()
  if (failure !== undefined) throw failure
  const values = await Promise.all(RESULT_FIELDS.map((field) => stream[field]))
  return Object.fromEntries(
    RESULT_FIELDS.map((field, i) => [field, values[i]]),
  ) as RESULT
}

/**
 * Builds `runModel`: one place every model call goes through, so the ledger
 * row is not optional. The package owns the mechanics (back end, provider,
 * cache marks, fallback, streaming, steps into requests, trace); the app owns
 * what is decided: admission in `beforeCall`, the books in `onUsage`.
 */
export type RunModel<C> = <TOOLS extends ToolSet>(
  run: ModelRun<TOOLS, C>,
) => Promise<GenerateTextResult<TOOLS, any, any>> // eslint-disable-line @typescript-eslint/no-explicit-any

export const createRunModel = <C>(hooks: ModelRunnerHooks<C>): RunModel<C> => {
  const attempt = async <TOOLS extends ToolSet>(
    asked: ModelRun<TOOLS, C>,
    attemptNo: 0 | 1,
  ) => {
    const backend =
      typeof hooks.backend === "function"
        ? await hooks.backend({ model: asked.model, context: asked.context })
        : hooks.backend
    const run =
      backend.model && backend.model !== asked.model
        ? { ...asked, model: backend.model }
        : asked
    await hooks.beforeCall?.({
      context: run.context,
      userId: run.userId,
      purpose: run.purpose,
      source: backend.source,
      model: run.model,
      attempt: attemptNo,
      backend,
    })
    const toolChoice = run.toolChoice ?? backend.toolChoice
    const own =
      typeof run.instructions === "function"
        ? run.instructions({ toolChoice })
        : run.instructions
    const prompt = markCachePrefix(backend.provider, own, run.messages, {
      shared: run.sharedInstructions,
      conversation: run.cacheConversation,
      providerOptions: run.providerOptions,
    })
    const instructions = wholeInstructions(own, run.sharedInstructions)
    let usage: LanguageModelUsage | undefined
    let requests: CallRequests = requestsOf([])
    const started = Date.now()
    const steps: StepLike[] = []
    const finished: StepUsageLike[] = []
    let failure: string | undefined
    let failureKind: LlmUsageRow<C>["failureKind"]
    // Every finished step is kept as it lands, so a call that dies in the
    // middle of a tool loop still reports the requests the provider billed.
    const onStepFinish: ModelRun<TOOLS, C>["onStepFinish"] = (step) => {
      steps.push(step)
      finished.push(step)
      return run.onStepFinish?.(step)
    }
    try {
      const args = {
        model: chatModel(run.model, backend),
        instructions: prompt.instructions,
        messages: prompt.messages,
        tools: run.tools,
        activeTools: run.activeTools,
        toolChoice,
        toolApproval: run.toolApproval,
        stopWhen: run.stopWhen,
        maxOutputTokens: run.maxOutputTokens,
        maxRetries: run.maxRetries,
        providerOptions: prompt.providerOptions,
        timeout: {
          totalMs:
            run.timeoutMs ?? hooks.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
        },
        abortSignal: run.abortSignal,
        onStepFinish,
      }
      let streamFailure: unknown
      const { onStream } = run
      const generate = () => generateText(args)
      const result = onStream
        ? await finishStream<Awaited<ReturnType<typeof generate>>>(
            streamText({
              ...args,
              onChunk: ({ chunk }) => {
                try {
                  onStream(chunk)
                } catch {
                  // A reader that cannot take a chunk never stops the call.
                }
              },
              onError: ({ error }) => {
                streamFailure = streamFailure ?? error
              },
              // An aborted stream ends quietly rather than erroring: it must
              // still fail the call, or a timed-out call would read as an answer.
              onAbort: () => {
                streamFailure =
                  streamFailure ??
                  (run.abortSignal?.aborted
                    ? (run.abortSignal.reason ??
                      new DOMException("The call was aborted", "AbortError"))
                    : new DOMException("The call timed out", "TimeoutError"))
              },
            }),
            () => streamFailure,
          )
        : await generate()
      usage = result.totalUsage
      requests = requestsOf(result.steps)
      return result as unknown as GenerateTextResult<TOOLS, any, any> // eslint-disable-line @typescript-eslint/no-explicit-any
    } catch (error) {
      let text = error instanceof Error ? error.message : ""
      if (error instanceof Error) {
        text =
          hooks.redact?.(error.message, backend) ??
          (backend.apiKey
            ? error.message.split(backend.apiKey).join("[redacted]")
            : error.message)
        try {
          error.message = text
        } catch {
          // A DOMException (an abort, a timeout) has a getter alone: its words
          // stay as they are, and the row still carries the redacted text.
        }
      }
      failure = error instanceof Error ? text || error.name : String(error)
      failureKind = failureKindOf(error, run.abortSignal)
      throw error
    } finally {
      // A failed attempt has no result to read: what the provider reported is
      // the steps that finished.
      if (failureKind) requests = requestsOf(finished)
      const row: LlmUsageRow<C> = {
        kind: "llm",
        context: run.context,
        userId: run.userId,
        purpose: run.purpose,
        scopeId: run.scopeId,
        jobId: run.jobId,
        activity: run.activity,
        model: run.model,
        source: backend.source,
        attempt: attemptNo,
        usage,
        requests: requests.requests,
        call: requests,
        startedAt: started,
        ms: Date.now() - started,
        ...(failure ? { failure } : {}),
        ...(failureKind ? { failed: true as const, failureKind } : {}),
      }
      let ref: unknown
      try {
        ref = await hooks.onUsage?.(row)
      } catch {
        // The books failing never replaces the call's own outcome.
      }
      if (hooks.trace) {
        try {
          const usageRef =
            ref === undefined || ref === null ? undefined : String(ref)
          await hooks.trace(
            fitCall(
              tracedCall({
                startedAt: started,
                ms: row.ms,
                label: run.label,
                model: run.model,
                instructions,
                messages: run.messages,
                steps,
                usageRef,
                source: backend.source,
                usage,
                failure,
              }),
            ),
            { context: run.context, usageRef },
          )
        } catch {
          // Tracing never fails the call.
        }
      }
    }
  }

  const worthy = hooks.fallbackWorthy ?? fallbackWorthy

  /** Asks a model, and once more the fallback where the first failed on the provider's account. */
  const runModel: RunModel<C> = async (run) => {
    try {
      return await attempt(run, 0)
    } catch (error) {
      const { fallbackModel } = run
      if (
        !fallbackModel ||
        fallbackModel === run.model ||
        run.abortSignal?.aborted ||
        !worthy(error)
      ) {
        throw error
      }
      hooks.onFallback?.({ from: run.model, to: fallbackModel, error })
      return attempt(
        { ...run, model: fallbackModel, fallbackModel: undefined },
        1,
      )
    }
  }
  return runModel
}
