/**
 * Expected failures are returned, not thrown: a service answers `Result<T>`,
 * the caller checks `ok`, and the error code says what kind of failure it was
 * (and so which status, message or form field it becomes). Throwing is for
 * bugs and for failures on the way (a database that is down).
 */

/** The codes every app shares. An app adds its own through the type parameter. */
export type BaseErrorCode =
  | "INVALID"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "UNAVAILABLE"

export type ServiceError<
  Code extends string = BaseErrorCode,
  Extra extends object = Record<never, never>,
> = {
  ok: false
  code: Code
  /** For the person: a sentence they can act on. */
  message: string
  /** INVALID / CONFLICT: which input field. */
  field?: string
} & Partial<Extra>

export type Result<
  T extends object = Record<never, never>,
  Code extends string = BaseErrorCode,
  Extra extends object = Record<never, never>,
> = ({ ok: true } & T) | ServiceError<Code, Extra>

export function ok(): { ok: true }
export function ok<T extends object>(value: T): { ok: true } & T
export function ok<T extends object>(value?: T) {
  return { ok: true as const, ...value }
}

export function fail<Code extends string = BaseErrorCode>(
  code: Code,
  message: string,
  extra: { field?: string } & Record<string, unknown> = {},
): ServiceError<Code> {
  return { ok: false, code, message, ...extra } as ServiceError<Code>
}

/** The HTTP status a route handler answers for each base code. */
export const ERROR_STATUS: Readonly<Record<BaseErrorCode, number>> = {
  INVALID: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  UNAVAILABLE: 503,
}

/** The status for a code, 400 for one the table does not know. */
export function statusFor(code: string): number {
  return (ERROR_STATUS as Record<string, number>)[code] ?? 400
}
