import { Client, InMemoryTransport } from "@modelcontextprotocol/client"
import { McpServer } from "@modelcontextprotocol/server"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"

import { defineTool } from "./define"
import { ok } from "./outcome"
import { invalidArgumentsMessage, issuesOf } from "./protocol-error"
import { registerTool, registerTools, type CallLine } from "./serve"

const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
}

const input = z.object({
  text: z.string().max(5).describe("What to say."),
  nested: z
    .object({ n: z.number().int().min(1).max(5).describe("How many.") })
    .optional()
    .describe("Options."),
})

let client: Client
let lines: CallLine[]
let ran: unknown[]

const connect = async (
  mode: "tool-result" | "protocol-error" | undefined,
  perTool?: boolean,
) => {
  lines = []
  ran = []
  const server = new McpServer({ name: "test", version: "1.0.0" })
  registerTools(
    server,
    [
      defineTool({
        name: "echo",
        title: "Echo",
        description: "Says it back.",
        input,
        annotations,
        ...(perTool ? { invalidArgs: mode } : {}),
        run: async (args) => {
          ran.push(args)
          return ok(args.text)
        },
      }),
    ],
    {
      log: (line) => lines.push(line),
      report: () => {},
      ...(perTool ? {} : { invalidArgs: mode }),
    },
  )
  const [a, b] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: "c", version: "1.0.0" })
  await Promise.all([server.connect(a), client.connect(b)])
}

afterEach(async () => {
  await client.close()
})

describe("invalidArgs: protocol-error", () => {
  beforeEach(async () => {
    await connect("protocol-error")
  })

  it("answers arguments that do not fit as a -32602 with every path, unknown key and allowed key", async () => {
    const error = await client
      .callTool({
        name: "echo",
        arguments: { text: "far too long", extra: 1, nested: { n: 9, q: 1 } },
      })
      .catch((e) => e)
    expect(error).toBeInstanceOf(Error)
    expect(error.code).toBe(-32602)
    expect(error.message).toContain("Invalid arguments for echo:")
    expect(error.data.tool).toBe("echo")
    const issues = error.data.issues as {
      path: string
      problem: string
      keys?: string[]
      allowed?: string[]
    }[]
    expect(issues.length).toBeGreaterThanOrEqual(3)
    expect(issues.find((i) => i.keys?.[0] === "extra")).toMatchObject({
      path: "",
      allowed: ["text", "nested"],
    })
    expect(issues.find((i) => i.keys?.[0] === "q")).toMatchObject({
      path: "nested",
      allowed: ["n"],
    })
    expect(issues.some((i) => i.path === "text")).toBe(true)
    expect(ran).toEqual([])
  })

  it("still logs the failed call, and still runs a call that fits", async () => {
    await client
      .callTool({ name: "echo", arguments: { text: "x", extra: 1 } })
      .catch(() => undefined)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      tool: "echo",
      ok: false,
      code: "invalid_arguments",
    })
    const good = await client.callTool({
      name: "echo",
      arguments: { text: "hi" },
    })
    expect(good.isError).toBeFalsy()
    expect(ran).toEqual([{ text: "hi" }])
  })

  it("reports a missing required argument the same way", async () => {
    const error = await client
      .callTool({ name: "echo", arguments: {} })
      .catch((e) => e)
    expect(error.code).toBe(-32602)
    expect(error.data.issues[0].problem).toContain("missing")
  })
})

describe("invalidArgs: tool-result (the default)", () => {
  it("answers as a tool result, as before, whether named or not", async () => {
    for (const mode of [undefined, "tool-result" as const]) {
      await connect(mode)
      const result = await client.callTool({
        name: "echo",
        arguments: { text: "x", extra: 1 },
      })
      expect(result.isError).toBe(true)
      expect(JSON.stringify(result.content)).toContain(
        "do not fit echo's inputSchema",
      )
      await client.close()
    }
    await connect(undefined)
  })
})

describe("a tool's own invalidArgs", () => {
  it("overrides the serve option", async () => {
    await connect("protocol-error", true)
    const error = await client
      .callTool({ name: "echo", arguments: { text: "x", extra: 1 } })
      .catch((e) => e)
    expect(error.code).toBe(-32602)
  })
})

describe("issuesOf and invalidArgumentsMessage", () => {
  it("reads the unknown keys and what is allowed out of validate's words", () => {
    expect(
      issuesOf([
        '"zz" is not an argument of this tool (it takes: a, n).',
        '"n/q" is not a key the inputSchema allows in "n" (it takes: b).',
        '"a" is integer, but the inputSchema says string.',
        "The arguments are not an object.",
        '"x" is not an argument of this tool (it takes: none).',
      ]),
    ).toEqual([
      {
        path: "",
        problem: '"zz" is not an argument of this tool (it takes: a, n).',
        keys: ["zz"],
        allowed: ["a", "n"],
      },
      {
        path: "n",
        problem:
          '"n/q" is not a key the inputSchema allows in "n" (it takes: b).',
        keys: ["q"],
        allowed: ["b"],
      },
      {
        path: "a",
        problem: '"a" is integer, but the inputSchema says string.',
      },
      { path: "", problem: "The arguments are not an object." },
      {
        path: "",
        problem: '"x" is not an argument of this tool (it takes: none).',
        keys: ["x"],
        allowed: [],
      },
    ])
    expect(invalidArgumentsMessage("t", ["a.", "b."])).toBe(
      "Invalid arguments for t: a. b.",
    )
  })
})

describe("registering", () => {
  const tool = () =>
    defineTool({
      name: "echo",
      title: "Echo",
      description: "Says it back.",
      input,
      annotations,
      invalidArgs: "protocol-error",
      run: async (args) => ok(args.text),
    })

  it("serves tools/list with each tool's schemas, annotations and meta, and refuses an unknown tool", async () => {
    const server = new McpServer({ name: "test", version: "1.0.0" })
    registerTools(
      server,
      [
        tool(),
        defineTool({
          name: "other",
          title: "Other",
          description: "Counts.",
          input: z.object({}),
          output: z.object({ n: z.number() }),
          annotations,
          meta: { a: 1 },
          run: async () => ok({ n: 1 }),
        }),
      ],
      { report: () => {} },
    )
    const [a, b] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: "c", version: "1.0.0" })
    await Promise.all([server.connect(a), client.connect(b)])
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toEqual(["echo", "other"])
    expect(tools[0]?.inputSchema.additionalProperties).toBe(false)
    expect(tools[1]?.outputSchema).toBeDefined()
    expect(tools[1]?._meta).toEqual({ a: 1 })
    expect(tools[0]?.annotations).toMatchObject({ readOnlyHint: true })
    const result = await client.callTool({ name: "other", arguments: {} })
    expect(result.structuredContent).toEqual({ n: 1 })
    const missing = await client
      .callTool({ name: "nope", arguments: {} })
      .catch((e) => e)
    expect(missing.code).toBe(-32602)
    expect(missing.message).toContain("echo, other")
  })

  it("refuses a name given twice, and registerTool on its own for such a tool", async () => {
    const server = new McpServer({ name: "test", version: "1.0.0" })
    expect(() => registerTools(server, [tool(), tool()])).toThrow(
      /defined twice/,
    )
    expect(() => registerTool(server, tool())).toThrow(/registerTools/)
    const [a, b] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: "c", version: "1.0.0" })
    await Promise.all([server.connect(a), client.connect(b)])
  })
})
