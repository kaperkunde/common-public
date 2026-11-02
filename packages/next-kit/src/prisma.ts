import { readdir } from "node:fs/promises"
import path from "node:path"

/**
 * The parts of a MariaDB/MySQL Prisma setup every app repeats. The client
 * itself is generated per app, so the app passes its own `PrismaClient` and
 * adapter in; nothing here imports Prisma.
 */

export type MariaDbOptions = {
  host: string
  port: number
  user: string
  password: string
  database: string
  connectionLimit: number
  allowPublicKeyRetrieval: boolean
  timezone?: string
}

/**
 * Connection options for `new PrismaMariaDb(...)`, read from `DATABASE_URL`
 * (a `mysql://user:pass@host:port/db` URL) when `urlVariable` is set, or else
 * from `<prefix>_HOST`, `_PORT`, `_USER`, `_PASSWORD` and `_NAME`.
 * DATE and DATETIME travel as UTC unless `timezone` says otherwise.
 */
export function mariaDbOptions({
  urlVariable,
  prefix,
  defaults = {},
  connectionLimit = 5,
  timezone = "Z",
  env = process.env,
}: {
  urlVariable?: string
  prefix?: string
  defaults?: Partial<
    Pick<MariaDbOptions, "host" | "port" | "user" | "password" | "database">
  >
  connectionLimit?: number
  timezone?: string
  env?: Record<string, string | undefined>
}): MariaDbOptions {
  const common = { connectionLimit, allowPublicKeyRetrieval: true, timezone }
  const raw = urlVariable ? env[urlVariable]?.trim() : undefined

  if (raw) {
    const url = new URL(raw)
    return {
      host: url.hostname,
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.replace(/^\//, ""),
      ...common,
    }
  }

  const read = (name: string) =>
    prefix ? env[`${prefix}_${name}`]?.trim() : undefined
  return {
    host: read("HOST") || defaults.host || "127.0.0.1",
    port: Number(read("PORT") || defaults.port || 3306),
    user: read("USER") || defaults.user || "",
    password: read("PASSWORD") ?? defaults.password ?? "",
    database: read("NAME") || defaults.database || "",
    ...common,
  }
}

/**
 * A client cached on globalThis outside production, so `next dev`'s reloads
 * reuse one pool. After a schema change the cached client lacks the new
 * models; `isStale` (say, "a model I use is missing") rebuilds it.
 */
export function cachedClient<T>(
  key: string,
  create: () => T,
  {
    isStale = () => false,
    production = process.env.NODE_ENV === "production",
  }: { isStale?: (client: T) => boolean; production?: boolean } = {},
): T {
  const holder = globalThis as unknown as Record<string, T | undefined>
  const cached = holder[key]
  if (cached && !isStale(cached)) return cached
  const client = create()
  if (!production) holder[key] = client
  return client
}

type MigrationRow = {
  migration_name: string
  finished_at: Date | null
  rolled_back_at: Date | null
}

/** What getMigrationProblem needs of a Prisma client. */
export type RawQueryClient = {
  $queryRawUnsafe<T = unknown>(query: string): Promise<T>
}

/**
 * Confirms a MySQL/MariaDB schema is at least as new as this build expects.
 * Migrations are applied by a one-shot migrate service before the app starts,
 * so the app never migrates; this is the backstop for a container started
 * some other way. Migrations the database has that this build does not know
 * are fine: that is the previous build redeployed against a schema one step
 * ahead. Returns the problem, or null.
 */
export async function getMigrationProblem(
  client: RawQueryClient,
  {
    migrationsDir = path.join(process.cwd(), "prisma", "migrations"),
  }: { migrationsDir?: string } = {},
): Promise<string | null> {
  let local: string[]
  try {
    const entries = await readdir(migrationsDir, { withFileTypes: true })
    local = entries.filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return `${path.relative(process.cwd(), migrationsDir) || migrationsDir} is missing from this build`
  }

  let history: MigrationRow[]
  try {
    const [table] = await client.$queryRawUnsafe<{ found: bigint | number }[]>(
      "SELECT COUNT(*) AS found FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = '_prisma_migrations'",
    )
    history =
      Number(table?.found ?? 0) === 0
        ? []
        : await client.$queryRawUnsafe<MigrationRow[]>(
            "SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations",
          )
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err))
      .replace(/\s+/g, " ")
      .trim()
    return `could not read the migration history: ${message}`
  }

  const failed = history
    .filter((row) => !row.finished_at && !row.rolled_back_at)
    .map((row) => row.migration_name)
  if (failed.length > 0) {
    return `migration ${failed.join(", ")} did not finish and has to be resolved by hand (\`prisma migrate resolve\`)`
  }

  const applied = new Set(
    history
      .filter((r) => r.finished_at && !r.rolled_back_at)
      .map((r) => r.migration_name),
  )
  const pending = local.filter((name) => !applied.has(name)).sort()
  return pending.length > 0
    ? `${pending.length} migration(s) not applied: ${pending.join(", ")}`
    : null
}

/** Whether an error is Prisma's unique-constraint violation (P2002). */
export function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "P2002"
}
