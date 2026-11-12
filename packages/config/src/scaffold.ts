import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
} from "node:fs"
import { dirname, join, resolve } from "node:path"

/** The template files and where each goes in an app. */
export const TEMPLATE_FILES = {
  dockerfile: { from: "Dockerfile", to: "deploy/Dockerfile" },
  "hasura-dockerfile": {
    from: "hasura.Dockerfile",
    to: "deploy/hasura.Dockerfile",
  },
  entrypoint: {
    from: "entrypoint.sh",
    to: "deploy/entrypoint.sh",
    executable: true,
  },
  compose: {
    from: "docker-compose.coolify.yml",
    to: "docker-compose.coolify.yml",
  },
} as const

export type TemplateName = keyof typeof TEMPLATE_FILES

export const TEMPLATE_NAMES = Object.keys(TEMPLATE_FILES) as TemplateName[]

/** Where the templates live: next to the built files, one level up. */
const TEMPLATE_DIR = new URL("../templates/", import.meta.url)

const SLUG = /^[a-z][a-z0-9-]*$/

export class ScaffoldError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ScaffoldError"
  }
}

/**
 * Every variable a template may use. `name` is required (a lower-case slug,
 * the app's service name); the rest default from it.
 */
export const scaffoldVars = (
  name: string,
  overrides: Record<string, string> = {},
): Record<string, string> => {
  if (!SLUG.test(name)) {
    throw new ScaffoldError(
      `--name must be a lower-case slug (letters, digits, hyphens), got "${name}"`,
    )
  }
  const defaults: Record<string, string> = {
    name,
    name_upper: name.toUpperCase().replace(/-/g, "_"),
    db: name.replace(/-/g, "_"),
    db_env: "DATABASE_URL",
    node_version: "24.22.2",
    pnpm_version: "10.33.0",
    hasura_version: "v2.50.3-ce",
    postgres_version: "16",
    port: "3000",
    auth_config: "src/auth.ts",
    auth_dir: "src",
  }
  for (const key of Object.keys(overrides)) {
    if (!(key in defaults)) {
      throw new ScaffoldError(
        `Unknown variable "${key}". Known: ${Object.keys(defaults).join(", ")}`,
      )
    }
  }
  return { ...defaults, ...overrides }
}

/** Renders `{{var}}`; an unknown variable is an error. */
export const renderScaffold = (
  text: string,
  vars: Record<string, string>,
  where: string,
): string =>
  text.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (_m, key: string) => {
    const value = vars[key]
    if (value === undefined) {
      throw new ScaffoldError(`${where}: unknown variable {{${key}}}`)
    }
    return value
  })

export type ScaffoldOptions = {
  name: string
  /** Which templates; default all. */
  templates?: readonly TemplateName[]
  /** The app root to write into. Default the current directory. */
  out?: string
  /** Overwrite files that exist. Default false: they are skipped and reported. */
  force?: boolean
  vars?: Record<string, string>
  /** Reads a template, for tests; default from the package. */
  readTemplate?: (file: string) => string
}

export type ScaffoldResult = { written: string[]; skipped: string[] }

/** Copies the templates into an app with the name (and any other variable) substituted. */
export const scaffold = (options: ScaffoldOptions): ScaffoldResult => {
  const vars = scaffoldVars(options.name, options.vars)
  const out = resolve(options.out ?? ".")
  const read =
    options.readTemplate ??
    ((file: string) => readFileSync(new URL(file, TEMPLATE_DIR), "utf8"))
  const result: ScaffoldResult = { written: [], skipped: [] }
  for (const name of options.templates ?? TEMPLATE_NAMES) {
    const spec = TEMPLATE_FILES[name] as
      | {
          from: string
          to: string
          executable?: boolean
        }
      | undefined
    if (!spec) {
      throw new ScaffoldError(
        `Unknown template "${name}". Known: ${TEMPLATE_NAMES.join(", ")}`,
      )
    }
    const target = join(out, spec.to)
    if (existsSync(target) && !options.force) {
      result.skipped.push(spec.to)
      continue
    }
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, renderScaffold(read(spec.from), vars, spec.from))
    if (spec.executable) chmodSync(target, 0o755)
    result.written.push(spec.to)
  }
  return result
}

const USAGE = `Usage: kk-scaffold --name <app> [templates...] [--out <dir>] [--force] [--set key=value]...

Copies deploy templates into an app, with the name substituted.
Templates: ${TEMPLATE_NAMES.join(", ")} (default: all).
Variables for --set: name_upper, db, db_env, node_version, pnpm_version, hasura_version,
postgres_version, port, auth_config, auth_dir.
`

/** The CLI, with output injected; returns the exit code. */
export const main = (argv: string[], log: (line: string) => void): number => {
  let name: string | undefined
  let out: string | undefined
  let force = false
  const vars: Record<string, string> = {}
  const templates: TemplateName[] = []
  try {
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i]!
      if (arg === "--help" || arg === "-h") {
        log(USAGE)
        return 0
      } else if (arg === "--name") name = argv[++i]
      else if (arg === "--out") out = argv[++i]
      else if (arg === "--force") force = true
      else if (arg === "--set") {
        const [key, ...rest] = (argv[++i] ?? "").split("=")
        if (!key || rest.length === 0)
          throw new ScaffoldError("--set takes key=value")
        vars[key] = rest.join("=")
      } else if (arg.startsWith("-"))
        throw new ScaffoldError(`Unknown option ${arg}`)
      else if (arg === "all") templates.push(...TEMPLATE_NAMES)
      else templates.push(arg as TemplateName)
    }
    if (!name) throw new ScaffoldError("--name is required")
    const result = scaffold({
      name,
      out,
      force,
      vars,
      templates: templates.length > 0 ? templates : undefined,
    })
    for (const file of result.written) log(`wrote ${file}`)
    for (const file of result.skipped)
      log(`skipped ${file} (exists; use --force)`)
    return 0
  } catch (error) {
    if (error instanceof ScaffoldError) {
      log(`error: ${error.message}`)
      log(USAGE)
      return 2
    }
    throw error
  }
}
