import { Client, InMemoryTransport } from "@modelcontextprotocol/client"
import { McpServer } from "@modelcontextprotocol/server"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"

import { defineTool } from "./define"
import { longToolNames, wantsStream } from "./long"
import { registerTools, type ServeEvent } from "./serve"
import { written, writeOutput } from "./write"

const annotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

let events: ServeEvent[]
let finished: boolean
let client: Client

const slow = defineTool({
  name: "slow",
  title: "Slow",
  description: "Takes its time.",
  input: z.object({
    ms: z.number().int().min(0).max(5_000).describe("How long it takes."),
  }),
  output: writeOutput({ done: z.boolean().describe("Whether it is done.") }),
  annotations,
  long: {
    patienceMs: () => 80,
    progressEveryMs: 20,
    stillGoing: () =>
      written({
        text: "Still going; the draft lands on the chapter.",
        changed: [],
        pending: true,
        data: { done: false },
      }),
  },
  run: async ({ ms }) => {
    await sleep(ms)
    finished = true
    return written({
      text: "Done.",
      changed: [{ type: "chapter", id: "c1" }],
      data: { done: true },
    })
  },
})

const quick = defineTool({
  name: "quick",
  title: "Quick",
  description: "Sends its own progress.",
  input: z.object({}),
  annotations,
  run: async (_args, ctx) => {
    await ctx.progress(1, { total: 2, message: "half" })
    await ctx.progress(1, { message: "not again" })
    await ctx.progress(2, { total: 2 })
    return { type: "ok", value: ctx.wantsProgress ? "asked" : "not asked" }
  },
})

beforeEach(async () => {
  events = []
  finished = false
  const server = new McpServer({ name: "test", version: "1.0.0" })
  registerTools(server, [slow, quick], { report: (e) => events.push(e) })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await server.connect(serverSide)
  client = new Client({ name: "test", version: "1.0.0" })
  await client.connect(clientSide)
})

afterEach(async () => {
  await client.close()
})

describe("a long tool", () => {
  it("answers as ever when it finishes within its patience", async () => {
    const result = await client.callTool({
      name: "slow",
      arguments: { ms: 0 },
    })

    expect(result.structuredContent).toMatchObject({ ok: true, done: true })
    expect(result.structuredContent).not.toHaveProperty("pending")
  })

  it("answers that it is still going past its patience, and lands after", async () => {
    const result = await client.callTool({
      name: "slow",
      arguments: { ms: 300 },
    })

    expect(result.isError).toBeFalsy()
    expect(result.structuredContent).toEqual({
      ok: true,
      warnings: [],
      dryRun: false,
      pending: true,
      changed: [],
      unchanged: [],
      done: false,
    })
    expect(finished).toBe(false)

    await sleep(400)
    expect(finished).toBe(true)
    expect(events).toEqual([{ kind: "finished_late", tool: "slow", ok: true }])
  })

  it("sends progress while it runs to a client that asked", async () => {
    const seen: Array<{ progress: number; message?: string }> = []
    const result = await client.callTool(
      { name: "slow", arguments: { ms: 70 } },
      { onprogress: (progress) => seen.push(progress) },
    )

    expect(result.structuredContent).toMatchObject({ done: true })
    expect(seen.length).toBeGreaterThan(0)
    expect(seen[0]!.message).toMatch(/^Slow: still working, \d+s so far\.$/)
  })

  it("lets a run send its own progress, only ever upwards", async () => {
    const seen: Array<{ progress: number; total?: number; message?: string }> =
      []
    const asked = await client.callTool(
      { name: "quick", arguments: {} },
      { onprogress: (progress) => seen.push(progress) },
    )

    expect(asked.content).toEqual([{ type: "text", text: "asked" }])
    expect(seen.map((one) => one.progress)).toEqual([1, 2])
    expect(seen[0]).toMatchObject({ total: 2, message: "half" })

    const plain = await client.callTool({ name: "quick", arguments: {} })
    expect(plain.content).toEqual([{ type: "text", text: "not asked" }])
  })
})

describe("the route's half", () => {
  it("names the long tools", () => {
    expect(longToolNames([slow, quick])).toEqual(new Set(["slow"]))
  })

  it("streams only a long call that asked for progress", () => {
    const long = new Set(["slow"])
    const call = (meta?: Record<string, unknown>) => ({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "slow", arguments: {}, _meta: meta },
    })

    expect(wantsStream(call({ progressToken: 7 }), long)).toBe(true)
    expect(wantsStream(call(), long)).toBe(false)
    expect(
      wantsStream(
        { ...call({ progressToken: 7 }), method: "tools/list" },
        long,
      ),
    ).toBe(false)
    expect(wantsStream([call({ progressToken: 7 })], long)).toBe(false)
    expect(wantsStream(call({ progressToken: 7 }), new Set())).toBe(false)
  })
})
