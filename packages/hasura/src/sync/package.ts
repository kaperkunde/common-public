import { existsSync, readFileSync, readdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

import { STANDARD_VARS } from "./template"

/**
 * What a variable's value may be, checked before anything is rendered.
 * `identifier` (the default): a SQL/YAML name, letters, digits and
 * underscores. `literal`: any text without quotes, semicolons, backslashes
 * or newlines (a type name, a string). `integer`: whole digits.
 */
export type VarType = "identifier" | "literal" | "integer"

export type VarSpec = { description?: string; default?: string; type?: VarType }

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

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/
const QUALIFIED = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/
const UNSAFE_LITERAL = /['"`;\\\n\r]/

/** The standard variables that are not plain identifiers. */
const STANDARD_TYPES: Record<string, { qualified?: boolean; empty?: boolean }> =
  {
    owner_table: { qualified: true },
    prefix: { empty: true },
  }

/** Throws a PackageError naming the variable if its value is unsafe to render. */
export const checkVarValue = (
  pkg: string,
  name: string,
  value: string,
  type: VarType = "identifier",
): void => {
  const fail = (why: string) => {
    throw new PackageError(
      `${pkg}: variable "${name}" ${why} (got ${JSON.stringify(value)})`,
    )
  }
  const standard = STANDARD_TYPES[name]
  if (type === "identifier") {
    if (value === "" && standard?.empty) return
    const pattern = standard?.qualified ? QUALIFIED : IDENTIFIER
    if (!pattern.test(value)) {
      fail(
        standard?.qualified
          ? "must be an identifier, optionally schema-qualified (a or a.b)"
          : "must be an identifier: letters, digits and underscores, not starting with a digit",
      )
    }
  } else if (type === "integer") {
    if (!/^-?\d+$/.test(value)) fail("must be a whole number")
  } else if (value === "" || UNSAFE_LITERAL.test(value)) {
    fail(
      "must be non-empty and contain no quotes, semicolons, backslashes or newlines",
    )
  }
}

/**
 * Every value a package's templates may use: the app's `vars`, else a
 * manifest default, else the standard default. A name nobody declared is an
 * error. A default may itself use `{{other}}` (resolved after the app's own
 * values are applied; a cycle is an error). Every value is validated against
 * its type (see {@link VarType}) before anything is rendered.
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
    if (typeof given[name] !== "string") {
      throw new PackageError(`${pkg.name}: variable "${name}" must be a string`)
    }
  }
  const values: Record<string, string> = {}
  const resolving: string[] = []
  const resolve = (name: string): string | undefined => {
    if (name in values) return values[name]
    if (resolving.includes(name)) {
      throw new PackageError(
        `${pkg.name}: defaults refer to each other in a loop: ${[...resolving, name].join(" -> ")}`,
      )
    }
    resolving.push(name)
    const raw =
      given[name] ??
      pkg.manifest.vars[name]?.default ??
      (STANDARD_VARS as Record<string, string | undefined>)[name]
    let value = raw
    if (raw !== undefined && given[name] === undefined) {
      value = raw.replace(
        /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g,
        (_m, other: string) => {
          if (!declared.has(other)) {
            throw new PackageError(
              `${pkg.name}: the default of "${name}" uses {{${other}}}, which the package does not declare`,
            )
          }
          const resolved = resolve(other)
          if (resolved === undefined) {
            throw new PackageError(
              `${pkg.name}: the default of "${name}" uses {{${other}}}, which has no value`,
            )
          }
          return resolved
        },
      )
    }
    resolving.pop()
    if (value !== undefined) {
      checkVarValue(pkg.name, name, value, pkg.manifest.vars[name]?.type)
      values[name] = value
    }
    return value
  }
  for (const name of declared) resolve(name)
  return { declared, values }
}
