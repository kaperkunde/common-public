import type Stripe from "stripe"

/**
 * What every app that takes money through Stripe checks before it believes
 * an event, in this order, each the reason the next can be trusted:
 *
 * 1. The raw body's signature against the endpoint's own webhook secret
 *    (the account may be shared; another product's endpoint has another).
 * 2. The event fetched back from Stripe by id: what arrived was a claim,
 *    what Stripe answers is the event as it is, so a leaked signing secret
 *    lets somebody repeat real events but never invent one.
 * 3. On a shared account, only events whose object carries this app's
 *    metadata marker (`metadata.app = "lorespawner"`) are handled; the rest
 *    are answered and ignored.
 * 4. The app's handler is idempotent: it records the event id in the same
 *    transaction as what it credits, so a retry or a replay grants nothing.
 *
 * A failure after the signature answers 500, which Stripe retries; that is
 * safe because every step is idempotent.
 */

export type StripeKeyMode = "live" | "test"

/** Whether a Stripe key is a live or a test (sandbox) key, from its prefix. */
export function stripeKeyMode(
  key: string | null | undefined,
): StripeKeyMode | null {
  const value = key?.trim() ?? ""
  if (/^(sk|pk|rk)_live_/.test(value) || /^whsec_live_/.test(value))
    return "live"
  if (/^(sk|pk|rk)_test_/.test(value)) return "test"
  return null
}

/**
 * Why Stripe is refused on a development deployment holding live keys, or
 * null. A dev checkout would create a real charge, and a live webhook secret
 * would let a dev build act on production events.
 */
export function liveKeysOnDevelopment(
  development: boolean,
  keys: Readonly<Record<string, string | null | undefined>>,
): string | null {
  if (!development) return null
  const live = Object.entries(keys)
    .filter(([, value]) => stripeKeyMode(value) === "live")
    .map(([name]) => name)
  if (live.length === 0) return null
  return `${live.join(" and ")} ${live.length === 1 ? "is a live Stripe key" : "are live Stripe keys"} on a development deployment. Use sandbox keys (sk_test_/pk_test_) there.`
}

/** Whether an event's object was created by this app, by its metadata marker. */
export function belongsToApp(
  event: Stripe.Event,
  app: string,
  key = "app",
): boolean {
  const object = event.data.object as {
    metadata?: Record<string, string> | null
  }
  return object.metadata?.[key] === app
}

export type WebhookAnswer = { status: number; body: Record<string, unknown> }

/**
 * Checks and handles one webhook delivery: signature, fetch-back, the app's
 * marker, then `handle`. Answers the status and body to send. `app` may be
 * left out on an account no other product uses.
 */
export async function handleStripeWebhook({
  stripe,
  webhookSecret,
  rawBody,
  signature,
  app,
  metadataKey,
  handle,
  log = (message, error) => console.error(message, error),
}: {
  stripe: Pick<Stripe, "webhooks" | "events"> | null | undefined
  webhookSecret: string | null | undefined
  rawBody: string | Buffer
  signature: string | null | undefined
  app?: string
  metadataKey?: string
  handle: (event: Stripe.Event) => Promise<string | void>
  log?: (message: string, error: unknown) => void
}): Promise<WebhookAnswer> {
  if (!stripe || !webhookSecret) {
    return { status: 503, body: { error: "Stripe is not configured here." } }
  }
  if (!signature)
    return { status: 400, body: { error: "No Stripe signature." } }

  let claimed: Stripe.Event
  try {
    claimed = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
  } catch {
    return { status: 400, body: { error: "The signature does not match." } }
  }

  try {
    const event = await stripe.events.retrieve(claimed.id)
    if (app && !belongsToApp(event, app, metadataKey)) {
      return { status: 200, body: { received: true, outcome: "not ours" } }
    }
    const outcome = await handle(event)
    return {
      status: 200,
      body: { received: true, ...(outcome ? { outcome } : {}) },
    }
  } catch (error) {
    log(`A Stripe event could not be handled: ${claimed.id}`, error)
    return {
      status: 500,
      body: { error: "Not handled; Stripe will try again." },
    }
  }
}

/**
 * An App Router POST handler around handleStripeWebhook. The body is read
 * as text, untouched, because Stripe signs the exact bytes it sent.
 */
export function stripeWebhookRoute(
  options: Omit<
    Parameters<typeof handleStripeWebhook>[0],
    "rawBody" | "signature" | "stripe" | "webhookSecret"
  > & {
    stripe: () => Pick<Stripe, "webhooks" | "events"> | null | undefined
    webhookSecret: () => string | null | undefined
  },
) {
  return async function POST(request: Request): Promise<Response> {
    const answer = await handleStripeWebhook({
      ...options,
      stripe: options.stripe(),
      webhookSecret: options.webhookSecret(),
      rawBody: await request.text(),
      signature: request.headers.get("stripe-signature"),
    })
    return Response.json(answer.body, { status: answer.status })
  }
}

/** A Node request's body, raw, for a pages-router route with bodyParser off. */
export async function readRawBody(
  request: AsyncIterable<Buffer | string>,
): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks)
}
