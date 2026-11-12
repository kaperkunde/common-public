import {
  MIME,
  SpeechError,
  metered,
  type Speech,
  type SpeechOptions,
} from "./types"

export type OpenAiSpeechOptions<C = unknown> = SpeechOptions<C> & {
  apiKey: string
  /** Defaults to `https://api.openai.com/v1`; any compatible server works. */
  baseURL?: string
  model: string
  /** Extra instructions for models that take them. */
  instructions?: string
  speed?: number
}

/** OpenAI's `/audio/speech`, or any server that speaks it. Plain fetch. */
export const openaiSpeech = <C = unknown>(
  options: OpenAiSpeechOptions<C>,
): Speech => {
  const base = (options.baseURL ?? "https://api.openai.com/v1").replace(
    /\/+$/,
    "",
  )
  return {
    name: "openai",
    synthesize: (input) => {
      const { text, voice, format = "mp3" } = input
      const signal = input.signal
      return metered(
        options,
        { adapter: "openai", model: options.model, voice, text, input },
        async () => {
          const response = await (options.fetch ?? fetch)(
            `${base}/audio/speech`,
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                authorization: `Bearer ${options.apiKey}`,
              },
              body: JSON.stringify({
                model: options.model,
                input: text,
                voice,
                response_format: format,
                ...(options.instructions
                  ? { instructions: options.instructions }
                  : {}),
                ...(options.speed ? { speed: options.speed } : {}),
              }),
              signal,
            },
          )
          if (!response.ok) {
            const detail = await response.text().catch(() => "")
            throw new SpeechError(
              `OpenAI speech failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`,
              response.status,
            )
          }
          return {
            audio: new Uint8Array(await response.arrayBuffer()),
            mime: MIME[format],
          }
        },
      )
    },
  }
}
