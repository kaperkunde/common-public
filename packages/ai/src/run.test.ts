import { tool } from "ai"
import { z } from "zod"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createFakeLlm, type FakeLlm } from "./testing"
import { BackendRefusedError } from "./refusal"
import { createRunModel, type LlmUsageRow, type ModelRun } from "./run"
import type { TraceCall } from "./trace"

type Ctx = { user: string }

let llm: FakeLlm
beforeEach(async () => {
  llm = await createFakeLlm({ replies: [{ text: "Hello there." }] })
})
afterEach(async () => {
  await llm.close()
})

const backend = () => ({
  source: "hosted",
  baseURL: "",
  apiKey: "sekret-key",
  toolChoice: "auto" as const,
})

const base = (
  extra: Partial<ModelRun<Record<string, never>, Ctx>> = {},
): ModelRun<Record<string, never>, Ctx> => ({
  context: { user: "u1" },
  label: "greet",
  model: "fake-small",
  instructions: "Be brief.",
  messages: [{ role: "user", content: "Hi" }],
  tools: {},
  maxRetries: 0,
  ...extra,
})

const runner = (
  hooks: Partial<Parameters<typeof createRunModel<Ctx>>[0]> = {},
) =>
  createRunModel<Ctx>({
    backend: () => ({ ...backend(), baseURL: llm.baseURL }),
    ...hooks,
  })

describe("runModel", () => {
  it("answers, and reports usage in a finally with the provider's counts", async () => {
    const rows: LlmUsageRow<Ctx>[] = []
    const result = await runner({ onUsage: (row) => void rows.push(row) })(
      base(),
    )
    expect(result.text).toBe("Hello there.")
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      kind: "llm",
      context: { user: "u1" },
      model: "fake-small",
      source: "hosted",
      attempt: 0,
    })
    expect(rows[0]!.usage?.inputTokens).toBe(100)
    expect(rows[0]!.usage?.outputTokens).toBe(20)
    expect(rows[0]!.requests.requests).toHaveLength(1)
    expect(rows[0]!.requests.requests[0]).toMatchObject({
      inputTokens: 100,
      outputTokens: 20,
    })
    expect(rows[0]!.failure).toBeUndefined()
    expect(llm.seen()[0]?.prompt).toContain("Hi")
  })

  it("sends the instructions, with shared ones first", async () => {
    await runner()(base({ sharedInstructions: "SHARED" }))
    const prompt = llm.seen()[0]!.prompt
    expect(prompt.indexOf("SHARED")).toBeLessThan(prompt.indexOf("Be brief."))
  })

  it("words the instructions to match how the tool call is asked for", async () => {
    const shapes: string[] = []
    await runner()(
      base({
        instructions: (shape) => {
          shapes.push(shape.toolChoice)
          return "i"
        },
      }),
    )
    // the back end's own setting when the call names none
    expect(shapes).toEqual(["auto"])
  })

  it("refuses before anything is owed: beforeCall throws, onUsage is never called", async () => {
    const onUsage = vi.fn()
    const call = runner({
      beforeCall: () => {
        throw new BackendRefusedError("Out of credit.", { reason: "out" })
      },
      onUsage,
    })
    await expect(call(base())).rejects.toThrow("Out of credit.")
    expect(onUsage).not.toHaveBeenCalled()
    expect(llm.seen()).toHaveLength(0)
  })

  it("tells beforeCall which back end was chosen", async () => {
    const seen = vi.fn()
    await runner({ beforeCall: seen })(base())
    expect(seen).toHaveBeenCalledWith({
      context: { user: "u1" },
      model: "fake-small",
      attempt: 0,
      backend: expect.objectContaining({ source: "hosted" }),
    })
  })

  it("runs on the model the back end names when it does not offer the asked one", async () => {
    const rows: LlmUsageRow<Ctx>[] = []
    await runner({
      backend: () => ({
        ...backend(),
        baseURL: llm.baseURL,
        model: "fake-large",
      }),
      onUsage: (row) => void rows.push(row),
    })(base())
    expect(rows[0]!.model).toBe("fake-large")
    expect(llm.seen()[0]!.model).toBe("fake-large")
  })

  it("reports a failed call with its failure, redacting the key, and still throws it", async () => {
    await llm.close()
    llm = await createFakeLlm({
      failFirst: { count: 5, status: 400, message: "bad key sekret-key" },
    })
    const rows: LlmUsageRow<Ctx>[] = []
    const error = await runner({ onUsage: (row) => void rows.push(row) })(
      base(),
    ).catch((e) => e)
    expect(error).toBeInstanceOf(Error)
    expect(error.message).not.toContain("sekret-key")
    expect(rows).toHaveLength(1)
    expect(rows[0]!.failure).toContain("[redacted]")
  })

  it("asks the fallback model once when the first fails on the provider's account", async () => {
    await llm.close()
    llm = await createFakeLlm({
      failFirst: { count: 1, status: 503 },
      replies: [{ text: "from fallback" }],
    })
    const rows: LlmUsageRow<Ctx>[] = []
    const onFallback = vi.fn()
    const result = await runner({
      onUsage: (row) => void rows.push(row),
      onFallback,
    })(base({ fallbackModel: "fake-large" }))
    expect(result.text).toBe("from fallback")
    expect(rows.map((r) => [r.model, r.attempt, Boolean(r.failure)])).toEqual([
      ["fake-small", 0, true],
      ["fake-large", 1, false],
    ])
    expect(onFallback).toHaveBeenCalledWith(
      expect.objectContaining({ from: "fake-small", to: "fake-large" }),
    )
  })

  it("does not ask the fallback for a refusal that is not the model's trouble", async () => {
    await llm.close()
    llm = await createFakeLlm({ failFirst: { count: 3, status: 400 } })
    const rows: LlmUsageRow<Ctx>[] = []
    await expect(
      runner({ onUsage: (row) => void rows.push(row) })(
        base({ fallbackModel: "fake-large" }),
      ),
    ).rejects.toThrow()
    expect(rows).toHaveLength(1)
  })

  it("does not ask the fallback when the call was aborted or names itself", async () => {
    await llm.close()
    llm = await createFakeLlm({ failFirst: { count: 5, status: 503 } })
    const controller = new AbortController()
    controller.abort()
    await expect(
      runner()(
        base({ fallbackModel: "fake-large", abortSignal: controller.signal }),
      ),
    ).rejects.toThrow()
    await expect(
      runner()(base({ fallbackModel: "fake-small" })),
    ).rejects.toThrow()
  })

  it("lets the app decide what is fallback-worthy", async () => {
    await llm.close()
    llm = await createFakeLlm({
      failFirst: { count: 1, status: 400 },
      replies: [{ text: "ok" }],
    })
    const result = await runner({ fallbackWorthy: () => true })(
      base({ fallbackModel: "fake-large" }),
    )
    expect(result.text).toBe("ok")
  })

  it("never lets the books failing replace the call's own outcome", async () => {
    const result = await runner({
      onUsage: () => {
        throw new Error("db down")
      },
    })(base())
    expect(result.text).toBe("Hello there.")
  })

  it("hands a trace to the sink with the ledger reference, and tracing failures never matter", async () => {
    const traces: { call: TraceCall; usageRef?: string }[] = []
    await runner({
      onUsage: () => 42,
      trace: (call, info) =>
        void traces.push({ call, usageRef: info.usageRef }),
    })(base())
    expect(traces).toHaveLength(1)
    expect(traces[0]!.usageRef).toBe("42")
    expect(traces[0]!.call).toMatchObject({
      kind: "call",
      label: "greet",
      model: "fake-small",
      source: "hosted",
      usageRef: "42",
      usage: { input: 100, output: 20 },
    })
    expect(traces[0]!.call.messages[0]).toEqual({ role: "user", content: "Hi" })
    llm.queue({ text: "Hello there." })
    const result = await runner({
      trace: () => {
        throw new Error("sink down")
      },
    })(base())
    expect(result.text).toBe("Hello there.")
  })

  it("runs a tool loop and traces each step", async () => {
    await llm.close()
    llm = await createFakeLlm({
      script: (request) =>
        request.answeringATool
          ? { text: "done" }
          : { calls: [{ name: "lookup", args: { q: "x" } }] },
    })
    const traces: TraceCall[] = []
    const rows: LlmUsageRow<Ctx>[] = []
    const lookup = tool({
      description: "look up",
      inputSchema: z.object({ q: z.string() }),
      execute: async ({ q }) => `found ${q}`,
    })
    const result = await createRunModel<Ctx>({
      backend: () => ({ ...backend(), baseURL: llm.baseURL }),
      onUsage: (row) => void rows.push(row),
      trace: (call) => void traces.push(call),
    })({
      context: { user: "u" },
      model: "fake-small",
      instructions: "i",
      messages: [{ role: "user", content: "go" }],
      tools: { lookup },
      stopWhen: ({ steps }) => steps.length >= 3,
    })
    expect(result.text).toBe("done")
    expect(rows[0]!.requests.requests).toHaveLength(2)
    expect(traces[0]!.steps).toHaveLength(2)
    expect(traces[0]!.steps[0]!.calls[0]).toEqual({
      tool: "lookup",
      input: { q: "x" },
    })
    expect(traces[0]!.steps[0]!.results[0]).toEqual({
      tool: "lookup",
      output: "found x",
    })
  })

  it("streams each chunk and still answers like a plain call", async () => {
    const chunks: string[] = []
    const rows: LlmUsageRow<Ctx>[] = []
    const result = await runner({ onUsage: (row) => void rows.push(row) })(
      base({
        onStream: (chunk) => {
          if (chunk.type === "text-delta") chunks.push(chunk.text)
          throw new Error("a reader that cannot take a chunk")
        },
      }),
    )
    expect(chunks.join("")).toBe("Hello there.")
    expect(result.text).toBe("Hello there.")
    expect(rows[0]!.usage?.inputTokens).toBe(100)
  })

  it("throws a streamed call's error as a plain call would", async () => {
    await llm.close()
    llm = await createFakeLlm({
      failFirst: { count: 5, status: 400, message: "nope" },
    })
    await expect(
      runner()(base({ onStream: () => undefined })),
    ).rejects.toThrow()
  })

  it("accepts one fixed backend instead of a function", async () => {
    const result = await createRunModel<Ctx>({
      backend: { ...backend(), baseURL: llm.baseURL },
    })(base())
    expect(result.text).toBe("Hello there.")
  })
})
