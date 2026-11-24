import { createHmac, timingSafeEqual } from "node:crypto"

import {
  TOKEN_HEADERS,
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_TOLERANCE_SECONDS,
  type WebhookEvent,
  type WebhookEventType,
} from "../types"

/**
 * A delivery of a `type` this client does not know: the center adds types, and a receiver must
 * answer 2xx to one and otherwise ignore it. Never thrown; see {@link isKnownWebhookEvent}.
 */
export type UnknownWebhookEvent = {
  id: string
  type: string
  createdAt?: string
  appId?: string
  livemode?: boolean
  data: Record<string, unknown>
  /** Marks this as not one of {@link WebhookEvent}. */
  unknown: true
}

/** Whether `event` is one of the typed events (narrows away {@link UnknownWebhookEvent}). */
export const isKnownWebhookEvent = (
  event: WebhookEvent | UnknownWebhookEvent,
): event is WebhookEvent => !("unknown" in event && event.unknown === true)

/**
 * Whether `event` is one an app resumes paused work on (out of credit, a DJ or AI pause): money or
 * a grant arrived (`purchase.completed`, `grant.received`), or a refund failed and put its credit
 * back (`purchase.refund_failed` with `data.balance.availableMicros > 0`; no `balance.*` event is
 * sent for that). An unknown event, or a malformed one, never lifts anything.
 */
export function liftsPause(event: WebhookEvent | UnknownWebhookEvent): boolean {
  switch (event.type) {
    case "purchase.completed":
    case "grant.received":
      return true
    case "purchase.refund_failed": {
      const balance = (
        event.data as { balance?: { availableMicros?: unknown } }
      ).balance
      return (
        typeof balance?.availableMicros === "number" &&
        balance.availableMicros > 0
      )
    }
    default:
      return false
  }
}

export type WebhookFailure = "malformed" | "signature" | "stale" | "body"

/** The delivery is not from the center, is too old, or is not an event. Answer 400. */
export class WebhookVerificationError extends Error {
  readonly reason: WebhookFailure
  constructor(reason: WebhookFailure, message: string) {
    super(message)
    this.name = "WebhookVerificationError"
    this.reason = reason
  }
}

/** `t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<rawBody>")>`, as the center signs it. */
export function signWebhook(
  rawBody: string,
  secret: string,
  timestamp: number = Math.floor(Date.now() / 1000),
): string {
  const mac = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex")
  return `t=${timestamp},v1=${mac}`
}

export type VerifyWebhookOptions = {
  /** Default 300 (`WEBHOOK_TOLERANCE_SECONDS`). */
  toleranceSeconds?: number
  /** Unix seconds; for tests. */
  now?: number
}

/**
 * Check a delivery and return its typed event. `rawBody` must be the bytes as
 * received (not re-serialised JSON); `signatureHeader` the `token-signature`
 * header; `secret` the app's webhook secret (an array while rotating: any one
 * that matches is enough). Throws `WebhookVerificationError` on a malformed
 * header, a wrong signature (constant-time compare), a timestamp more than the
 * tolerance from now, or a body that is not an event at all (no id, type or data).
 * An event of a type this version does not know is returned as an
 * {@link UnknownWebhookEvent}, not thrown: check with {@link isKnownWebhookEvent}.
 *
 * Deliveries repeat and arrive out of order: handlers dedupe on `event.id`.
 */
export function verifyWebhook(
  rawBody: string | Uint8Array,
  signatureHeader: string | null | undefined,
  secret: string | readonly string[],
  options: VerifyWebhookOptions = {},
): WebhookEvent | UnknownWebhookEvent {
  const body =
    typeof rawBody === "string"
      ? rawBody
      : Buffer.from(rawBody).toString("utf8")
  if (!signatureHeader)
    throw new WebhookVerificationError(
      "malformed",
      "Missing token-signature header.",
    )
  let timestamp = NaN
  const candidates: string[] = []
  for (const part of signatureHeader.split(",")) {
    const [key, ...rest] = part.trim().split("=")
    const value = rest.join("=")
    if (key === "t") timestamp = Number(value)
    else if (key === "v1" && value) candidates.push(value)
  }
  if (!Number.isInteger(timestamp) || candidates.length === 0)
    throw new WebhookVerificationError(
      "malformed",
      "Malformed token-signature header.",
    )

  const secrets = typeof secret === "string" ? [secret] : secret
  let matched = false
  for (const s of secrets) {
    const expected = createHmac("sha256", s)
      .update(`${timestamp}.${body}`)
      .digest()
    for (const candidate of candidates) {
      const given = Buffer.from(candidate, "hex")
      // Always compare equal-length buffers, and never short-circuit on a hit.
      if (given.length === expected.length && timingSafeEqual(given, expected))
        matched = true
    }
  }
  if (!matched)
    throw new WebhookVerificationError("signature", "Signature does not match.")

  const now = options.now ?? Math.floor(Date.now() / 1000)
  const tolerance = options.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS
  if (Math.abs(now - timestamp) > tolerance)
    throw new WebhookVerificationError(
      "stale",
      "Signature timestamp is outside the tolerance.",
    )

  return parseWebhookEvent(body)
}

/**
 * A body that is a webhook event: typed when its `type` is known, an {@link UnknownWebhookEvent}
 * when it is not. Throws `WebhookVerificationError("body")` only for something that is no
 * event at all.
 */
export function parseWebhookEvent(
  body: string | unknown,
): WebhookEvent | UnknownWebhookEvent {
  let value: unknown = body
  if (typeof body === "string") {
    try {
      value = JSON.parse(body)
    } catch {
      throw new WebhookVerificationError("body", "Body is not JSON.")
    }
  }
  const e = value as Partial<WebhookEvent> | null
  if (
    !e ||
    typeof e !== "object" ||
    typeof e.id !== "string" ||
    typeof e.type !== "string" ||
    typeof e.data !== "object" ||
    e.data === null
  )
    throw new WebhookVerificationError("body", "Body is not an event.")
  if (!(WEBHOOK_EVENT_TYPES as readonly string[]).includes(e.type))
    return { ...(e as object), unknown: true } as UnknownWebhookEvent
  return e as WebhookEvent
}

export type WebhookHandlers = {
  [T in WebhookEventType]?: (
    event: Extract<WebhookEvent, { type: T }>,
  ) => void | Promise<void>
}

export type WebhookRouteOptions = {
  /** The app's webhook secret (a function, so env is read at request time; an array while rotating). */
  secret: string | readonly string[] | (() => string | readonly string[])
  /** One handler per event type; types without one are acknowledged and ignored. Idempotent on `event.id`. */
  handlers: WebhookHandlers
  toleranceSeconds?: number
  /** Where a handler's failure goes (it answers 500 so the center retries). */
  onError?: (error: unknown, event: WebhookEvent) => void
  /** A delivery of a type this version does not know. It is acknowledged (200) either way. */
  onUnknown?: (event: UnknownWebhookEvent) => void
}

/**
 * A Web `Request → Response` handler for the center's webhook: verifies, calls
 * the handler for the type, answers 200 (even for a type with no handler),
 * 400 for a bad signature or body and 500 when a handler throws (the center
 * retries 1 m … 24 h, so a handler must be idempotent on `event.id`).
 */
export function webhookRoute(options: WebhookRouteOptions) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST")
      return new Response("Method not allowed", { status: 405 })
    const rawBody = await request.text()
    let event: WebhookEvent | UnknownWebhookEvent
    try {
      event = verifyWebhook(
        rawBody,
        request.headers.get(TOKEN_HEADERS.signature),
        typeof options.secret === "function"
          ? options.secret()
          : options.secret,
        { toleranceSeconds: options.toleranceSeconds },
      )
    } catch (error) {
      if (error instanceof WebhookVerificationError)
        return Response.json(
          { error: error.reason, message: error.message },
          { status: 400 },
        )
      throw error
    }
    if (!isKnownWebhookEvent(event)) {
      try {
        options.onUnknown?.(event)
      } catch {
        // an observer's failure is not the center's to retry
      }
      return Response.json({ received: true, id: event.id })
    }
    try {
      const handler = options.handlers[event.type] as
        ((e: WebhookEvent) => void | Promise<void>) | undefined
      await handler?.(event)
    } catch (error) {
      options.onError?.(error, event)
      return Response.json({ error: "handler_failed" }, { status: 500 })
    }
    return Response.json({ received: true, id: event.id })
  }
}
