import { describe, expect, it } from "vitest"
import { z } from "zod"

import { annotationsFor } from "./annotations"
import { defineTool } from "./define"
import { defineInnerTool, exactlyOne } from "./family"
import { ok } from "./outcome"
import {
  catalogueProblems,
  markedExactly,
  openObjects,
  unboundedIntegers,
  USE_THIS_WHEN,
} from "./testing"

const read = annotationsFor({ write: false })

const good = defineTool({
  name: "list_sites",
  title: "List sites",
  description: "Use this when you need the sites on the account.",
  input: z.object({
    limit: z.number().int().min(1).max(50).optional().describe("How many."),
  }),
  annotations: read,
  run: async () => ok("none"),
})

describe("annotationsFor", () => {
  it("sets all four hints from a tool's class of action", () => {
    expect(read).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    })
    expect(
      annotationsFor({ write: false, destructive: true, idempotent: false }),
    ).toEqual(read)
    expect(
      annotationsFor({ write: true, destructive: true, openWorld: true }),
    ).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    })
    expect(annotationsFor({ write: true, idempotent: true })).toMatchObject({
      destructiveHint: false,
      idempotentHint: true,
    })
  })
})

describe("catalogueProblems", () => {
  it("passes a well-made catalogue, served and inner tools alike", () => {
    const inner = defineInnerTool({
      name: "find",
      title: "Find",
      description: "Use this when you look for one thing.",
      input: z.object({
        ref: z.string().optional().describe("Where."),
        target: z.string().optional().describe("Or where, by name."),
      }),
      rules: [exactlyOne(["ref", "target"], "One of them.")],
      annotations: read,
    })

    expect(
      catalogueProblems([good, inner, inner.listed()], {
        descriptionStarts: USE_THIS_WHEN,
        boundedIntegers: true,
      }),
    ).toEqual(["find: the name is given twice"])
  })

  it("names every problem, a line each", () => {
    expect(
      catalogueProblems(
        [
          {
            name: "ghost_admin_passthrough",
            title: "",
            description: "Calls anything.",
            annotations: {
              readOnlyHint: true,
              destructiveHint: true,
              idempotentHint: true,
            },
            inputSchema: z.object({
              path: z.string(),
              n: z.number().int().describe("N."),
              body: z.object({ a: z.string().describe("A.") }).describe("B."),
            }),
          },
        ],
        {
          descriptionStarts: USE_THIS_WHEN,
          boundedIntegers: true,
          namePattern: /^[a-z][a-z0-9_]{2,20}$/,
        },
      ),
    ).toEqual([
      "ghost_admin_passthrough: the name does not match /^[a-z][a-z0-9_]{2,20}$/",
      "ghost_admin_passthrough: the name is like a passthrough (/passthrough/i)",
      "ghost_admin_passthrough: it has no title",
      'ghost_admin_passthrough: its description does not start "Use this when "',
      "ghost_admin_passthrough: openWorldHint is not set",
      "ghost_admin_passthrough: it is read only and destructive at once",
      "ghost_admin_passthrough: properties without a description: /path",
      "ghost_admin_passthrough: objects that take keys they do not name: /, /body",
      "ghost_admin_passthrough: integers with no realistic bounds: /n",
    ])
  })

  it("leaves the opening, closed objects and bounds to the options", () => {
    const loose = {
      name: "loose",
      title: "Loose",
      description: "Reads.",
      annotations: read,
      inputSchema: z.object({ n: z.number().int().describe("N.") }),
    }

    expect(catalogueProblems([loose], { closed: false })).toEqual([])
    expect(catalogueProblems([loose])).toEqual([
      "loose: objects that take keys they do not name: /",
    ])
  })

  it("reports a schema that cannot be made", () => {
    const missing = defineTool({
      name: "missing",
      title: "Missing",
      description: "Says nothing of x.",
      input: z.object({ x: z.string() }),
      annotations: read,
      run: async () => ok(""),
    })

    expect(catalogueProblems([missing])).toEqual([
      "missing: its input schema cannot be made: missing's input schema has properties without a description: /x.",
    ])
  })
})

describe("the schema walks", () => {
  it("take a map as closed, and see objects inside lists and unions", () => {
    expect(
      openObjects({
        type: "object",
        additionalProperties: false,
        properties: {
          vars: { type: "object", additionalProperties: {} },
          list: { type: "array", items: { type: "object" } },
          either: { anyOf: [{ type: "object", properties: {} }] },
        },
      }),
    ).toEqual(["/list/[]", "/either/anyOf/0"])
  })

  it("take an integer bounded by ±2^53 as unbounded", () => {
    expect(
      unboundedIntegers({
        type: "object",
        properties: {
          a: { type: "integer", minimum: 0, maximum: 10 },
          b: {
            type: "integer",
            minimum: -Number.MAX_SAFE_INTEGER,
            maximum: Number.MAX_SAFE_INTEGER,
          },
          c: { type: ["integer", "null"], exclusiveMinimum: 0, maximum: 3 },
        },
      }),
    ).toEqual(["/b"])
  })
})

describe("markedExactly", () => {
  it("holds a hint to the names listed for it", () => {
    const tools = [
      {
        name: "delete_post",
        annotations: annotationsFor({ write: true, destructive: true }),
      },
      { name: "create_post", annotations: annotationsFor({ write: true }) },
      {
        name: "update_post",
        annotations: annotationsFor({ write: true, destructive: true }),
      },
    ]

    expect(
      markedExactly(tools, "destructiveHint", [
        "delete_post",
        "create_post",
        "gone",
      ]),
    ).toEqual([
      "gone: listed as destructiveHint but not in the catalogue",
      "create_post: listed as destructiveHint but not marked",
      "update_post: marked destructiveHint but not listed",
    ])
    expect(
      markedExactly(tools, "destructiveHint", ["delete_post", "update_post"]),
    ).toEqual([])
  })
})
