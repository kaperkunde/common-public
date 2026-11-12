import { existsSync, readFileSync, readdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

import { STANDARD_VARS } from "./template"

export type VarSpec = { description?: string; default?: string }

export type PackageManifest = {
  name: string
  vars: Record<string, VarSpec>
}

export type MigrationTemplate = {
  version: string
  name: string
  up: string
  down: string
}

export type LoadedPackage = {
  name: string
  /** The package's own semver, for the lock file. */
  packageVersion: string
  manifest: PackageManifest
  migrations: MigrationTemplate[]
  /** Table metadata templates: file name without `.tmpl`, raw text. */
  tables: { file: string; text: string }[]
  /** The raw functions template, if any. */
  functions: string | null
}

export class PackageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PackageError"
  }
}

const MIGRATION_DIR = /^(\d{13})_([a-z0-9_]+)$/

/** Reads a package's `hasura/` directory. `dir` is the package root. */
export const loadPackage = (dir: string): LoadedPackage => {
  const hasura = join(dir, "hasura")
  const manifestPath = join(hasura, "manifest.json")
  if (!existsSync(manifestPath)) {
    throw new PackageError(`${manifestPath} does not exist`)
  }
  const raw = JSON.parse(
    readFileSync(manifestPath, "utf8"),
  ) as Partial<PackageManifest>
  if (!raw.name || typeof raw.name !== "string") {
    throw new PackageError(`${manifestPath} has no name`)
  }
  const vars = raw.vars ?? {}
  for (const name of Object.keys(vars)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new PackageError(
        `${raw.name}: "${name}" is not a valid variable name`,
      )
    }
  }
  const pkgJsonPath = join(dir, "package.json")
  const packageVersion = existsSync(pkgJsonPath)
    ? ((JSON.parse(readFileSync(pkgJsonPath, "utf8")) as { version?: string })
        .version ?? "0.0.0")
    : "0.0.0"

  const migrationsDir = join(hasura, "migrations")
  const migrations: MigrationTemplate[] = []
  if (existsSync(migrationsDir)) {
    for (const entry of readdirSync(migrationsDir).sort()) {
      const match = MIGRATION_DIR.exec(entry)
      if (!match) {
        throw new PackageError(
          `${raw.name}: migration directory "${entry}" is not <13-digit version>_<snake_name>`,
        )
      }
      const read = (file: string) => {
        const path = join(migrationsDir, entry, file)
        if (!existsSync(path))
          throw new PackageError(`${raw.name}: ${path} is missing`)
        return readFileSync(path, "utf8")
      }
      migrations.push({
        version: match[1]!,
        name: match[2]!,
        up: read("up.sql"),
        down: read("down.sql"),
      })
    }
  }

  const tablesDir = join(hasura, "metadata", "tables")
  const tables = existsSync(tablesDir)
    ? readdirSync(tablesDir)
        .filter((file) => file.endsWith(".yaml.tmpl"))
        .sort()
        .map((file) => ({
          file: file.slice(0, -".tmpl".length),
          text: readFileSync(join(tablesDir, file), "utf8"),
        }))
    : []
  const functionsPath = join(hasura, "metadata", "functions.yaml.tmpl")
  return {
    name: raw.name,
    packageVersion,
    manifest: { name: raw.name, vars },
    migrations,
    tables,
    functions: existsSync(functionsPath)
      ? readFileSync(functionsPath, "utf8")
      : null,
  }
}

/**
 * Finds an installed package by walking `node_modules` upward from `root`,
 * which follows pnpm's symlinks and needs no `exports` entry.
 */
export const resolvePackageDir = (root: string, name: string): string => {
  let current = resolve(root)
  for (;;) {
    const candidate = join(current, "node_modules", ...name.split("/"))
    if (existsSync(join(candidate, "hasura", "manifest.json"))) return candidate
    const parent = dirname(current)
    if (parent === current) {
      throw new PackageError(
        `${name} is not installed (no hasura/manifest.json under node_modules)`,
      )
    }
    current = parent
  }
}

/**
 * Every value a package's templates may use: the app's `vars`, else a
 * manifest default, else the standard default. A name nobody declared is an
 * error; so is a value for one.
 */
export const resolveVars = (
  pkg: LoadedPackage,
  given: Record<string, string> = {},
): { declared: Set<string>; values: Record<string, string> } => {
  const declared = new Set<string>([
    ...Object.keys(STANDARD_VARS),
    ...Object.keys(pkg.manifest.vars),
  ])
  for (const name of Object.keys(given)) {
    if (!declared.has(name)) {
      throw new PackageError(
        `${pkg.name}: kaperkunde.json sets "${name}", which the package does not declare`,
      )
    }
  }
  const values: Record<string, string> = {}
  for (const name of declared) {
    const value =
      given[name] ??
      pkg.manifest.vars[name]?.default ??
      (STANDARD_VARS as Record<string, string | undefined>)[name]
    if (value !== undefined) values[name] = value
  }
  return { declared, values }
}
