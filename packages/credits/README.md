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

| Variable             | Default            | Meaning                                                                                                |
| -------------------- | ------------------ | ------------------------------------------------------------------------------------------------------ |
| `prefix`             | `credit_`          | Prefix of every function (`credit_admit`, ...) and, by default, of every table.                        |
| `schema`             | `public`           | Schema everything lives in.                                                                            |
| `owner_table`        | (required)         | The users table; quoted, so `user` is fine.                                                            |
| `owner_id_column`    | `id`               | Its primary key.                                                                                       |
| `owner_id_type`      | `text`             | That key's type.                                                                                       |
| `server_role`        | `server`           | The only Hasura role that may move money.                                                              |
| `user_role`          | `user`             | The signed-in person's role.                                                                           |
| `usage_table`        | `{{prefix}}usage`  | The ledger's full table name.                                                                          |
| `table_<name>`       | `{{prefix}}<name>` | Every other table's full name, one variable each (`table_model_prices`, `table_balances`, ...; below). |
| `min_purchase_cents` | `500`              | The smallest purchase or refill.                                                                       |

The tables, by logical name: `settings`, `model_prices`, `model_price_kinds`, `kind_fallbacks`,
`price_factors`, `dollar_rates`, `balances`, `pool_budgets`, `pool_periods`, `free_grants`,
`grants`, `own_backends`, `sale_prices`, `stripe_events`, `purchases`, `autorefill`,
`price_proposals`, `cost_reconciliations`. An app that changes any of them hands the same map to
the TypeScript side (`names: { prefix, usageTable, tables: { model_prices: "model_prices" } }`
on `createCredits` and `createStore`). Constraint, index and trigger names keep the prefix.

The functions check the role with
`current_setting('hasura.user', true)::json ->> 'x-hasura-role'`, which Hasura sets on every
transaction. Talking to Postgres directly, set it yourself: `pgExecutor` does.

The migrations ship no prices: seed your own models, factors (`price_factors`: e.g.
`inference_geo`/`us` 1.1, `service_tier`/`batch` 0.5, a model's `speed`/`fast` 2), the ratio and
the budget. A prompt-and-answer price sets `input` and `output` together; one without the other
is refused. `kind_fallbacks` is seeded with the usual cache multiples of `input` (reads 0.1x,
five-minute writes 1.25x, hour-long writes 2x); change or delete them as your provider charges.
They are read only when a price is set: `set_model_price` writes every kind they work out onto
that version, marked `derived`, and a call is priced from its version's own rows alone. So a
changed multiple applies to prices set from then on and never reprices a call already made (or
a reconciliation already written); set the price again to take it up.

Credits are sold only in currencies counted in hundredths (eur, usd, gbp, chf, ...): every amount
is cents, typed, said and sent to Stripe as `unit_amount` as such. Zero-decimal currencies (jpy,
krw, clp, ..., and isk) and three-decimal ones (kwd, bhd, jod, omr, tnd) are refused by the
database's currency checks (`two_decimal_currency`), by `isCurrency`, and by `createPurchases`
when they are configured.

## Functions (all server-only)

| Function                                                             | What                                                                                                                                                                                |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{{prefix}}admit(user, model?, kinds?)`                              | Refuses a call whose model's price cannot charge `kinds` (default `input`, `output`); expires old free credits; refills from the pool if the user has nothing; answers the balance. |
| `{{prefix}}would_admit(user, model?, kinds?)`                        | The same question, changing nothing (read-only, unchecked).                                                                                                                         |
| `{{prefix}}missing_kinds(model, kinds, at?)`                         | The kinds the price in force cannot charge; empty when it can.                                                                                                                      |
| `{{prefix}}spend(usage_id)`                                          | Prices one ledger row at the price and ratio in force when it was made and takes it, free first; idempotent.                                                                        |
| `{{prefix}}pending_usage(max_rows)`                                  | Ledger rows written and never spent, oldest first: what `spendPending` retries.                                                                                                     |
| `{{prefix}}grant(user, amount, reason, admin_email)`                 | Into `purchased`; a correction never below nothing.                                                                                                                                 |
| `{{prefix}}claim_out_notice(user)`                                   | Claims "tell them they ran out" once a month.                                                                                                                                       |
| `{{prefix}}set_model_price(model, kinds, ...)`                       | A price version, whole, with the kinds its fallbacks work out written onto it.                                                                                                      |
| `{{prefix}}purchase_open`, `refill_claim`, `credit`, `refill_failed` | Buying; `credit` is keyed on the Stripe event id.                                                                                                                                   |
| `{{prefix}}apply_proposal(id)`                                       | A synced price applied from now.                                                                                                                                                    |

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
Say which kind of usage the call will be priced by: nothing (or `kind: "llm"`) for a
prompt-and-answer call, which needs `input` and `output` priced; `kind: "tts_chars"` for a
metered one. A call its model's price cannot charge is refused as `UNPRICED` before it runs.
`wouldAdmit(userId, { model, kind })` asks the same without handing anything out.

`onUsage` writes the row first and spends it second. A spend that fails (a kind priced after
all, a ratio not yet set) is logged and the row handed back with `credits` null; nothing is
thrown, since the call already happened. **Call `credits.spendPending()` from a cron** (every few
minutes): it spends every such row once a price covers it and names the ones still waiting in
`stillPending`, so an unpriced call is charged late rather than never.

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

## Adopting in an app that already has these tables

An app that built its own credits before this package (prices, a ledger, balances, Stripe
purchases) keeps its live tables and data:

1. Map every table onto the name it already has: `table_model_prices: "model_prices"`,
   `table_price_factors: "price_factors"`, `table_stripe_events: "stripe_events"`,
   `table_own_backends: "ai_backends"`, `table_price_proposals: "model_price_proposals"`,
   `table_cost_reconciliations: "provider_cost_reconciliations"`, `table_sale_prices:` your
   price-per-million table, `usage_table:` your ledger. Give the TypeScript side the same map.
2. Write your own migration that brings each existing table to this package's shape (below),
   before the package's versions are synced.
3. List the package's baseline versions under `adopted` in `kaperkunde.json`, so `kk-hasura sync`
   records them in the lock without writing them; later versions sync as usual. Check that
   every function the baseline creates exists in your migration too, under `{{prefix}}`. A
   package whose versions are all adopted writes no metadata: track its tables yourself.

What the bridging migration usually has to do (compare each table with the rendered baseline;
`kk-hasura sync` into a scratch directory renders it):

- [ ] **Column renames** to the package's names: token counts in the unit's name become
      `credits` (`tokens` → `credits`, `thresholdTokens` → `thresholdCredits`; on the ledger
      `<unit>Tokens` → `credits`, `free…`/`purchased…`/`overdraft…` → `freeCredits`,
      `purchasedCredits`, `overdraftCredits`); `longPromptTokens` → `longPromptUnits`.
- [ ] **Order values** on the own-key table: `<unit>_then_own` → `credits_then_own`,
      `own_then_<unit>` → `own_then_credits`, `<unit>_only` → `credits_only`; replace the CHECK.
- [ ] **Prices from columns to versions and kind rows**: a price row with `inputUsd`, `outputUsd`,
      `cacheReadUsd`, ... becomes one `model_prices` version (with an `id`) and one
      `model_price_kinds` row per kind (`input`, `output`, `cache_read`, `cache_write`,
      `cache_write_1h`), a null cache price written as the derived multiple (`derived = true`);
      drop the price columns only after nothing reads them.
- [ ] **A fast-mode factor column → factor rows**: each model's `fastFactor` becomes a
      `price_factors` row (`model`, `dimension = 'speed'`, `value = 'fast'`); global factors keep
      `model` null, and a factors table keyed on `kind` renames it to `dimension`.
- [ ] **A settings table with extra columns** may stay as it is, under `table_settings`, as long
      as it has `id boolean`, `allotment` and `updatedAt`; the package reads and writes nothing
      else of it.
- [ ] **Constraints and indexes** the package's functions rely on: the unique keys
      (`model_prices (model, "effectiveFrom")`, `stripe_events (id)`, `purchases ("stripeId")`),
      the CHECKs on currencies and on own-key rows costing nothing, and `ON CONFLICT` targets
      (`balances ("userId")`, `pool_periods ("periodStart")`).
- [ ] **Data**: unspent ledger rows (`credits` null) are spent by `spendPending` once priced;
      balances, purchases and grants carry over as they are.

## Tests

`pnpm test` runs the pure tests everywhere. The template tests render the package through
`kk-hasura sync` itself (`@kaperkunde/hasura/sync`, so build that package first). The SQL tests
(`src/sql.test.ts`) run the rendered migrations against a real Postgres, once with the default
names and once under an app's own table names, when `CREDITS_TEST_DATABASE_URL` names one the
test may create databases on (`postgres://postgres@127.0.0.1:5432/postgres`); otherwise they are
skipped.

The metadata templates are generated by `scripts/metadata.py`; run it after a migration adds a
column.
