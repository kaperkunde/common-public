import type { QueueCalls, Transport } from "./types"

export type QueueNames = {
  /** The `prefix` the migration was rendered with. Default empty. */
  prefix?: string
  /** The `jobs_table` it was rendered with. Default `jobs`. */
  table?: string
  /** The `scope_column` it was rendered with. Default `scope_id`. */
  scopeColumn?: string
}

const COLUMNS = [
  "id",
  "status",
  "source",
  "reason",
  "attempts",
  "run_after",
  "claimed_at",
  "leased_until",
  "finished_at",
  "wrote",
  "outcome",
  "attempt",
  "payload",
  "created_at",
]

/** Each function's arguments with their GraphQL types (Hasura's scalars for SQL's). */
const ARG_TYPES = (
  scopeType: string,
): { [K in keyof QueueCalls]: Record<string, string> } => ({
  enqueue: {
    job_scope: `${scopeType}!`,
    job_source: "String!",
    job_reason: "String!",
    job_payload: "jsonb",
    delay_seconds: "Int",
  },
  claim: { lease_seconds: "Int!" },
  heartbeat: { job_id: "bigint!", lease_seconds: "Int!" },
  finish: {
    job_id: "bigint!",
    job_status: "String!",
    job_wrote: "Boolean!",
    job_outcome: "String!",
    job_attempt: "String",
  },
  mark_attempt: { job_id: "bigint!", job_attempt: "String!" },
  reclaim: { repeat_window_seconds: "Int" },
  sweep: { retention_days: "Int" },
})

/** Executes a GraphQL document and returns its `data`; `ServerClient.execute` from `@kaperkunde/hasura/server` fits. */
export type GraphqlExecutor = (
  query: string,
  variables?: Record<string, unknown>,
) => Promise<Record<string, unknown>>

export type GraphqlTransportOptions = QueueNames & {
  execute: GraphqlExecutor
  /** The GraphQL type of the scope argument, when it is not text. Default `String`. */
  scopeGraphqlType?: string
}

/**
 * The queue over Hasura's GraphQL: every function is a mutation, run as the
 * server role by the executor you hand in.
 */
export const graphqlTransport = (
  options: GraphqlTransportOptions,
): Transport => {
  const base = `${options.prefix ?? ""}${options.table ?? "jobs"}`
  const scopeColumn = options.scopeColumn ?? "scope_id"
  const types = ARG_TYPES(options.scopeGraphqlType ?? "String")
  const selection = [scopeColumn, ...COLUMNS].join(" ")
  return {
    scopeColumn,
    async call(fn, args) {
      const field = `${base}_${fn}`
      const declared = types[fn]
      const names = Object.keys(args)
      const header = names
        .map((name) => `$${name}: ${declared[name]}`)
        .join(", ")
      const passed = names.map((name) => `${name}: $${name}`).join(", ")
      const query = `mutation Queue_${fn}(${header}) { ${field}(args: {${passed}}) { ${selection} } }`
      const data = await options.execute(query, args as Record<string, unknown>)
      const rows = data[field]
      return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : []
    },
  }
}

/** A SQL executor: one transaction at a time, parameters as `$1`, `$2`. */
export type SqlExecutor = {
  transaction: <T>(
    run: (
      query: (
        sql: string,
        params?: unknown[],
      ) => Promise<Record<string, unknown>[]>,
    ) => Promise<T>,
  ) => Promise<T>
}

export type SqlTransportOptions = QueueNames & {
  sql: SqlExecutor
  /** The schema the migration was rendered into. Default `public`. */
  schema?: string
  /** The `server_role` the functions check for. Default `server`. */
  serverRole?: string
}

const SQL_ARGS: { [K in keyof QueueCalls]: { name: string; cast: string }[] } =
  {
    enqueue: [
      { name: "job_scope", cast: "" },
      { name: "job_source", cast: "text" },
      { name: "job_reason", cast: "text" },
      { name: "job_payload", cast: "jsonb" },
      { name: "delay_seconds", cast: "integer" },
    ],
    claim: [{ name: "lease_seconds", cast: "integer" }],
    heartbeat: [
      { name: "job_id", cast: "bigint" },
      { name: "lease_seconds", cast: "integer" },
    ],
    finish: [
      { name: "job_id", cast: "bigint" },
      { name: "job_status", cast: "text" },
      { name: "job_wrote", cast: "boolean" },
      { name: "job_outcome", cast: "text" },
      { name: "job_attempt", cast: "text" },
    ],
    mark_attempt: [
      { name: "job_id", cast: "bigint" },
      { name: "job_attempt", cast: "text" },
    ],
    reclaim: [{ name: "repeat_window_seconds", cast: "integer" }],
    sweep: [{ name: "retention_days", cast: "integer" }],
  }

/**
 * The queue over plain SQL, for a worker that talks to Postgres directly.
 * Each call is one transaction that first tells the function it is the server
 * role, as Hasura would.
 */
export const sqlTransport = (options: SqlTransportOptions): Transport => {
  const schema = options.schema ?? "public"
  const base = `${options.prefix ?? ""}${options.table ?? "jobs"}`
  const scopeColumn = options.scopeColumn ?? "scope_id"
  const claims = JSON.stringify({
    "x-hasura-role": options.serverRole ?? "server",
  })
  return {
    scopeColumn,
    call(fn, args) {
      const spec = SQL_ARGS[fn]
      const values = spec.map(
        ({ name }) => (args as Record<string, unknown>)[name],
      )
      const placeholders = spec.map(({ name, cast }, i) => {
        const marker = `$${i + 1}`
        const nullable = name === "job_payload" || name === "job_attempt"
        const needsCast = cast && (nullable || cast !== "text")
        return needsCast ? `${marker}::${cast}` : marker
      })
      const call = `SELECT * FROM "${schema}"."${base}_${fn}"(${placeholders.join(", ")})`
      return options.sql.transaction(async (query) => {
        await query("SELECT set_config('hasura.user', $1, true)", [claims])
        return query(
          call,
          values.map((value, i) =>
            spec[i]?.cast === "jsonb" && value !== null && value !== undefined
              ? JSON.stringify(value)
              : value,
          ),
        )
      })
    },
  }
}
