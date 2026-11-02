import { z } from "zod"

import {
  childSchemas,
  isToolName,
  undescribedProperties,
  type ToolAnnotations,
} from "./define"

/**
 * Checks of a whole catalogue of tools, for an app's unit tests:
 *
 *   expect(catalogueProblems(TOOLS, { descriptionStarts: USE_THIS_WHEN }))
 *     .toEqual([])
 *
 * Every problem is one line naming the tool. A tool is anything shaped like
 * one: a defineTool or defineInnerTool tool, a ListedTool, or a definition
 * whose inputSchema is still a zod object.
 */

type Json = Record<string, unknown>

/** The opening plek.je's and the Directory review's descriptions share. */
export const USE_THIS_WHEN = "Use this when "

/** A name that says it hands anything through. */
export const PASSTHROUGH = /passthrough/i

export type CatalogueTool = {
  name: string
  title?: string
  description: string
  annotations?: Partial<ToolAnnotations>
  inputSchema: Json | (() => Json) | z.ZodType
  outputSchema?: Json | (() => Json | undefined)
}

export type CatalogueOptions = {
  /** Every description starts with this: USE_THIS_WHEN, say. */
  descriptionStarts?: string
  /** The shortest description, in characters; 1 by default. */
  minDescription?: number
  /** Names must also match this, beyond MCP's own rule. */
  namePattern?: RegExp
  /** Names that must not appear; PASSTHROUGH by default. */
  forbiddenNames?: RegExp
  /** Every object in an input schema is closed. True by default. */
  closed?: boolean
  /** Every integer in an input schema has both bounds. False by default. */
  boundedIntegers?: boolean
}

const HINTS = [
  "readOnlyHint",
  "destructiveHint",
  "idempotentHint",
  "openWorldHint",
] as const

function isRecord(value: unknown): value is Json {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function jsonOf(schema: CatalogueTool["inputSchema"]): Json | undefined {
  if (typeof schema === "function") {
    return schema()
  }

  if (schema instanceof z.ZodType) {
    return z.toJSONSchema(schema, {
      target: "draft-2020-12",
      io: "input",
      unrepresentable: "any",
    }) as Json
  }

  return schema
}

/** Objects that take keys they do not name, by path. A map is not one. */
export function openObjects(schema: Json, at = ""): string[] {
  const open: string[] = []
  const map =
    !isRecord(schema.properties) &&
    (isRecord(schema.additionalProperties) ||
      isRecord(schema.patternProperties))

  if (
    schema.type === "object" &&
    schema.additionalProperties !== false &&
    !map
  ) {
    open.push(at || "/")
  }

  for (const [child, path] of childSchemas(schema, at)) {
    open.push(...openObjects(child, path))
  }

  return open
}

/** Integers bounded by nothing (or by ±2^53 alone), by path. */
export function unboundedIntegers(schema: Json, at = ""): string[] {
  const found: string[] = []
  const types = Array.isArray(schema.type) ? schema.type : [schema.type]
  const bound = (value: unknown) =>
    typeof value === "number" && Math.abs(value) < Number.MAX_SAFE_INTEGER

  if (
    types.includes("integer") &&
    !(
      (bound(schema.minimum) || bound(schema.exclusiveMinimum)) &&
      (bound(schema.maximum) || bound(schema.exclusiveMaximum))
    )
  ) {
    found.push(at || "/")
  }

  for (const [child, path] of childSchemas(schema, at)) {
    found.push(...unboundedIntegers(child, path))
  }

  return found
}

/** What is wrong with one tool. */
export function toolProblems(
  tool: CatalogueTool,
  options: CatalogueOptions = {},
): string[] {
  const {
    descriptionStarts,
    minDescription = 1,
    namePattern,
    forbiddenNames = PASSTHROUGH,
    closed = true,
    boundedIntegers = false,
  } = options
  const name = tool.name
  const problems: string[] = []
  const say = (problem: string) => problems.push(`${name}: ${problem}`)

  if (!isToolName(name)) {
    say("the name is not one MCP allows (1 to 128 of A-Z a-z 0-9 _ . -)")
  }

  if (namePattern && !namePattern.test(name)) {
    say(`the name does not match ${namePattern}`)
  }

  if (forbiddenNames.test(name)) {
    say(`the name is like a passthrough (${forbiddenNames})`)
  }

  if (!tool.title?.trim()) {
    say("it has no title")
  }

  if (tool.description.trim().length < minDescription) {
    say(`its description is shorter than ${minDescription} characters`)
  }

  if (descriptionStarts && !tool.description.startsWith(descriptionStarts)) {
    say(`its description does not start "${descriptionStarts}"`)
  }

  for (const hint of HINTS) {
    if (typeof tool.annotations?.[hint] !== "boolean") {
      say(`${hint} is not set`)
    }
  }

  if (tool.annotations?.readOnlyHint && tool.annotations.destructiveHint) {
    say("it is read only and destructive at once")
  }

  let input: Json | undefined

  try {
    input = jsonOf(tool.inputSchema)
  } catch (error) {
    say(
      `its input schema cannot be made: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  if (input) {
    if (input.type !== "object") {
      say("its input schema is not an object")
    }

    const undescribed = undescribedProperties(input)

    if (undescribed.length > 0) {
      say(`properties without a description: ${undescribed.join(", ")}`)
    }

    const open = closed ? openObjects(input) : []

    if (open.length > 0) {
      say(`objects that take keys they do not name: ${open.join(", ")}`)
    }

    const unbounded = boundedIntegers ? unboundedIntegers(input) : []

    if (unbounded.length > 0) {
      say(`integers with no realistic bounds: ${unbounded.join(", ")}`)
    }
  }

  const output =
    typeof tool.outputSchema === "function"
      ? tool.outputSchema()
      : tool.outputSchema

  if (output && output.type !== "object") {
    say("its output schema is not an object")
  }

  return problems
}

/** What is wrong with a catalogue: each tool, and names given twice. */
export function catalogueProblems(
  tools: readonly CatalogueTool[],
  options: CatalogueOptions = {},
): string[] {
  const seen = new Set<string>()
  const problems: string[] = []

  for (const tool of tools) {
    if (seen.has(tool.name)) {
      problems.push(`${tool.name}: the name is given twice`)
    }

    seen.add(tool.name)
    problems.push(...toolProblems(tool, options))
  }

  return problems
}

/**
 * Whether exactly the tools named carry `hint`, so a new tool is classified
 * on purpose rather than by default: a tool marked and not listed, listed
 * and not marked, or listed and not in the catalogue is a problem.
 */
export function markedExactly(
  tools: readonly Pick<CatalogueTool, "name" | "annotations">[],
  hint: keyof ToolAnnotations,
  names: readonly string[],
): string[] {
  const listed = new Set(names)
  const known = new Set(tools.map((tool) => tool.name))
  const problems: string[] = []

  for (const name of listed) {
    if (!known.has(name)) {
      problems.push(`${name}: listed as ${hint} but not in the catalogue`)
    }
  }

  for (const tool of tools) {
    const marked = tool.annotations?.[hint] === true

    if (marked && !listed.has(tool.name)) {
      problems.push(`${tool.name}: marked ${hint} but not listed`)
    } else if (!marked && listed.has(tool.name)) {
      problems.push(`${tool.name}: listed as ${hint} but not marked`)
    }
  }

  return problems
}
