import type { ProtocolError } from "@modelcontextprotocol/server"

/** One argument problem as a client can act on it: where, what, and what would have done. */
export type ArgumentIssue = {
  /** The container the problem is in, as a `/` path; empty for the arguments themselves. */
  path: string
  problem: string
  /** For an unknown key: the keys that were not recognised. */
  keys?: string[]
  /** For an unknown key: the keys that container takes. */
  allowed?: string[]
}

const UNKNOWN_ARGUMENT =
  /^"([^"]*)" is not an argument of this tool \(it takes: ([^)]*)\)\.?$/
const UNKNOWN_KEY =
  /^"([^"]*)" is not a key the \S+ allows in "([^"]*)" \(it takes: ([^)]*)\)\.?$/
const LEADING_PATH = /^"([^"]*)"/

const keysOf = (list: string) =>
  list
    .split(",")
    .map((key) => key.trim())
    .filter((key) => key && key !== "none")

/**
 * The problems `validate` found, as issues with their path, unknown keys and
 * the keys allowed there. The words stay as `validate` wrote them.
 */
export function issuesOf(problems: readonly string[]): ArgumentIssue[] {
  return problems.map((problem) => {
    const argument = UNKNOWN_ARGUMENT.exec(problem)

    if (argument) {
      return {
        path: "",
        problem,
        keys: [argument[1]!],
        allowed: keysOf(argument[2]!),
      }
    }

    const key = UNKNOWN_KEY.exec(problem)

    if (key) {
      const full = key[1]!
      const container = key[2]!
      const last = full.slice(container.length).replace(/^\//, "")
      return {
        path: container,
        problem,
        keys: [last],
        allowed: keysOf(key[3]!),
      }
    }

    return { path: LEADING_PATH.exec(problem)?.[1] ?? "", problem }
  })
}

/** The words of a -32602: the tool, then every problem in one line. */
export function invalidArgumentsMessage(
  tool: string,
  problems: readonly string[],
): string {
  return `Invalid arguments for ${tool}: ${problems.join(" ")}`
}

/**
 * Arguments that do not fit as a JSON-RPC -32602, whose `data` is `{ tool,
 * issues }`, every issue with its path, the unknown keys and the keys
 * allowed there. Nothing was run.
 */
export async function invalidArgumentsError(
  tool: string,
  problems: readonly string[],
): Promise<ProtocolError> {
  // Loaded when needed: the SDK is an optional peer of this package.
  const { ProtocolError, ProtocolErrorCode } =
    await import("@modelcontextprotocol/server")

  return new ProtocolError(
    ProtocolErrorCode.InvalidParams,
    invalidArgumentsMessage(tool, problems),
    { tool, issues: issuesOf(problems) },
  )
}
