import {
  TokenCenterError,
  centerUnavailable,
  detailOf,
  errorFromResponse,
} from "../errors"

const NETWORK_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_HEADERS_TIMEOUT",
])

const record = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null

function headerFrom(headers: unknown, name: string): string | null {
  const r = record(headers)
  if (!r) return null
  if (typeof (r as unknown as Headers).get === "function")
    return (r as unknown as Headers).get(name)
  for (const key of Object.keys(r))
    if (key.toLowerCase() === name) return String(r[key])
  return null
}

function parseBody(value: unknown): unknown {
  if (typeof value !== "string") return value ?? null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

/**
 * The `TokenCenterError` behind anything a gateway call threw, or `null` when
 * the error is not the center's at all.
 *
 * Reads, on the error and then down its `cause` chain: an AI SDK
 * `APICallError` (`statusCode`, `responseHeaders` with `x-token-error`,
 * `responseBody` / `data` with `token_center`), a `TokenCenterError`, and a
 * failed fetch (`TypeError: fetch failed`, `ECONNREFUSED`, "Cannot connect to
 * API") which is `center_unavailable`: the caller **fails closed**.
 */
export function tokenErrorOf(error: unknown): TokenCenterError | null {
  let current: unknown = error
  for (let depth = 0; depth < 5 && current; depth++) {
    if (current instanceof TokenCenterError) return current
    const e = record(current)
    if (!e) return null
    const status =
      typeof e.statusCode === "number"
        ? e.statusCode
        : typeof e.status === "number"
          ? e.status
          : null
    const body = parseBody(e.responseBody ?? e.data ?? e.body)
    const code = headerFrom(e.responseHeaders ?? e.headers, "x-token-error")
    if (
      status !== null &&
      (detailOf(record(body)?.token_center) ||
        detailOf(record(body)?.error) ||
        code)
    )
      return errorFromResponse(status, body, {
        code,
        retryAfter: headerFrom(e.responseHeaders ?? e.headers, "retry-after"),
      })
    const cause = record(e.cause)
    const errCode =
      typeof e.code === "string"
        ? e.code
        : cause && typeof cause.code === "string"
          ? cause.code
          : null
    const message = typeof e.message === "string" ? e.message : ""
    if (
      (errCode && NETWORK_CODES.has(errCode)) ||
      (e.name === "TypeError" && /fetch failed/i.test(message)) ||
      /^Cannot connect to API/i.test(message)
    )
      return centerUnavailable(current)
    current = e.cause
  }
  return null
}
