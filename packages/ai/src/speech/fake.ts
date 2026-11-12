import {
  MIME,
  SpeechError,
  metered,
  type Speech,
  type SpeechFormat,
  type SpeechOptions,
} from "./types"

/** One silent MPEG-1 Layer III frame: 128 kbps, 44.1 kHz, 417 bytes, about 26 ms. */
const MP3_FRAME = (() => {
  const frame = new Uint8Array(417)
  frame.set([0xff, 0xfb, 0x90, 0x64])
  return frame
})()

const silentMp3 = (frames: number) => {
  const out = new Uint8Array(MP3_FRAME.length * frames)
  for (let i = 0; i < frames; i++) out.set(MP3_FRAME, i * MP3_FRAME.length)
  return out
}

/** A silent 16-bit mono PCM WAV at 8 kHz. */
const silentWav = (seconds: number) => {
  const samples = Math.max(1, Math.round(seconds * 8000))
  const data = samples * 2
  const out = new Uint8Array(44 + data)
  const view = new DataView(out.buffer)
  const ascii = (at: number, text: string) =>
    [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)))
  ascii(0, "RIFF")
  view.setUint32(4, 36 + data, true)
  ascii(8, "WAVE")
  ascii(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, 8000, true)
  view.setUint32(28, 16000, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, "data")
  view.setUint32(40, data, true)
  return out
}

export type FakeSpeechOptions<C = unknown> = SpeechOptions<C> & {
  /** Fail every call with this message, for tests of the failure path. */
  failWith?: string
  /** Characters per second of pretend speech; default 15. */
  charsPerSecond?: number
}

/**
 * A speech adapter that makes a tiny valid silent mp3 or wav and never
 * touches a network. Reports usage like the real ones; `seconds` is the
 * length the text would take to say.
 */
export const fakeSpeech = <C = unknown>(
  options: FakeSpeechOptions<C> = {},
): Speech => ({
  name: "fake",
  synthesize: (input) => {
    const { text, voice, format = "mp3" } = input
    return metered(
      options,
      { adapter: "fake", voice, text, input },
      async () => {
        if (options.failWith) throw new SpeechError(options.failWith)
        const seconds = text.length / (options.charsPerSecond ?? 15)
        const audio =
          format === "wav"
            ? silentWav(Math.min(seconds, 2))
            : silentMp3(Math.max(1, Math.min(Math.ceil(seconds / 0.026), 40)))
        return {
          audio,
          mime: MIME[format as SpeechFormat] ?? MIME.mp3,
          seconds,
        }
      },
    )
  },
})
