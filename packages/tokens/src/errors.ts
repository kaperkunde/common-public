import {
  ERROR_CODES,
  ERROR_STATUS,
  type ErrorCode,
  type TokenErrorDetail,
} from "./types"

/**
 * An error the Token Center answered with (or that the client synthesised for
 * it: `center_unavailable` when it cannot be reached). `code` is the contract's
 * stable code, `status` the HTTP status, `detail` the whole body the center
 * sent (`action`, `capability`, `minimumCents`, `retryAfterSeconds` …).
 *
 * `message` is an English sentence safe to show a user.
 */
export class TokenCenterError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly detail: TokenErrorDetail

  constructor(
    detail: TokenErrorDetail,
    status: number = ERROR_STATUS[detail.code],
    options?: { cause?: unknown },
  ) {
    super(detail.message, options)
    this.name = "TokenCenterError"
    this.code = detail.code
    this.status = status
    this.detail = detail
  }

  /** The center's call this error belongs to (`x-token-call-id`), when it does: a failed or refused call. */
  get callId(): string | undefined {
    return this.detail.callId
  }

  /** `invalid_request`: the JSON path of the offending field or header (`amountCents`, `tools[0].type`, `body`). */
  get path(): string | undefined {
    return this.detail.path
  }

  /** What the app should offer the user: buy tokens, set up an own model, wait. */
  get action(): TokenErrorDetail["action"] {
    return this.detail.action
  }
}

export const isErrorCode = (value: unknown): value is ErrorCode =>
  typeof value === "string" &&
  (ERROR_CODES as readonly string[]).includes(value)

/** Whether `error` is a `TokenCenterError`, optionally of one of `codes`. */
export function isTokenError(
  error: unknown,
  ...codes: ErrorCode[]
): error is TokenCenterError {
  return (
    error instanceof TokenCenterError &&
    (codes.length === 0 || codes.includes(error.code))
  )
}

/** `center_unavailable`: nothing answered, or only a 5xx with no contract body. Apps fail closed. */
export function centerUnavailable(
  cause?: unknown,
  message = "The token center is unavailable.",
): TokenCenterError {
  return new TokenCenterError(
    { code: "center_unavailable", message },
    503,
    cause === undefined ? undefined : { cause },
  )
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

/** A `TokenErrorDetail` out of anything shaped like one, or null. */
export function detailOf(value: unknown): TokenErrorDetail | null {
  const record = asRecord(value)
  if (!record || !isErrorCode(record.code)) return null
  return {
    ...(record as Partial<TokenErrorDetail>),
    code: record.code,
    message:
      typeof record.message === "string" && record.message
        ? record.message
        : defaultMessage(record.code),
  }
}

function defaultMessage(code: ErrorCode): string {
  return code === "center_unavailable"
    ? "The token center is unavailable."
    : `The token center answered ${code}.`
}

const STATUS_CODE: Record<number, ErrorCode> = {
  400: "invalid_request",
  401: "unauthenticated",
  402: "insufficient_balance",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  429: "rate_limited",
}

/**
 * The error for a non-2xx answer. Reads, in order: the app API body
 * (`{ error: {code, …} }`), the gateway body (`{ …, token_center: {code, …} }`),
 * the `x-token-error` header; with none of them a 5xx is `center_unavailable`
 * (a proxy's error page, a crash) and anything else is mapped by status.
 */
export function errorFromResponse(
  status: number,
  body: unknown,
  headers?: {
    code?: string | null
    retryAfter?: string | null
    callId?: string | null
  },
): TokenCenterError {
  const record = asRecord(body)
  const detail =
    detailOf(record?.token_center) ??
    detailOf(record?.error) ??
    (isErrorCode(headers?.code)
      ? {
          code: headers.code,
          message:
            typeof asRecord(record?.error)?.message === "string"
              ? (asRecord(record?.error)?.message as string)
              : defaultMessage(headers.code),
        }
      : null)
  const retry = Number(headers?.retryAfter)
  const callId = headers?.callId || undefined
  if (detail) {
    if (detail.callId === undefined && callId) detail.callId = callId
    if (
      detail.retryAfterSeconds === undefined &&
      Number.isFinite(retry) &&
      retry > 0
    )
      detail.retryAfterSeconds = retry
    return new TokenCenterError(detail, status)
  }
  if (status >= 500)
    return centerUnavailable(undefined, `The token center answered ${status}.`)
  const code = STATUS_CODE[status] ?? "internal_error"
  return new TokenCenterError(
    {
      code,
      message: `The token center answered ${status}.`,
      ...(callId ? { callId } : {}),
      ...(Number.isFinite(retry) && retry > 0
        ? { retryAfterSeconds: retry }
        : {}),
    },
    status,
  )
}
