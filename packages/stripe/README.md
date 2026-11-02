# @kaperkunde/stripe

The Stripe webhook every app writes, checked the same way: the raw body's
signature against the endpoint's own secret, the event fetched back from
Stripe by id (only that is believed), and on a shared account only events
whose object carries the app's `metadata.app` marker. The app's handler does
the rest, idempotently, recording the event id in the same transaction as
what it credits.

```ts
// app/api/stripe/webhook/route.ts
export const POST = stripeWebhookRoute({
  stripe: stripeClient,
  webhookSecret: () => process.env.STRIPE_WEBHOOK_SECRET,
  app: "plekje",
  handle: handlePlekjeEvent,
})
```

Pages router: `handleStripeWebhook({ …, rawBody: await readRawBody(req), signature })`
with `export const config = { api: { bodyParser: false } }`.

`liveKeysOnDevelopment(isDev, { STRIPE_SECRET_KEY, … })` says why a development
deployment holding live keys must refuse Stripe; `stripeKeyMode` reads a key's
mode.
