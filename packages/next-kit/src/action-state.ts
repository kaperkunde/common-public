import type { Result } from "./result"

/**
 * What a Server Action hands back to `useActionState`: the initial state, a
 * failure with a message for the person (and the field it is about, and
 * what they had typed, so the form can be refilled), or success with
 * whatever the form needs next.
 */
export type ActionState<T extends object = Record<never, never>> =
  | { status: "idle" }
  | {
      status: "error"
      error: string
      code?: string
      field?: string
      values?: Record<string, string>
    }
  | ({ status: "ok" } & T)

export const IDLE = { status: "idle" } as const

export const DEFAULT_UNEXPECTED_ERROR =
  "Something went wrong on our side. Please try again in a moment."

/**
 * Runs an action whose work answers a Result, turning a failure into the
 * form's error state and anything thrown into one unexpected-error message
 * (logged, never shown). `values` are echoed back on failure.
 */
export async function guarded<T extends object>(
  run: () => Promise<Result<T, string>>,
  {
    values,
    unexpected = DEFAULT_UNEXPECTED_ERROR,
    log = (error: unknown) => console.error("[action] failed", error),
  }: {
    values?: Record<string, string>
    unexpected?: string
    log?: (error: unknown) => void
  } = {},
): Promise<ActionState<T>> {
  try {
    const result = await run()
    if (result.ok) {
      const { ok: _ok, ...rest } = result
      return { status: "ok", ...(rest as T) }
    }
    return {
      status: "error",
      error: result.message,
      code: result.code,
      ...(result.field ? { field: result.field } : {}),
      ...(values ? { values } : {}),
    }
  } catch (error) {
    log(error)
    return { status: "error", error: unexpected, ...(values ? { values } : {}) }
  }
}

/** A text field's value, or "" when it is missing or a file. */
export function field(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === "string" ? value : ""
}

/** Every text value of a field that repeats (checkboxes). */
export function fields(formData: FormData, name: string): string[] {
  return formData
    .getAll(name)
    .filter((value): value is string => typeof value === "string")
}

/** An uploaded file, or null when the input was left empty. */
export function file(formData: FormData, name: string): File | null {
  const value = formData.get(name)
  return value instanceof File && value.size > 0 ? value : null
}

/** Every text field, for refilling a form after a failure. */
export function textValues(
  formData: FormData,
  omit: readonly string[] = ["password", "newPassword", "currentPassword"],
): Record<string, string> {
  const values: Record<string, string> = {}
  for (const [key, value] of formData.entries()) {
    if (
      typeof value === "string" &&
      !key.startsWith("$") &&
      !omit.includes(key)
    ) {
      values[key] = value
    }
  }
  return values
}
