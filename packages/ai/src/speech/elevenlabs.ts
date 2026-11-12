import {
  MIME,
  SpeechError,
  metered,
  type Speech,
  type SpeechOptions,
} from "./types"

export type ElevenLabsSpeechOptions<C = unknown> = SpeechOptions<C> & {
  apiKey: string
  /** Defaults to `https://api.elevenlabs.io`. */
  baseURL?: string
  /** The model id, e.g. `eleven_multilingual_v2`. */
  model?: string
  voiceSettings?: Record<string, number | boolean>
  /** The provider's `output_format`; default `mp3_44100_128`. */
  outputFormat?: string
}

/** ElevenLabs text-to-speech. `voice` is the voice id. Plain fetch; mp3 only. */
export const elevenlabsSpeech = <C = unknown>(
  options: ElevenLabsSpeechOptions<C>,
): Speech => {
  const base = (options.baseURL ?? "https://api.elevenlabs.io").replace(
    /\/+$/,
    "",
  )
  return {
    name: "elevenlabs",
    synthesize: (input) => {
      const { text, voice, format = "mp3" } = input
      const signal = input.signal
      return metered(
        options,
        { adapter: "elevenlabs", model: options.model, voice, text, input },
        async () => {
          if (format !== "mp3") {
            throw new SpeechError(
              `ElevenLabs speech supports mp3 here, not ${format}`,
            )
          }
          const url = `${base}/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=${encodeURIComponent(options.outputFormat ?? "mp3_44100_128")}`
          const response = await (options.fetch ?? fetch)(url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "xi-api-key": options.apiKey,
              accept: MIME.mp3,
            },
            body: JSON.stringify({
              text,
              ...(options.model ? { model_id: options.model } : {}),
              ...(options.voiceSettings
                ? { voice_settings: options.voiceSettings }
                : {}),
            }),
            signal,
          })
          if (!response.ok) {
            const detail = await response.text().catch(() => "")
            throw new SpeechError(
              `ElevenLabs speech failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`,
              response.status,
            )
          }
          return {
            audio: new Uint8Array(await response.arrayBuffer()),
            mime: MIME.mp3,
          }
        },
      )
    },
  }
}
