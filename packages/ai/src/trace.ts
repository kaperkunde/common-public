/**
 * What a model call looks like on a trace: strings clipped, long arrays cut,
 * deep objects summarised, so one call fits a row. Pure.
 */

export type TracedMessage = { role: string; content: string }

export type TracedStep = {
  text?: string
  reasoning?: string
  calls: { tool: string; input: unknown }[]
  results: { tool: string; output: unknown }[]
  errors: { tool: string; error: string }[]
  finish?: string
}

export type TraceUsage = {
  input: number
  output: number
  cached: number
  cacheWrite?: number
  reasoning: number
}

export type TraceCall = {
  kind: "call"
  at: string
  ms: number
  /** Whatever the app calls this piece of work. */
  label?: string
  model: string
  instructions: string
  messages: TracedMessage[]
  steps: TracedStep[]
  usage?: TraceUsage
  error?: string
  /** The app's own reference to this call's ledger row, if its `onUsage` returned one. */
  usageRef?: string
  /** Which back end paid. */
  source?: string
  finish?: string
  clipped?: true
}

/** How long any one string may be on a call's trace. */
export const CALL_STRING_MAX = 120_000
/** How long a call's trace may be, as JSON. */
export const CALL_BUDGET = 600_000
const ARRAY_MAX = 60
const DEPTH_MAX = 8

/** A string no longer than `max`, saying how much was left out. */
export const clipText = (text: string, max = CALL_STRING_MAX) =>
  text.length <= max
    ? text
    : `${text.slice(0, max)}… [${text.length - max} more characters]`

/** A value fit for a trace. */
export const clipDeep = (
  value: unknown,
  max = CALL_STRING_MAX,
  depth = 0,
): unknown => {
  if (typeof value === "string") return clipText(value, max)
  if (value === null || typeof value !== "object") {
    return typeof value === "function" || typeof value === "symbol"
      ? String(value)
      : value
  }
  if (value instanceof Date) return value.toISOString()
  if (depth >= DEPTH_MAX) return "[…]"
  if (Array.isArray(value)) {
    const kept = value
      .slice(0, ARRAY_MAX)
      .map((item) => clipDeep(item, max, depth + 1))
    return value.length > ARRAY_MAX
      ? [...kept, `[${value.length - ARRAY_MAX} more]`]
      : kept
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, clipDeep(item, max, depth + 1)]),
  )
}

const json = (value: unknown) => {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

/** A message's content as one string: text as it is, other parts said in brackets. */
export const flattenContent = (content: unknown): string => {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return json(content)
  return content
    .map((part) => {
      const one = part as Record<string, unknown>
      switch (one?.type) {
        case "text":
          return String(one.text ?? "")
        case "reasoning":
          return `[reasoning] ${String(one.text ?? "")}`
        case "tool-call":
          return `[call ${String(one.toolName)}] ${json(one.input)}`
        case "tool-result":
          return `[result ${String(one.toolName)}] ${json(one.output)}`
        default:
          return `[${String(one?.type ?? "part")}]`
      }
    })
    .join("\n")
}

export const tracedMessages = (
  messages: readonly { role: string; content: unknown }[],
  max = CALL_STRING_MAX,
): TracedMessage[] =>
  messages.map((message) => ({
    role: message.role,
    content: clipText(flattenContent(message.content), max),
  }))

/** The shape of a finished step, as much of it as a trace reads. */
export type StepLike = {
  text?: string
  reasoningText?: string
  finishReason?: string
  content?: readonly unknown[]
  toolCalls?: readonly { toolName: string; input?: unknown }[]
  toolResults?: readonly { toolName: string; output?: unknown }[]
}

export const tracedStep = (
  step: StepLike,
  max = CALL_STRING_MAX,
): TracedStep => {
  const errors = (step.content ?? [])
    .map(
      (part) => part as { type?: string; toolName?: string; error?: unknown },
    )
    .filter((part) => part?.type === "tool-error")
    .map((part) => ({
      tool: String(part.toolName ?? ""),
      error: clipText(
        part.error instanceof Error ? part.error.message : json(part.error),
        max,
      ),
    }))
  return {
    ...(step.text ? { text: clipText(step.text, max) } : {}),
    ...(step.reasoningText
      ? { reasoning: clipText(step.reasoningText, max) }
      : {}),
    calls: (step.toolCalls ?? []).map((call) => ({
      tool: call.toolName,
      input: clipDeep(call.input, max),
    })),
    results: (step.toolResults ?? []).map((result) => ({
      tool: result.toolName,
      output: clipDeep(result.output, max),
    })),
    errors,
    ...(step.finishReason ? { finish: step.finishReason } : {}),
  }
}

/** What a provider reported a call used, as much of it as a trace reads. */
export type UsageLike = {
  inputTokens?: number
  outputTokens?: number
  inputTokenDetails?: { cacheReadTokens?: number; cacheWriteTokens?: number }
  outputTokenDetails?: { reasoningTokens?: number }
}

/** One model call as the runner saw it, before anything was clipped. */
export type CallRecord = {
  startedAt: number
  ms: number
  label?: string
  model: string
  instructions: string
  messages: readonly { role: string; content: unknown }[]
  steps: readonly StepLike[]
  usageRef?: string
  source: string
  usage?: UsageLike
  failure?: string
}

/** One call as a trace keeps it, every string clipped to `max`. */
export const tracedCall = (
  call: CallRecord,
  max = CALL_STRING_MAX,
): TraceCall => {
  const finish = call.steps[call.steps.length - 1]?.finishReason
  return {
    kind: "call",
    at: new Date(call.startedAt).toISOString(),
    ms: call.ms,
    ...(call.label ? { label: call.label } : {}),
    model: call.model,
    instructions: clipText(call.instructions, max),
    messages: tracedMessages(call.messages, max),
    steps: call.steps.map((step) => tracedStep(step, max)),
    ...(call.usageRef ? { usageRef: call.usageRef } : {}),
    source: call.source,
    ...(call.usage
      ? {
          usage: {
            input: call.usage.inputTokens ?? 0,
            output: call.usage.outputTokens ?? 0,
            cached: call.usage.inputTokenDetails?.cacheReadTokens ?? 0,
            cacheWrite: call.usage.inputTokenDetails?.cacheWriteTokens ?? 0,
            reasoning: call.usage.outputTokenDetails?.reasoningTokens ?? 0,
          },
        }
      : {}),
    ...(finish ? { finish } : {}),
    ...(call.failure ? { error: clipText(call.failure, max) } : {}),
  }
}

const clipCallTo = (entry: TraceCall, max: number): TraceCall => {
  const prompt = Math.max(Math.floor(max / 4), 80)
  return {
    ...entry,
    instructions: clipText(entry.instructions, prompt),
    messages: tracedMessages(entry.messages, prompt),
    steps: entry.steps.map((step) => clipDeep(step, max) as TracedStep),
    ...(entry.error
      ? { error: clipText(entry.error, Math.max(max, 2000)) }
      : {}),
  }
}

/** A call clipped until it fits `budget` characters of JSON, and said to be when it was. */
export const fitCall = (entry: TraceCall, budget = CALL_BUDGET): TraceCall => {
  if (json(entry).length <= budget) return entry
  for (const limit of [40_000, 12_000, 4000, 1000, 160]) {
    const clipped = { ...clipCallTo(entry, limit), clipped: true as const }
    if (json(clipped).length <= budget) return clipped
  }
  const shortest = { ...clipCallTo(entry, 160), clipped: true as const }
  let size = json({ ...shortest, steps: [] }).length
  const steps = shortest.steps.filter((step) => {
    size += json(step).length + 1
    return size <= budget
  })
  return { ...shortest, steps }
}
