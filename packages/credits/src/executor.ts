/**
 * How the stores reach the database: SQL with positional parameters, run as the server role.
 *
 * Every function that moves a balance checks the role Hasura names on the transaction
 * (`hasura.user`), so an executor that talks to Postgres directly sets it for each statement;
 * `pgExecutor` does that over a `pg` pool. An app that only has Hasura can implement the same
 * interface over its own SQL path; nothing else is asked of it.
 */

export type Executor = {
  query<ROW = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<ROW[]>
}

/** As much of a `pg` client as this needs. */
export type PgClientLike = {
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }>
  release(error?: Error | boolean): void
}

/** As much of a `pg` pool as this needs. */
export type PgPoolLike = { connect(): Promise<PgClientLike> }

/**
 * An executor over a `pg` pool: each statement in a transaction of its own, with the Hasura
 * session set to `role`, so the role checks in the SQL see the server.
 */
export const pgExecutor = (
  pool: PgPoolLike,
  options: { role: string },
): Executor => ({
  async query<ROW>(sql: string, params: readonly unknown[] = []) {
    const client = await pool.connect()
    let failed: Error | undefined
    try {
      await client.query("BEGIN")
      await client.query("SELECT set_config('hasura.user', $1, true)", [
        JSON.stringify({ "x-hasura-role": options.role }),
      ])
      const result = await client.query(sql, [...params])
      await client.query("COMMIT")
      return result.rows as ROW[]
    } catch (error) {
      failed = error as Error
      await client.query("ROLLBACK").catch(() => undefined)
      throw error
    } finally {
      client.release(failed)
    }
  },
})

/** The names a package's objects were rendered with. */
export type CreditNames = {
  /** The `prefix` template variable; `credit_` by default. */
  prefix?: string
  /** The `schema` template variable; `public` by default. */
  schema?: string
  /** The `usage_table` template variable; `credit_usage` by default. */
  usageTable?: string
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/

/** Qualified names for the SQL the stores write, checked so nothing can be spliced in. */
export const namesOf = (names: CreditNames = {}) => {
  const prefix = names.prefix ?? "credit_"
  const schema = names.schema ?? "public"
  const usage = names.usageTable ?? "credit_usage"
  ;[prefix || "x", schema, usage].forEach((name) => {
    if (!IDENTIFIER.test(name)) {
      throw new Error(`Not a plain SQL identifier: ${JSON.stringify(name)}`)
    }
  })
  return {
    /** `schema.prefix<name>`. */
    t: (name: string) => `${schema}.${prefix}${name}`,
    usage: `${schema}.${usage}`,
  }
}
