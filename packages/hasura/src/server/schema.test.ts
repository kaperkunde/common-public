import { buildSchema } from "graphql"
import { describe, expect, it, vi } from "vitest"

import {
  createSchemaCache,
  introspectSchema,
  schemaIndex,
  schemaText,
} from "./schema"

const schema = buildSchema(`
  """
  One thing that happened, from ts to endTs. Events chain through next.
  """
  type events { id: Int! }

  """
  A person in a world. Two halves are handed out.
  """
  type characters { id: String! }

  """
  columns and relationships of "stories"
  """
  type stories { id: String! }

  type characters_aggregate { count: Int }

  type query_root {
    events: [events!]!
    events_by_pk(id: Int!): events
    characters: [characters!]!
    characters_by_pk(id: String!): characters
    characters_aggregate: characters_aggregate!
    stories: [stories!]!
  }

  type mutation_root {
    delete_events(id: Int): events
    insert_events_one(object: Int): events
    update_events_by_pk(id: Int): events
    insert_characters_one(object: String): characters
  }

  schema { query: query_root, mutation: mutation_root }
`)

describe("schemaIndex", () => {
  const index = schemaIndex(schema)

  it("names every table once with what may be done to it", () => {
    expect(index).toContain("- **events** (read, insert, update, delete)")
    expect(index).toContain("- **characters** (read, count, insert)")
    expect(index).toContain("- **stories** (read)")
    expect(index).not.toContain("- **events_by_pk**")
    expect(index).not.toContain("- **characters_aggregate**")
  })

  it("keeps a description's first sentence and drops Hasura's boilerplate", () => {
    expect(index).toContain("-- One thing that happened, from ts to endTs.")
    expect(index).not.toContain("Events chain through next")
    expect(index).not.toContain("columns and relationships")
  })

  it("says which tables cannot be counted", () => {
    expect(index).toContain("No `_aggregate` on events, stories")
  })

  it("takes the app's own lines around the list", () => {
    const custom = schemaIndex(schema, { intro: ["HELLO"], outro: ["BYE"] })
    expect(custom.indexOf("HELLO")).toBeLessThan(
      custom.indexOf("## The tables"),
    )
    expect(custom.trim().endsWith("BYE")).toBe(true)
  })
})

describe("schemaText", () => {
  it("answers the index, one type, the whole schema or a correction", () => {
    expect(schemaText(schema)).toContain("# The graph, table by table")
    expect(schemaText(schema, "events")).toContain("type events")
    expect(schemaText(schema, "all")).toContain("type query_root")
    expect(schemaText(schema, "event")).toContain("Did you mean events")
    expect(schemaText(schema, "zzz")).toContain("No type named zzz")
  })
})

describe("introspectSchema and createSchemaCache", () => {
  it("builds the schema from an introspection answer", async () => {
    const { graphql, getIntrospectionQuery } = await import("graphql")
    const result = await graphql({
      schema,
      source: getIntrospectionQuery({ descriptions: true }),
    })
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ data: result.data })),
    )
    const built = await introspectSchema({
      endpoint: "http://h",
      token: "t",
      role: "user",
      fetch: fetchMock as unknown as typeof fetch,
    })
    expect(built.getType("events")).toBeDefined()
  })

  it("throws with Hasura's message when there is no data", async () => {
    await expect(
      introspectSchema({
        endpoint: "http://h",
        token: "t",
        role: "user",
        fetch: (async () =>
          new Response(
            JSON.stringify({ errors: [{ message: "bad jwt" }] }),
          )) as typeof fetch,
      }),
    ).rejects.toThrow("bad jwt")
  })

  it("keeps a schema until its time is up", async () => {
    let now = 0
    const cache = createSchemaCache(100, () => now)
    const loader = vi.fn(async () => schema)
    await cache.load("user", loader)
    await cache.load("user", loader)
    expect(loader).toHaveBeenCalledTimes(1)
    await cache.load("ai", loader)
    expect(loader).toHaveBeenCalledTimes(2)
    now = 200
    await cache.load("user", loader)
    expect(loader).toHaveBeenCalledTimes(3)
    cache.clear()
    await cache.load("user", loader)
    expect(loader).toHaveBeenCalledTimes(4)
  })
})
