import { describe, expect, it, vi } from "vitest"

import {
  MIME,
  SpeechError,
  elevenlabsSpeech,
  fakeSpeech,
  openaiSpeech,
  type SpeechUsageRow,
} from "./speech"

const reply = (bytes: number[], status = 200) =>
  vi.fn(async () => new Response(new Uint8Array(bytes), { status }))

describe("fakeSpeech", () => {
  it("makes a tiny silent mp3 and reports usage", async () => {
    const rows: SpeechUsageRow<{ id: number }>[] = []
    const speech = fakeSpeech({
      context: { id: 1 },
      onUsage: (row) => void rows.push(row),
    })
    const result = await speech.synthesize({ text: "Hello world", voice: "v" })
    expect(result.mime).toBe("audio/mpeg")
    expect(result.chars).toBe(11)
    expect(result.seconds).toBeCloseTo(11 / 15)
    expect(result.audio[0]).toBe(0xff)
    expect(result.audio[1]).toBe(0xfb)
    expect(result.audio.length % 417).toBe(0)
    expect(result.audio.length).toBeLessThan(20_000)
    expect(rows).toEqual([
      expect.objectContaining({
        kind: "tts_chars",
        adapter: "fake",
        voice: "v",
        chars: 11,
        context: { id: 1 },
      }),
    ])
  })

  it("makes a valid wav on request", async () => {
    const { audio, mime } = await fakeSpeech().synthesize({
      text: "hi",
      voice: "v",
      format: "wav",
    })
    expect(mime).toBe("audio/wav")
    expect(String.fromCharCode(...audio.slice(0, 4))).toBe("RIFF")
    expect(String.fromCharCode(...audio.slice(8, 12))).toBe("WAVE")
    const view = new DataView(audio.buffer)
    expect(view.getUint32(40, true)).toBe(audio.length - 44)
  })

  it("fails on demand, still reporting the failed call", async () => {
    const onUsage = vi.fn()
    const speech = fakeSpeech({ failWith: "down", onUsage })
    await expect(speech.synthesize({ text: "x", voice: "v" })).rejects.toThrow(
      "down",
    )
    expect(onUsage).toHaveBeenCalledWith(
      expect.objectContaining({ failure: "down", chars: 1 }),
    )
  })

  it("never lets a failing onUsage replace the outcome", async () => {
    const speech = fakeSpeech({
      onUsage: () => {
        throw new Error("books")
      },
    })
    await expect(
      speech.synthesize({ text: "x", voice: "v" }),
    ).resolves.toBeDefined()
  })
})

describe("openaiSpeech", () => {
  it("posts to /audio/speech with the model, voice and format", async () => {
    const fetchMock = reply([1, 2, 3])
    const rows: SpeechUsageRow[] = []
    const speech = openaiSpeech({
      apiKey: "k",
      model: "tts-1",
      baseURL: "http://h/v1/",
      fetch: fetchMock as unknown as typeof fetch,
      onUsage: (row) => void rows.push(row),
      speed: 1.1,
      instructions: "calm",
    })
    const result = await speech.synthesize({
      text: "abc",
      voice: "alloy",
      format: "opus",
    })
    expect(result).toEqual({
      audio: new Uint8Array([1, 2, 3]),
      mime: MIME.opus,
      chars: 3,
    })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe("http://h/v1/audio/speech")
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer k",
    )
    expect(JSON.parse(init.body as string)).toEqual({
      model: "tts-1",
      input: "abc",
      voice: "alloy",
      response_format: "opus",
      instructions: "calm",
      speed: 1.1,
    })
    expect(rows[0]).toMatchObject({
      adapter: "openai",
      model: "tts-1",
      voice: "alloy",
      chars: 3,
    })
  })

  it("defaults to mp3 on OpenAI's own base and reports a provider error", async () => {
    const fetchMock = vi.fn(async () => new Response("quota", { status: 429 }))
    const speech = openaiSpeech({
      apiKey: "k",
      model: "m",
      fetch: fetchMock as unknown as typeof fetch,
    })
    const error = await speech
      .synthesize({ text: "x", voice: "v" })
      .catch((e) => e)
    expect(error).toBeInstanceOf(SpeechError)
    expect(error).toMatchObject({ status: 429 })
    expect(error.message).toContain("quota")
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      "https://api.openai.com/v1/audio/speech",
    )
  })
})

describe("elevenlabsSpeech", () => {
  it("posts to the voice's text-to-speech path with the key header", async () => {
    const fetchMock = reply([9])
    const speech = elevenlabsSpeech({
      apiKey: "xi",
      model: "eleven_v2",
      voiceSettings: { stability: 0.5 },
      fetch: fetchMock as unknown as typeof fetch,
    })
    const result = await speech.synthesize({ text: "hello", voice: "voice/1" })
    expect(result.mime).toBe("audio/mpeg")
    expect(result.chars).toBe(5)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe(
      "https://api.elevenlabs.io/v1/text-to-speech/voice%2F1?output_format=mp3_44100_128",
    )
    expect((init.headers as Record<string, string>)["xi-api-key"]).toBe("xi")
    expect(JSON.parse(init.body as string)).toEqual({
      text: "hello",
      model_id: "eleven_v2",
      voice_settings: { stability: 0.5 },
    })
  })

  it("only does mp3 and reports a provider error", async () => {
    const speech = elevenlabsSpeech({
      apiKey: "x",
      fetch: reply([], 401) as unknown as typeof fetch,
    })
    await expect(
      speech.synthesize({ text: "x", voice: "v", format: "wav" }),
    ).rejects.toThrow(/mp3/)
    await expect(
      speech.synthesize({ text: "x", voice: "v" }),
    ).rejects.toMatchObject({ status: 401 })
  })
})
