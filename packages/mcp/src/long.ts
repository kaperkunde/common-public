import type { LongSpec, Tool } from "./define"
import type { Outcome } from "./outcome"

/**
 * Long tools say they are working. A call that runs a model or a migration
 * can outlast a client's request timeout (the SDK's is a minute), which
 * reads as "tool call failed" while the work lands after. A tool marked
 * `long` (define.ts) sends progress while it runs, to a client that asked
 * for it, and, past its patience, answers honestly that it is still going
 * and where its result will land (its `stillGoing`), while the run carries
 * on behind the answer.
 *
 * The run's ctx.signal is the request's: a long run that must outlive the
 * answer does not stop on it.
 */

/** How long a long tool waits before answering that it is still going. */
export const LONG_PATIENCE_MS = 45_000
/** The same, for a client that asked for progress and is being sent it. */
export const LONG_STREAMED_PATIENCE_MS = 240_000
/** How often progress is sent while a long tool runs. */
export const PROGRESS_EVERY_MS = 5_000

export type PatienceOptions<Args, Out = Outcome> = {
  spec: LongSpec<Args, Out>
  args: Args
  /** The tool's title, for the progress messages. */
  title: string
  /** Whether the client asked for progress. */
  streamed: boolean
  /** Sends one progress notification (ToolContext.progress). */
  progress: (progress: number, more: { message: string }) => Promise<void>
  /** Told what the run came to when it finishes after the answer. */
  onLate?: (outcome: Out) => void
}

/**
 * The run's outcome, or `stillGoing`'s once patience runs out. `work` must
 * not reject: serve.ts turns a thrown error into an outcome first. An app
 * with an outcome shape of its own passes it as `Out`.
 */
export async function awaitPatiently<Args, Out = Outcome>(
  work: Promise<Out>,
  { spec, args, title, streamed, progress, onLate }: PatienceOptions<Args, Out>,
): Promise<Out> {
  const patience =
    spec.patienceMs?.(args, streamed) ??
    (streamed ? LONG_STREAMED_PATIENCE_MS : LONG_PATIENCE_MS)
  const every = spec.progressEveryMs ?? PROGRESS_EVERY_MS
  const started = Date.now()
  const ticker =
    streamed && every > 0
      ? setInterval(() => {
          const elapsed = Math.round((Date.now() - started) / 1000)

          void progress(elapsed, {
            message: `${title}: still working, ${elapsed}s so far.`,
          })
        }, every)
      : undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const waited = new Promise<"waited">((resolve) => {
    timer = setTimeout(() => resolve("waited"), patience)
  })

  try {
    const first = await Promise.race([work, waited])

    if (first !== "waited") {
      return first
    }
  } finally {
    clearInterval(ticker)
    clearTimeout(timer)
  }

  // Nobody is left waiting on this request to hear what it comes to.
  void work.then((outcome) => onLate?.(outcome))

  return spec.stillGoing(args, Date.now() - started)
}

/** The names of the long tools among `tools`. */
export function longToolNames(
  tools: ReadonlyArray<Pick<Tool, "name" | "long">>,
): Set<string> {
  return new Set(
    tools.filter((tool) => tool.long !== undefined).map((tool) => tool.name),
  )
}

/**
 * Whether a JSON-RPC body is a call to a long tool by a client that asked
 * for progress: a route answers that one on an event stream, so the
 * progress can reach it, and everything else as one JSON body.
 */
export function wantsStream(
  body: unknown,
  longTools: ReadonlySet<string>,
): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return false
  }

  const { method, params } = body as {
    method?: unknown
    params?: Record<string, unknown>
  }

  if (method !== "tools/call" || !params) {
    return false
  }

  const meta = params._meta as Record<string, unknown> | undefined

  return (
    typeof params.name === "string" &&
    longTools.has(params.name) &&
    meta?.progressToken !== undefined
  )
}
