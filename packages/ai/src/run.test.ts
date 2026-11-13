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
  source: "deployment",
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
      source: "deployment",
      attempt: 0,
    })
    expect(rows[0]!.usage?.inputTokens).toBe(100)
    expect(rows[0]!.usage?.outputTokens).toBe(20)
    expect(rows[0]!.requests).toHaveLength(1)
    expect(rows[0]!.requests[0]).toMatchObject({
      inputTokens: 100,
      outputTokens: 20,
    })
    expect(rows[0]!.failure).toBeUndefined()
    expect(llm.seen()[0]?.prompt).toContain("Hi")
  })

  it("hands userId, purpose, scope, job and activity to both hooks, with the credits-shaped row", async () => {
    const rows: LlmUsageRow<Ctx>[] = []
    const before = vi.fn()
    await runner({ beforeCall: before, onUsage: (row) => void rows.push(row) })(
      base({
        userId: "u9",
        purpose: "chat",
        scopeId: "s1",
        jobId: "j1",
        activity: "Chatting",
      }),
    )
    expect(before).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u9",
        model: "fake-small",
        source: "deployment",
        purpose: "chat",
      }),
    )
    expect(rows[0]).toMatchObject({
      userId: "u9",
      purpose: "chat",
      scopeId: "s1",
      jobId: "j1",
      activity: "Chatting",
    })
    expect(rows[0]!.requests[0]).toMatchObject({
      reasoningTokens: 0,
      cacheWrite1hTokens: 0,
    })
    expect(rows[0]!.call.requests).toBe(rows[0]!.requests)
  })

  it("lets a refusal with a code propagate without a fallback", async () => {
    const refusal = Object.assign(new Error("out"), { code: "OUT_OF_CREDITS" })
    await expect(
      runner({
        beforeCall: () => {
          throw refusal
        },
      })(base({ fallbackModel: "fake-large" })),
    ).rejects.toBe(refusal)
    expect(llm.seen()).toHaveLength(0)
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
    expect(seen).toHaveBeenCalledWith(
      expect.objectContaining({
        context: { user: "u1" },
        model: "fake-small",
        attempt: 0,
        source: "deployment",
        backend: expect.objectContaining({ source: "deployment" }),
      }),
    )
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
      source: "deployment",
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
    expect(rows[0]!.requests).toHaveLength(2)
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

describe("runModel metering of failed attempts", () => {
  const lookup = tool({
    description: "look up",
    inputSchema: z.object({ q: z.string() }),
    execute: async ({ q }) => `found ${q}`,
  })
  /** Every request but the third asks for the tool again; the third is where it dies. */
  const loop = async (
    options: Parameters<typeof createFakeLlm>[0],
    run: Partial<ModelRun<{ lookup: typeof lookup }, Ctx>> = {},
    hooks: Partial<Parameters<typeof createRunModel<Ctx>>[0]> = {},
  ) => {
    await llm.close()
    llm = await createFakeLlm({
      script: () => ({ calls: [{ name: "lookup", args: { q: "x" } }] }),
      usage: { promptTokens: 50_000, completionTokens: 250 },
      ...options,
    })
    const rows: LlmUsageRow<Ctx>[] = []
    const call = createRunModel<Ctx>({
      backend: () => ({ ...backend(), baseURL: llm.baseURL }),
      onUsage: (row) => void rows.push(row),
      ...hooks,
    })({
      context: { user: "u" },
      model: "fake-small",
      instructions: "i",
      messages: [{ role: "user", content: "go" }],
      tools: { lookup },
      stopWhen: ({ steps }) => steps.length >= 5,
      maxRetries: 0,
      ...run,
    })
    return {
      rows,
      outcome: await call.then(
        () => undefined,
        (e) => e,
      ),
    }
  }
  const billed = { inputTokens: 50_000, outputTokens: 250 }

  it("reports the requests that finished before a plain call failed", async () => {
    const { rows, outcome } = await loop({
      failAfter: { after: 2, mode: "status", status: 500, message: "boom" },
    })
    expect(outcome).toBeInstanceOf(Error)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.requests).toHaveLength(2)
    expect(rows[0]!.requests[0]).toMatchObject(billed)
    expect(rows[0]!.call.requests).toHaveLength(2)
    expect(rows[0]).toMatchObject({ failed: true, failureKind: "error" })
    expect(rows[0]!.failure).toContain("boom")
  })

  it("reports the requests that finished before a streamed call was cut", async () => {
    const chunks: string[] = []
    const { rows, outcome } = await loop(
      { failAfter: { after: 2, mode: "cut" } },
      { onStream: (chunk) => void chunks.push(chunk.type) },
    )
    expect(outcome).toBeInstanceOf(Error)
    expect(chunks.length).toBeGreaterThan(0)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.requests).toHaveLength(2)
    expect(rows[0]).toMatchObject({ failed: true, failureKind: "error" })
  })

  it("reports the request that finished before a timeout, plain and streamed", async () => {
    for (const onStream of [undefined, () => undefined]) {
      const { rows, outcome } = await loop(
        { failAfter: { after: 1, mode: "hang" } },
        { timeoutMs: 400, onStream },
      )
      expect(outcome).toBeInstanceOf(Error)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.requests).toHaveLength(1)
      expect(rows[0]!.requests[0]).toMatchObject(billed)
      expect(rows[0]).toMatchObject({ failed: true, failureKind: "timeout" })
    }
  })

  it("reports the request that finished before the caller aborted", async () => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 400)
    const { rows, outcome } = await loop(
      { failAfter: { after: 1, mode: "hang" } },
      { abortSignal: controller.signal },
    )
    expect(outcome).toBeInstanceOf(Error)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.requests).toHaveLength(1)
    expect(rows[0]).toMatchObject({ failed: true, failureKind: "abort" })
  })

  it("meters the failed primary and the fallback that answers as two rows with their own requests", async () => {
    await llm.close()
    llm = await createFakeLlm({
      script: (request) =>
        request.model === "fake-large"
          ? request.answeringATool
            ? { text: "from fallback" }
            : { calls: [{ name: "lookup", args: { q: "y" } }] }
          : { calls: [{ name: "lookup", args: { q: "x" } }] },
      usage: { promptTokens: 50_000, completionTokens: 250 },
      failAfter: {
        model: "fake-small",
        after: 2,
        mode: "status",
        status: 503,
      },
    })
    const rows: LlmUsageRow<Ctx>[] = []
    const result = await createRunModel<Ctx>({
      backend: () => ({ ...backend(), baseURL: llm.baseURL }),
      onUsage: (row) => void rows.push(row),
    })({
      context: { user: "u" },
      model: "fake-small",
      fallbackModel: "fake-large",
      instructions: "i",
      messages: [{ role: "user", content: "go" }],
      tools: { lookup },
      stopWhen: ({ steps }) => steps.length >= 5,
      maxRetries: 0,
    })
    expect(result.text).toBe("from fallback")
    expect(
      rows.map((r) => [r.model, r.attempt, r.requests.length, r.failed]),
    ).toEqual([
      ["fake-small", 0, 2, true],
      ["fake-large", 1, 2, undefined],
    ])
    expect(rows[1]!.requests[0]).toMatchObject(billed)
  })

  it("leaves the success path as it was", async () => {
    const { rows, outcome } = await loop(
      {
        script: (request) =>
          request.answeringATool
            ? { text: "done" }
            : { calls: [{ name: "lookup", args: { q: "x" } }] },
      },
      {},
    )
    expect(outcome).toBeUndefined()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.requests).toHaveLength(2)
    expect(rows[0]!.failed).toBeUndefined()
    expect(rows[0]!.failureKind).toBeUndefined()
    expect(rows[0]!.failure).toBeUndefined()
  })
})
