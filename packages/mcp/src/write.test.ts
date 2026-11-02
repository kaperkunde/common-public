import { Client, InMemoryTransport } from "@modelcontextprotocol/client"
import { McpServer } from "@modelcontextprotocol/server"
import { describe, expect, it } from "vitest"
import { z } from "zod"

import { defineTool, toolJsonSchema } from "./define"
import { errorCodeOf, toCallToolResult } from "./outcome"
import { registerTool } from "./serve"
import {
  answered,
  notWritten,
  readOutput,
  refSchema,
  refused,
  writeOutput,
  written,
} from "./write"

const output = writeOutput({
  moved: z.array(z.number().int()).describe("What moved."),
})

describe("the output schemas", () => {
  it("require the shared fields, and leave the tool's own optional", () => {
    const json = toolJsonSchema(output, "output")

    expect(json.required).toEqual(
      expect.arrayContaining([
        "ok",
        "warnings",
        "dryRun",
        "changed",
        "unchanged",
      ]),
    )
    expect(json.required).not.toContain("moved")
    expect(toolJsonSchema(readOutput({}), "output").required).toEqual([
      "ok",
      "warnings",
    ])
  })

  it("narrow a ref's type to the app's own kinds", () => {
    const ref = refSchema(["event", "chapter"])

    expect(ref.safeParse({ type: "event", id: 3 }).success).toBe(true)
    expect(ref.safeParse({ type: "post", id: 3 }).success).toBe(false)
  })
})

describe("written", () => {
  it("says what changed, and the warnings in the words too", () => {
    const outcome = written({
      text: "Moved 1.",
      changed: [{ type: "event", id: 2 }],
      warnings: ["Mind the gap."],
      data: { moved: [2] },
    })
    const result = toCallToolResult(outcome, { structured: true })

    expect(result.structuredContent).toEqual({
      ok: true,
      warnings: ["Mind the gap."],
      dryRun: false,
      changed: [{ type: "event", id: 2 }],
      unchanged: [],
      moved: [2],
    })
    expect(result.content).toEqual([
      { type: "text", text: "Moved 1.\n\nNote: Mind the gap." },
    ])
    expect(output.safeParse(result.structuredContent).success).toBe(true)
  })

  it("never reports a write that changed nothing as success", () => {
    const outcome = written({
      text: "No change: event 9 is already there.",
      changed: [],
      unchanged: [{ type: "event", id: 9, detail: "already there" }],
    })
    const result = toCallToolResult(outcome, { structured: true })

    expect(result.isError).toBe(true)
    expect(errorCodeOf(result)).toBe("no_change")
    expect(result.structuredContent).toEqual({
      ok: false,
      code: "no_change",
      error: "No change: event 9 is already there.",
      warnings: [],
      dryRun: false,
      changed: [],
      unchanged: [{ type: "event", id: 9, detail: "already there" }],
    })
    expect(output.safeParse(result.structuredContent).success).toBe(true)

    // A dry run that would change nothing is no change either; one still
    // going has not said yet.
    expect(written({ text: "x", changed: [], dryRun: true })).toMatchObject({
      code: "no_change",
    })
    expect(written({ text: "x", changed: [], pending: true })).toMatchObject({
      type: "ok",
    })
  })

  it("does not say a warning twice", () => {
    const result = toCallToolResult(
      notWritten("refused", "Refused: it is locked.", {
        warnings: ["it is locked"],
      }),
    )

    expect(result.content).toEqual([
      { type: "text", text: "Refused: it is locked." },
    ])
  })
})

describe("reads", () => {
  it("answer ok with warnings, or a code", () => {
    expect(
      toCallToolResult(answered({ text: "Two.", data: { n: 2 } }), {
        structured: true,
      }).structuredContent,
    ).toEqual({ ok: true, warnings: [], n: 2 })
    expect(
      toCallToolResult(refused("not_found", "No such chapter."), {
        structured: true,
      }),
    ).toMatchObject({
      isError: true,
      structuredContent: {
        ok: false,
        code: "not_found",
        error: "No such chapter.",
        warnings: [],
      },
    })
  })
})

describe("over the wire", () => {
  it("answers what the SDK's own client reads against the listed schema", async () => {
    const server = new McpServer({ name: "test", version: "1.0.0" })
    registerTool(
      server,
      defineTool({
        name: "move_things",
        title: "Move things",
        description: "Moves things.",
        input: z.object({
          ids: z.array(z.number().int().min(1)).describe("Which."),
        }),
        output,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
        meta: { "example/defined-by": "defineTool" },
        run: async ({ ids }) =>
          ids.includes(9)
            ? notWritten("no_change", "Event 9 is already there.", {
                unchanged: [{ type: "event", id: 9 }],
              })
            : written({
                text: `Moved ${ids.length}.`,
                changed: ids.map((id) => ({ type: "event", id })),
                data: { moved: ids },
              }),
      }),
      { report: () => {} },
    )
    const client = new Client({ name: "test", version: "1.0.0" })
    const [near, far] = InMemoryTransport.createLinkedPair()
    await Promise.all([server.connect(far), client.connect(near)])

    const { tools } = await client.listTools()
    expect(tools[0]!._meta).toEqual({ "example/defined-by": "defineTool" })
    expect(tools[0]!.outputSchema?.type).toBe("object")

    const done = await client.callTool({
      name: "move_things",
      arguments: { ids: [3] },
    })
    expect(done.structuredContent).toMatchObject({ ok: true, moved: [3] })

    const none = await client.callTool({
      name: "move_things",
      arguments: { ids: [9] },
    })
    expect(none.isError).toBe(true)
    expect(none.structuredContent).toMatchObject({ code: "no_change" })

    const wrong = await client.callTool({
      name: "move_things",
      arguments: { ids: [3], from: "x" },
    })
    expect(wrong.isError).toBe(true)
    expect(wrong._meta?.["kaperkunde/error"]).toEqual({
      code: "invalid_arguments",
    })

    await client.close()
  })
})
