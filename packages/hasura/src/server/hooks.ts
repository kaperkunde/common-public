import { timingSafeEqual } from "node:crypto"

/**
 * Whether a request really came from Hasura. Event and cron triggers carry one
 * shared secret in a header; compared in constant time. With no secret
 * configured nothing is admitted.
 */
export const verifyHookSecret = (
  given: string | string[] | null | undefined,
  expected: string | null | undefined,
): boolean => {
  if (!expected || typeof given !== "string") return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export class HookPayloadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "HookPayloadError"
  }
}

export type EventTriggerPayload<TRow = Record<string, unknown>> = {
  id: string
  trigger: string
  table: { schema: string; name: string }
  op: "INSERT" | "UPDATE" | "DELETE" | "MANUAL"
  old: TRow | null
  new: TRow | null
  /** The session variables of whoever caused the write, `x-hasura-*` keys. */
  sessionVariables: Record<string, string>
  createdAt: string | null
  currentRetry: number
  maxRetries: number
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

const OPS = ["INSERT", "UPDATE", "DELETE", "MANUAL"] as const

/** Reads the body Hasura posts for an event trigger. Throws {@link HookPayloadError}. */
export const parseEventTrigger = <TRow = Record<string, unknown>>(
  body: unknown,
): EventTriggerPayload<TRow> => {
  const root = record(body)
  const event = record(root?.event)
  const data = record(event?.data)
  const table = record(root?.table)
  const trigger = record(root?.trigger)
  if (!root || !event || !data || !table || !trigger) {
    throw new HookPayloadError("Not a Hasura event trigger payload")
  }
  const op = event.op
  if (!OPS.includes(op as (typeof OPS)[number])) {
    throw new HookPayloadError(`Unknown event operation ${String(op)}`)
  }
  if (typeof root.id !== "string" || typeof trigger.name !== "string") {
    throw new HookPayloadError("The event has no id or trigger name")
  }
  if (typeof table.name !== "string" || typeof table.schema !== "string") {
    throw new HookPayloadError("The event has no table")
  }
  const session: Record<string, string> = {}
  const vars = record(event.session_variables)
  for (const [key, value] of Object.entries(vars ?? {})) {
    if (typeof value === "string") session[key.toLowerCase()] = value
  }
  const delivery = record(root.delivery_info)
  return {
    id: root.id,
    trigger: trigger.name,
    table: { schema: table.schema, name: table.name },
    op: op as EventTriggerPayload["op"],
    old: (record(data.old) as TRow | undefined) ?? null,
    new: (record(data.new) as TRow | undefined) ?? null,
    sessionVariables: session,
    createdAt: typeof root.created_at === "string" ? root.created_at : null,
    currentRetry:
      typeof delivery?.current_retry === "number" ? delivery.current_retry : 0,
    maxRetries:
      typeof delivery?.max_retries === "number" ? delivery.max_retries : 0,
  }
}

export type CronTriggerPayload<TPayload = unknown> = {
  id: string
  name: string
  scheduledTime: string
  payload: TPayload
  comment: string | null
}

/** Reads the body Hasura posts for a cron trigger. Throws {@link HookPayloadError}. */
export const parseCronTrigger = <TPayload = unknown>(
  body: unknown,
): CronTriggerPayload<TPayload> => {
  const root = record(body)
  if (
    !root ||
    typeof root.name !== "string" ||
    typeof root.scheduled_time !== "string"
  ) {
    throw new HookPayloadError("Not a Hasura cron trigger payload")
  }
  return {
    id: typeof root.id === "string" ? root.id : "",
    name: root.name,
    scheduledTime: root.scheduled_time,
    payload: root.payload as TPayload,
    comment: typeof root.comment === "string" ? root.comment : null,
  }
}
