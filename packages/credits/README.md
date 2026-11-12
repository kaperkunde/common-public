# @kaperkunde/credits

Usage credits for an app on Postgres (and Hasura): a priced usage ledger, balances, a monthly
free pool funded in dollars, admin grants, Stripe purchases with auto-refill, and a user's own
model key. Extracted from Lore Spawner's lore tokens.

An app names its credit unit. The admin sets a **dollar price per model and per kind of usage**
(prompt tokens, cache reads and writes, answer tokens, characters or seconds of speech, any kind
the app meters) and **one credits-per-dollar ratio**, so what a call costs in credits follows
what it really cost. Prices, factors and the ratio are histories: a call is priced at what was in
force when it was made, so a change never charges anything twice.

Each month (UTC) the admin funds a **free pool** in US dollars. A user with nothing left is
handed what is left of their monthly **allotment**, or what is left of the pool when that is
less, its dollars taken from the pool as it is handed out. Free credits expire at the end of the
month that granted them. Bought and granted credits never expire and are spent once the free
ones are gone. A call on the user's **own key** costs no credits and counts against the monthly
token limit they set.

All of it is decided in SQL, row-locked, by functions only the server role may call. The same
rules are in TypeScript, pure, for screens and tests.

## What ships

| Path                                                        | What                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hasura/manifest.json`                                      | The template variables (below).                                                                                                                                                                                                                                  |
| `hasura/migrations/<version>_<name>/{up,down}.sql`          | `credits_ledger` (prices, ledger, balances, pool, grants, own key), `credits_purchases` (Stripe), `credits_price_sync` (proposals, reconciliations).                                                                                                             |
| `hasura/metadata/tables/*.yaml.tmpl`, `functions.yaml.tmpl` | Permissions: the user role reads its own balance, usage, purchases, grants (never the admin's address), own back end (never the key) and the public prices; the server role reads everything and is the only role that may call a function; no AI role anywhere. |
| `@kaperkunde/credits`                                       | `createCredits`, `createStore`, `pgExecutor`, and the pure modules: `pricing`, `balance`, `pool`, `billing`, `grants`, `reconcile`, `units`.                                                                                                                     |
| `@kaperkunde/credits/stripe`                                | `createPurchases`: checkout, saving a card, the webhook handler, auto-refill.                                                                                                                                                                                    |
| `@kaperkunde/credits/feeds`                                 | Price feeds (a provider's pricing page, LiteLLM, OpenRouter), consensus and `syncPrices`.                                                                                                                                                                        |
| `@kaperkunde/credits/ui`                                    | `CreditsCard`, `ModelPricesPanel`, `RatioPanel`, `FreePoolPanel`, `GrantsPanel` on `@kaperkunde/ui`.                                                                                                                                                             |

## Template variables

The templates use `{{var}}` and nothing else; `kk-hasura sync` (`@kaperkunde/hasura`) renders
them into the app's migrations and metadata.

| Variable             | Default        | Meaning                                                          |
| -------------------- | -------------- | ---------------------------------------------------------------- |
| `prefix`             | `credit_`      | Prefix of every object (`credit_balances`, `credit_admit`, ...). |
| `schema`             | `public`       | Schema everything lives in.                                      |
| `owner_table`        | (required)     | The users table; quoted, so `user` is fine.                      |
| `owner_id_column`    | `id`           | Its primary key.                                                 |
| `owner_id_type`      | `text`         | That key's type.                                                 |
| `server_role`        | `server`       | The only Hasura role that may move money.                        |
| `user_role`          | `user`         | The signed-in person's role.                                     |
| `usage_table`        | `credit_usage` | The ledger's full table name.                                    |
| `min_purchase_cents` | `500`          | The smallest purchase or refill.                                 |

The functions check the role with
`current_setting('hasura.user', true)::json ->> 'x-hasura-role'`, which Hasura sets on every
transaction. Talking to Postgres directly, set it yourself: `pgExecutor` does.

The migrations ship no prices: seed your own models, factors (`price_factors`: e.g.
`inference_geo`/`us` 1.1, `service_tier`/`batch` 0.5, a model's `speed`/`fast` 2), the ratio and
the budget. `kind_fallbacks` is seeded with the usual cache multiples of `input` (reads 0.1x,
five-minute writes 1.25x, hour-long writes 2x); change or delete them as your provider charges.

## Functions (all server-only)

| Function                                                             | What                                                                                                         |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `{{prefix}}admit(user)`                                              | Expires old free credits; refills from the pool if the user has nothing; answers the balance.                |
| `{{prefix}}would_admit(user)`                                        | The same question, changing nothing (read-only, unchecked).                                                  |
| `{{prefix}}spend(usage_id)`                                          | Prices one ledger row at the price and ratio in force when it was made and takes it, free first; idempotent. |
| `{{prefix}}grant(user, amount, reason, admin_email)`                 | Into `purchased`; a correction never below nothing.                                                          |
| `{{prefix}}claim_out_notice(user)`                                   | Claims "tell them they ran out" once a month.                                                                |
| `{{prefix}}set_model_price(model, kinds, ...)`                       | A price version, whole.                                                                                      |
| `{{prefix}}purchase_open`, `refill_claim`, `credit`, `refill_failed` | Buying; `credit` is keyed on the Stripe event id.                                                            |
| `{{prefix}}apply_proposal(id)`                                       | A synced price applied from now.                                                                             |

## Wire it into an app

```ts
// lib/credits.ts (server only)
import pg from "pg"
import { createCredits, createStore, pgExecutor } from "@kaperkunde/credits"
import { createPurchases } from "@kaperkunde/credits/stripe"

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const db = pgExecutor(pool, { role: "server" })
const unit = { one: "credit", many: "credits" }

export const purchases = createPurchases({
  store: createStore(db),
  stripe: () => stripeClient(), // your Stripe client, or undefined when off
  app: "myapp", // metadata.app on everything made in a shared Stripe account
  product: {
    id: "myapp_credits",
    name: "My App credits",
    taxCode: "txcd_10000000",
  },
  currencies: { eur: "inclusive", usd: "exclusive" },
  unit,
  urls: {
    purchaseDone: `${origin}/credits?purchase=done`,
    purchaseCancelled: `${origin}/credits?purchase=cancelled`,
    cardSaved: `${origin}/credits?card=saved`,
    cardCancelled: `${origin}/credits?card=cancelled`,
  },
  onRefillFailed: (userId, message) => notify(userId, message),
})

export const credits = createCredits({
  db,
  unit,
  onOutOfCredits: (userId, message) => notify(userId, message),
  afterSpend: (userId) => purchases.maybeRefill(userId),
})
```

With `@kaperkunde/ai`, hand the hooks over:

```ts
createAi({
  beforeCall: ({ userId, model, source }) =>
    credits.beforeCall({ userId, model, source }),
  onUsage: (row) => credits.onUsage(row), // { userId, model, purpose, source, requests, scopeId?, jobId? }
})
// Text-to-speech, through the same ledger:
await credits.onUsage({
  userId,
  model: "voice-1",
  purpose: "speech",
  kind: "tts_chars",
  units: text.length,
})
```

`admit` answers a `Result` (`OUT_OF_CREDITS`, `UNPRICED`, `OWN_LIMIT`) for a route to turn into
a 429; `beforeCall` throws `CreditsRefusedError` with the same code for a hook that refuses by
throwing. Ask only when the call will run on credits: admitting is what hands out free credits.

The webhook, over `@kaperkunde/stripe`:

```ts
// app/api/stripe/webhook/route.ts
import { stripeWebhookRoute } from "@kaperkunde/stripe"
export const POST = stripeWebhookRoute({
  stripe: () => stripeClient(),
  webhookSecret: () => process.env.STRIPE_WEBHOOK_SECRET,
  app: "myapp",
  handle: purchases.handleEvent,
})
```

Admin screens take data from the store and callbacks that write through it:

```tsx
<FreePoolPanel
  status={await credits.store.poolStatus()}
  unit={unit}
  onSetBudget={(usd) => setBudget(usd)} // a server action calling store.setPoolBudget(usd, adminEmail)
  onSetAllotment={(n) => setAllotment(n)}
/>
```

A user's own key is sealed by the app (`@kaperkunde/security`'s secret box) before
`store.saveOwnBackend`; the sealed text is never selectable by the user role.

## Tests

`pnpm test` runs the pure tests everywhere. The SQL tests (`src/sql.test.ts`) render every
migration and run them against a real Postgres when `CREDITS_TEST_DATABASE_URL` names one the
test may create databases on (`postgres://postgres@127.0.0.1:5432/postgres`); otherwise they are
skipped.

The metadata templates are generated by `scripts/metadata.py`; run it after a migration adds a
column.
