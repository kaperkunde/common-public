import { resolve } from "node:path"

import { runSync } from "./sync/sync"

const USAGE = `Usage: kk-hasura sync [--check] [--root <dir>]

  sync           render packages' migrations and metadata into the app
  sync --check   exit non-zero on drift or an edited synced file; writes nothing
`

export const main = (argv: string[], log: (line: string) => void): number => {
  const [command, ...rest] = argv
  if (command !== "sync") {
    log(USAGE)
    return command === undefined || command === "--help" ? 0 : 2
  }
  let check = false
  let root = process.cwd()
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    if (arg === "--check") check = true
    else if (arg === "--root") root = resolve(rest[++i] ?? "")
    else {
      log(`Unknown option ${arg}`)
      log(USAGE)
      return 2
    }
  }
  try {
    return runSync({ root, check, log }).ok ? 0 : 1
  } catch (error) {
    log(`error: ${(error as Error).message}`)
    return 1
  }
}
