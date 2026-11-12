import {
  buildClientSchema,
  getIntrospectionQuery,
  printSchema,
  printType,
  type GraphQLSchema,
  type IntrospectionQuery,
} from "graphql"

import { forwardGraphql, type ForwardOptions } from "./courier"

/**
 * The graph exactly as one role sees it, read by introspecting Hasura under a
 * token of that role.
 */
export const introspectSchema = async (
  options: ForwardOptions,
): Promise<GraphQLSchema> => {
  const result = await forwardGraphql(
    { query: getIntrospectionQuery({ descriptions: true }) },
    options,
  )
  if (!result.body.data) {
    throw new Error(
      result.body.errors?.[0]?.message ?? "Could not introspect the schema.",
    )
  }
  return buildClientSchema(result.body.data as IntrospectionQuery)
}

/** A small time-to-live cache for schemas, keyed by whatever the caller chooses (a role). */
export const createSchemaCache = (
  ttlMs = 10 * 60 * 1000,
  now: () => number = Date.now,
) => {
  const entries = new Map<string, { schema: GraphQLSchema; at: number }>()
  return {
    async load(
      key: string,
      loader: () => Promise<GraphQLSchema>,
    ): Promise<GraphQLSchema> {
      const hit = entries.get(key)
      if (hit && now() - hit.at < ttlMs) return hit.schema
      const schema = await loader()
      entries.set(key, { schema, at: now() })
      return schema
    },
    clear: () => entries.clear(),
  }
}

/**
 * The first sentence of a table's description. Hasura writes a boilerplate one
 * for a table nobody commented; that says nothing and is dropped.
 */
const firstSentence = (text: string | null | undefined) => {
  if (!text || /^columns and relationships of /.test(text)) return ""
  const stop = text.search(/\.\s/)
  return stop === -1 ? text.trim() : text.slice(0, stop + 1).trim()
}

const tableOf = (field: string) =>
  field
    .replace(/^(insert|update|delete)_/, "")
    .replace(/_(one|by_pk|many)$/, "")

const VERBS = ["insert", "update", "delete"]

export type SchemaIndexOptions = {
  /** Lines before the table list. */
  intro?: string[]
  /** Lines after it (example calls, house rules). */
  outro?: string[]
}

/**
 * The tables a role can reach and what it may do with each, read off the
 * schema itself so it cannot drift from the permissions. One line per table.
 */
export const schemaIndex = (
  schema: GraphQLSchema,
  options: SchemaIndexOptions = {},
): string => {
  const queries = Object.keys(schema.getQueryType()?.getFields() ?? {})
  const mutations = Object.keys(schema.getMutationType()?.getFields() ?? {})
  const tables = queries.filter(
    (name) => !name.endsWith("_by_pk") && !name.endsWith("_aggregate"),
  )
  const writes = new Map<string, Set<string>>()
  for (const field of mutations) {
    const table = tableOf(field)
    if (!writes.has(table)) writes.set(table, new Set())
    writes.get(table)?.add(field.split("_")[0] ?? "")
  }
  const uncounted = tables.filter(
    (table) => !queries.includes(`${table}_aggregate`),
  )
  const lines = tables.map((table) => {
    const wrote = writes.get(table)
    const may = [
      "read",
      queries.includes(`${table}_aggregate`) ? "count" : undefined,
    ]
      .concat(VERBS.filter((verb) => wrote?.has(verb)))
      .filter(Boolean)
      .join(", ")
    const says = firstSentence(schema.getType(table)?.description)
    return `- **${table}** (${may})${says ? ` -- ${says}` : ""}`
  })
  const [first] = tables
  return [
    "# The graph, table by table",
    "",
    ...(options.intro ?? []),
    ...(options.intro?.length ? [""] : []),
    "## The tables",
    "",
    ...lines,
    "",
    first
      ? `Ask for one type to see its columns: \`{"type": "${first}"}\`. The input types are named after it -- \`${first}_bool_exp\` to filter, \`${first}_order_by\` to sort, \`${first}_insert_input\` and \`${first}_set_input\` for what a write takes. \`{"type": "all"}\` prints the whole schema, which is long.`
      : undefined,
    uncounted.length > 0 ? "" : undefined,
    uncounted.length > 0
      ? `No \`_aggregate\` on ${uncounted.join(", ")}. Count what you fetched instead.`
      : undefined,
    ...(options.outro?.length ? ["", ...options.outro] : []),
  ]
    .filter((line) => line !== undefined)
    .join("\n")
}

/**
 * The index, one named type, or -- asked for by name -- the whole SDL. A type
 * nobody has is answered with what it might have meant.
 */
export const schemaText = (
  schema: GraphQLSchema,
  typeName?: string,
  options: SchemaIndexOptions = {},
): string => {
  if (!typeName) return schemaIndex(schema, options)
  if (typeName === "all") return printSchema(schema)
  const type = schema.getType(typeName)
  if (type) return printType(type)
  const wanted = typeName.toLowerCase().replace(/s$/, "")
  const near = Object.keys(schema.getTypeMap())
    .filter(
      (name) => !name.startsWith("__") && name.toLowerCase().includes(wanted),
    )
    .slice(0, 8)
  return near.length > 0
    ? `No type named ${typeName}. Did you mean ${near.join(", ")}?`
    : `No type named ${typeName}. Ask with no type at all for the index of what there is.`
}
