import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

import { Document, isMap, isSeq, parseDocument } from "yaml"

import {
  loadPackage,
  resolvePackageDir,
  resolveVars,
  type LoadedPackage,
} from "./package"
import { renderTemplate } from "./template"

export type AppConfig = {
  hasura: {
    database: string
    migrationsDir: string
    metadataDir: string
  }
  packages: Record<
    string,
    { vars?: Record<string, string>; adopted?: string[] }
  >
}

export type LockMigration = { name: string; sha256: string; adopted?: true }
export type LockPackage = {
  version: string
  migrations: Record<string, LockMigration>
  metadata: Record<string, string>
}
export type LockFile = {
  lockfileVersion: 1
  packages: Record<string, LockPackage>
}

export const CONFIG_FILE = "kaperkunde.json"
export const LOCK_FILE = "kaperkunde.lock.json"

export type SyncOptions = {
  /** The app's root, where kaperkunde.json lives. */
  root: string
  /** Where a package's root directory is; defaults to node_modules lookup. */
  resolvePackage?: (name: string) => string
}

export type SyncPlan = {
  /** Files to write, in order, as absolute path and full content. */
  writes: { path: string; content: string }[]
  /** Everything wrong: drift, edited files, bad config. Non-empty means refuse. */
  problems: string[]
  /** What the plan does, one line each. */
  notes: string[]
}

const sha = (text: string) => createHash("sha256").update(text).digest("hex")

const migrationSha = (up: string, down: string) =>
  sha(`up.sql\n${up}\0down.sql\n${down}`)

const sortKeys = <T>(record: Record<string, T>): Record<string, T> =>
  Object.fromEntries(
    Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  )

/** The lock file's text, deterministic so that a re-run changes nothing. */
export const serializeLock = (lock: LockFile): string =>
  `${JSON.stringify(
    {
      lockfileVersion: 1,
      packages: sortKeys(
        Object.fromEntries(
          Object.entries(lock.packages).map(([name, pkg]) => [
            name,
            {
              version: pkg.version,
              migrations: sortKeys(pkg.migrations),
              metadata: sortKeys(pkg.metadata),
            },
          ]),
        ),
      ),
    },
    null,
    2,
  )}\n`

export const readConfig = (root: string): AppConfig => {
  const path = join(root, CONFIG_FILE)
  if (!existsSync(path)) throw new Error(`${path} does not exist`)
  const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<AppConfig>
  const hasura = raw.hasura
  if (!hasura?.database || !hasura.migrationsDir || !hasura.metadataDir) {
    throw new Error(
      `${CONFIG_FILE}: "hasura" needs database, migrationsDir and metadataDir`,
    )
  }
  return {
    hasura,
    packages: raw.packages ?? {},
  }
}

const readLock = (root: string): LockFile => {
  const path = join(root, LOCK_FILE)
  if (!existsSync(path)) return { lockfileVersion: 1, packages: {} }
  return JSON.parse(readFileSync(path, "utf8")) as LockFile
}

/**
 * Works out what `kk-hasura sync` would do, writing nothing: the rendered
 * migrations not yet synced, the metadata to merge, the new lock file, and
 * every drift or edit that stops it.
 */
export const planSync = (options: SyncOptions): SyncPlan => {
  const root = resolve(options.root)
  const config = readConfig(root)
  const oldLock = readLock(root)
  const migrationsDir = resolve(root, config.hasura.migrationsDir)
  const metadataDir = resolve(root, config.hasura.metadataDir)
  const find =
    options.resolvePackage ?? ((name) => resolvePackageDir(root, name))

  const pending = new Map<string, string>()
  const problems: string[] = []
  const notes: string[] = []
  const read = (path: string): string | undefined =>
    pending.get(path) ??
    (existsSync(path) ? readFileSync(path, "utf8") : undefined)
  const stage = (path: string, content: string) => {
    if (read(path) !== content) pending.set(path, content)
  }

  const newLock: LockFile = { lockfileVersion: 1, packages: {} }

  for (const [name, entry] of Object.entries(config.packages)) {
    let pkg: LoadedPackage
    let values: Record<string, string>
    let declared: Set<string>
    try {
      pkg = loadPackage(find(name))
      if (pkg.name !== name) {
        throw new Error(`manifest names ${pkg.name}, not ${name}`)
      }
      ;({ declared, values } = resolveVars(pkg, entry.vars))
    } catch (error) {
      problems.push(`${name}: ${(error as Error).message}`)
      continue
    }
    const lockPkg: LockPackage = {
      version: pkg.packageVersion,
      migrations: {},
      metadata: {},
    }
    newLock.packages[name] = lockPkg
    const oldPkg = oldLock.packages[name]
    const adopted = new Set(entry.adopted ?? [])
    for (const version of adopted) {
      if (!pkg.migrations.some((m) => m.version === version)) {
        problems.push(
          `${name}: adopted version ${version} is not in the package`,
        )
      }
    }

    const metaWhere = (what: string) => `${name} metadata ${what}`
    let hasOwned = false
    try {
      for (const m of pkg.migrations) {
        const where = `${name} ${m.version}_${m.name}`
        const up = renderTemplate(m.up, declared, values, `${where} up.sql`)
        const down = renderTemplate(
          m.down,
          declared,
          values,
          `${where} down.sql`,
        )
        const hash = migrationSha(up, down)
        const before = oldPkg?.migrations[m.version]
        const dir = join(migrationsDir, `${m.version}_${m.name}`)

        if (adopted.has(m.version)) {
          if (before && !before.adopted) {
            problems.push(
              `${where}: already synced into ${config.hasura.migrationsDir}; it cannot also be adopted`,
            )
          }
          lockPkg.migrations[m.version] = {
            name: m.name,
            sha256: hash,
            adopted: true,
          }
          if (!before) notes.push(`adopted ${where}`)
          continue
        }
        hasOwned = true
        lockPkg.migrations[m.version] = { name: m.name, sha256: hash }
        const upPath = join(dir, "up.sql")
        const downPath = join(dir, "down.sql")

        if (before) {
          if (before.adopted) {
            problems.push(`${where}: was adopted; keep it in "adopted"`)
          } else if (before.sha256 !== hash) {
            problems.push(
              `${where}: renders differently from when it was synced (the package or its vars changed); applied migrations are never rewritten`,
            )
          }
          const onDisk = [read(upPath), read(downPath)]
          if (onDisk[0] === undefined || onDisk[1] === undefined) {
            problems.push(
              `${where}: synced file is missing from ${config.hasura.migrationsDir}`,
            )
          } else if (migrationSha(onDisk[0], onDisk[1]) !== before.sha256) {
            problems.push(`${where}: synced file was edited`)
          }
          continue
        }
        const existing = [read(upPath), read(downPath)]
        if (existing[0] !== undefined || existing[1] !== undefined) {
          if (
            existing[0] !== undefined &&
            existing[1] !== undefined &&
            migrationSha(existing[0], existing[1]) === hash
          ) {
            notes.push(`recorded ${where} (already present)`)
          } else {
            problems.push(
              `${where}: ${dir} already exists with other content; add "${m.version}" to "adopted" if it is yours`,
            )
          }
        } else {
          stage(upPath, up)
          stage(downPath, down)
          notes.push(`wrote ${where}`)
        }
      }

      if (hasOwned) mergeMetadata()
    } catch (error) {
      problems.push(`${name}: ${(error as Error).message}`)
    }

    function mergeMetadata() {
      const decide = (
        key: string,
        rendered: string,
        current: string | undefined,
      ): "write" | "keep" => {
        const recorded = oldPkg?.metadata[key]
        const renderedHash = sha(rendered)
        lockPkg.metadata[key] = renderedHash
        if (current === undefined) return "write"
        const currentHash = sha(current)
        if (currentHash === renderedHash) return "keep"
        if (recorded === undefined) {
          problems.push(`${metaWhere(key)}: exists and was not written by sync`)
          lockPkg.metadata[key] = currentHash
          return "keep"
        }
        if (recorded !== currentHash) {
          problems.push(`${metaWhere(key)}: synced file was edited`)
          lockPkg.metadata[key] = recorded
          return "keep"
        }
        return "write"
      }

      for (const table of pkg.tables) {
        const rendered = renderTemplate(
          table.text,
          declared,
          values,
          metaWhere(table.file),
        )
        // The output is named by the table it describes, as Hasura's CLI does.
        const meta = parseDocument(rendered).toJSON() as {
          table?: { name?: string; schema?: string }
        } | null
        if (!meta?.table?.name) {
          throw new Error(`${metaWhere(table.file)}: has no table.name`)
        }
        const file = `${meta.table.schema ?? "public"}_${meta.table.name}.yaml`
        const path = join(metadataDir, "tables", file)
        const key = `tables/${file}`
        if (decide(key, rendered, read(path)) === "write") {
          stage(path, rendered)
          notes.push(`wrote metadata ${key}`)
        }
        includeTable(file)
      }

      if (pkg.functions !== null) {
        const rendered = renderTemplate(
          pkg.functions,
          declared,
          values,
          metaWhere("functions.yaml"),
        )
        mergeFunctions(rendered)
      }
    }

    function includeTable(file: string) {
      const path = join(metadataDir, "tables", "tables.yaml")
      const doc = docOf(read(path))
      const seq = doc.contents
      if (!isSeq(seq)) throw new Error(`${path} is not a list`)
      const include = `!include ${file}`
      if (
        seq.items.some(
          (item) =>
            String((item as { value?: unknown })?.value ?? item) === include,
        )
      ) {
        return
      }
      seq.add(doc.createNode(include))
      stage(path, String(doc))
    }

    function mergeFunctions(rendered: string) {
      const path = join(metadataDir, "functions.yaml")
      const incoming = parseDocument(rendered)
      if (!isSeq(incoming.contents)) {
        throw new Error("functions.yaml.tmpl must be a list")
      }
      const doc = docOf(read(path))
      const seq = doc.contents
      if (!isSeq(seq)) throw new Error(`${path} is not a list`)
      for (const item of incoming.contents.items) {
        const entry = (item as { toJSON: () => unknown }).toJSON() as {
          function?: { name?: string; schema?: string }
        }
        const fn = entry.function
        if (!fn?.name) throw new Error("a function entry has no function.name")
        const id = `${fn.schema ?? "public"}.${fn.name}`
        const key = `functions/${id}`
        const at = seq.items.findIndex((existing) => {
          if (!isMap(existing)) return false
          const current = existing.toJSON() as typeof entry
          return (
            current.function?.name === fn.name &&
            (current.function?.schema ?? "public") === (fn.schema ?? "public")
          )
        })
        const renderedHash = sha(JSON.stringify(entry))
        const current =
          at === -1
            ? undefined
            : JSON.stringify(
                (seq.items[at] as { toJSON: () => unknown }).toJSON(),
              )
        const recorded = oldPkg?.metadata[key]
        lockPkg.metadata[key] = renderedHash
        if (current !== undefined) {
          const currentHash = sha(current)
          if (currentHash === renderedHash) continue
          if (recorded === undefined) {
            problems.push(
              `${metaWhere(key)}: exists and was not written by sync`,
            )
            lockPkg.metadata[key] = currentHash
            continue
          }
          if (recorded !== currentHash) {
            problems.push(`${metaWhere(key)}: synced entry was edited`)
            lockPkg.metadata[key] = recorded
            continue
          }
        }
        const node = doc.createNode(entry)
        if (at === -1) seq.add(node)
        else seq.items[at] = node
        notes.push(`merged metadata ${key}`)
      }
      stage(path, String(doc))
    }
  }

  for (const name of Object.keys(oldLock.packages)) {
    if (!(name in config.packages)) {
      problems.push(`${name}: in ${LOCK_FILE} but not in ${CONFIG_FILE}`)
    }
  }

  const lockText = serializeLock(newLock)
  if (problems.length === 0 && read(join(root, LOCK_FILE)) !== lockText) {
    pending.set(join(root, LOCK_FILE), lockText)
    if (!existsSync(join(root, LOCK_FILE))) notes.push(`wrote ${LOCK_FILE}`)
    else if (notes.length === 0) notes.push(`updated ${LOCK_FILE}`)
  }

  return {
    writes: [...pending].map(([path, content]) => ({ path, content })),
    problems,
    notes,
  }
}

const docOf = (text: string | undefined): Document => {
  const doc = parseDocument(text && text.trim() ? text : "[]\n")
  return doc
}

export type SyncResult = {
  ok: boolean
  plan: SyncPlan
}

/**
 * `sync`: writes what {@link planSync} planned, or nothing at all if any
 * problem was found. With `check`, writes nothing and fails on any problem or
 * any pending change.
 */
export const runSync = (
  options: SyncOptions & { check?: boolean; log?: (line: string) => void },
): SyncResult => {
  const log = options.log ?? (() => undefined)
  const plan = planSync(options)
  for (const problem of plan.problems) log(`error: ${problem}`)
  if (plan.problems.length > 0) return { ok: false, plan }
  if (options.check) {
    for (const write of plan.writes) {
      log(`drift: ${write.path} is out of date; run kk-hasura sync`)
    }
    return { ok: plan.writes.length === 0, plan }
  }
  for (const write of plan.writes) {
    mkdirSync(dirname(write.path), { recursive: true })
    writeFileSync(write.path, write.content)
  }
  for (const note of plan.notes) log(note)
  if (plan.writes.length === 0) log("already in sync")
  return { ok: true, plan }
}
