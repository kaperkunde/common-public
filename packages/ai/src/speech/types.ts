import type { SpeechUsageRow } from "../run"

export type SpeechFormat = "mp3" | "wav" | "opus" | "aac" | "flac"

export type SynthesizeInput = {
  text: string
  /** The provider's own voice id or name. */
  voice: string
  /** Defaults to mp3. */
  format?: SpeechFormat
  /** Ends the request from outside. */
  signal?: AbortSignal
  /** Accounting fields, reported on `onUsage` and handed to `beforeCall`. */
  userId?: string
  purpose?: string
  scopeId?: string
  jobId?: string
  activity?: string
  /** Who pays: `deployment` (default) or `own`. */
  source?: string
}

export type SynthesizeResult = {
  audio: Uint8Array
  /** The audio's media type, e.g. `audio/mpeg`. */
  mime: string
  /** Characters of text billed. */
  chars: number
  /** Length of the audio where the adapter knows it. */
  seconds?: number
}

/** Text to speech. Adapters differ in provider, never in this shape. */
export interface Speech {
  readonly name: string
  synthesize(input: SynthesizeInput): Promise<SynthesizeResult>
}

/** Options every adapter takes. */
export type SpeechOptions<C = unknown> = {
  fetch?: typeof fetch
  /** Whatever the app wants handed back on `onUsage`. */
  context?: C
  /**
   * Admission, before the provider is asked; throw to refuse (the error
   * propagates untouched, and nothing is reported).
   */
  beforeCall?: (call: {
    userId?: string
    model?: string
    source: string
    purpose?: string
    units: number
  }) => void | Promise<void>
  /**
   * Called in a `finally` for every call, with kind `tts_chars` and the
   * characters sent, the same shape `runModel`'s `onUsage` takes. A failure in
   * it never replaces the call's own outcome.
   */
  onUsage?: (row: SpeechUsageRow<C>) => void | Promise<void>
}

export class SpeechError extends Error {
  readonly status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = "SpeechError"
    this.status = status
  }
}

export const MIME: Record<SpeechFormat, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  opus: "audio/ogg",
  aac: "audio/aac",
  flac: "audio/flac",
}

/** Runs one synthesis, reporting usage in a `finally`. */
export const metered = async <C>(
  options: SpeechOptions<C>,
  meta: {
    adapter: string
    model?: string
    voice: string
    text: string
    input?: SynthesizeInput
  },
  run: () => Promise<Omit<SynthesizeResult, "chars">>,
): Promise<SynthesizeResult> => {
  await options.beforeCall?.({
    userId: meta.input?.userId,
    model: meta.model,
    source: meta.input?.source ?? "deployment",
    purpose: meta.input?.purpose,
    units: meta.text.length,
  })
  const startedAt = Date.now()
  let failure: string | undefined
  let seconds: number | undefined
  try {
    const result = await run()
    seconds = result.seconds
    return { ...result, chars: meta.text.length }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
    throw error
  } finally {
    try {
      await options.onUsage?.({
        kind: "tts_chars",
        context: options.context,
        userId: meta.input?.userId,
        purpose: meta.input?.purpose,
        scopeId: meta.input?.scopeId,
        jobId: meta.input?.jobId,
        activity: meta.input?.activity,
        source: meta.input?.source ?? "deployment",
        units: meta.text.length,
        adapter: meta.adapter,
        model: meta.model,
        voice: meta.voice,
        chars: meta.text.length,
        seconds,
        startedAt,
        ms: Date.now() - startedAt,
        ...(failure ? { failure } : {}),
      })
    } catch {
      // The books failing never replaces the call's own outcome.
    }
  }
}
