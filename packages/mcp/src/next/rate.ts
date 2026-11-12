/**
 * How the MCP door limits a connected agent, told apart by what it asks for:
 * pure, so the sorting and the refusal's shape are unit-tested and the door
 * only counts.
 *
 * Reads, and the protocol's own requests (`initialize`, `tools/list`,
 * notifications, `ping`), count against a generous bucket of their own; only
 * what writes counts against the stricter one. A burst of writes never locks
 * out looking around, and an agent polling to see when it may go on is not
 * refused that too.
 */

/** Which bucket a request counts against. */
export type RequestKind = "read" | "write"

export type Bucket = { limit: number; windowMs: number }
export type Buckets = Record<RequestKind, Bucket>

/** A sensible start: enough for an agent working a turn, not for one in a loop. */
export const DEFAULT_BUCKETS: Buckets = {
  write: { limit: 120, windowMs: 60_000 },
  read: { limit: 600, windowMs: 60_000 },
}

export type Classifier = {
  /** Tool names that only read. */
  readTools?: ReadonlySet<string>
  /** Names matching this read by name alone. Default `list_`, `get_` and `read_`. */
  readPattern?: RegExp
}

type RpcMessage = {
  method?: unknown
  params?: { name?: unknown } | null
  id?: unknown
}

const DEFAULT_READ_PATTERN = /^(list|get|read)_/

const messageKind = (message: unknown, classifier: Classifier): RequestKind => {
  const one = (message ?? {}) as RpcMessage
  if (one.method !== "tools/call") return "read"
  const name = typeof one.params?.name === "string" ? one.params.name : ""
  return classifier.readTools?.has(name) ||
    (classifier.readPattern ?? DEFAULT_READ_PATTERN).test(name)
    ? "read"
    : "write"
}

/**
 * Which bucket a request's body counts against: a call of a tool that writes
 * is a write; everything else the protocol sends, a read. A tool the
 * classifier does not know counts as a write, the stricter side. A batch with
 * any write in it is a write.
 */
export const requestKind = (
  body: unknown,
  classifier: Classifier = {},
): RequestKind => {
  const messages = Array.isArray(body) ? body : [body]
  return messages.some((message) => messageKind(message, classifier) === "write")
    ? "write"
    : "read"
}

/** The JSON-RPC id to answer with: the request's own, or null for a batch or none. */
export const rpcIdOf = (body: unknown): string | number | null => {
  if (Array.isArray(body) || !body || typeof body !== "object") return null
  const { id } = body as RpcMessage
  return typeof id === "string" || typeof id === "number" ? id : null
}

/**
 * The 429's body in the shape an MCP client reads: the request's own id
 * echoed, words a person reads, and in `data` what a program needs to back off
 * without parsing them.
 */
export const tooManyBody = (
  kind: RequestKind,
  retryAfterSeconds: number,
  id: string | number | null,
  buckets: Buckets = DEFAULT_BUCKETS,
) => {
  const { limit, windowMs } = buckets[kind]
  const seconds = Math.round(windowMs / 1000)
  const what = kind === "write" ? "writes" : "reads"
  return {
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: `Too many ${what} at once: ${limit} a ${seconds === 60 ? "minute" : `${seconds} s`} per person. Try again in ${retryAfterSeconds} s${kind === "write" ? "; reads still go through meanwhile" : ""}.`,
      data: { retryAfterSeconds, bucket: kind, limit, windowSeconds: seconds },
    },
    id,
  }
}
