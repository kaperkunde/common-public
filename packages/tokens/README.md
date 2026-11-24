# @kaperkunde/tokens

The client for the Token Center: the service that sits between an app and its
AI providers, meters every call and keeps the user's token balance. An app
points its model calls at the center, mounts a few routes, verifies a webhook,
and draws the wallet with the components here.

One package, four entry points:

| Entry                           | Runs      | What                                                                                                                                      |
| ------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `@kaperkunde/tokens`            | anywhere  | The contract types, error codes and header names; unit formatting; `TokenCenterError`; `createTokenApi`, the browser's client             |
| `@kaperkunde/tokens/server`     | Node ≥ 22 | `createTokenCenter` (app API client), `gatewayConfig`, `chargeFromHeaders`, `tokenErrorOf`, `verifyWebhook`, `tokenRoutes`, `nodeHandler` |
| `@kaperkunde/tokens/react`      | browser   | `TokenBalance`, `BuyTokens`, `AutoRefill`, `UsageList`, `PurchaseHistory`, `OwnModelForm`, `BackendOrderSwitch` and the hooks             |
| `@kaperkunde/tokens/styles.css` | opt-in    | A neutral default theme on `--tk-*` variables                                                                                             |
| `@kaperkunde/tokens/stub`       | tests     | A stand-in center, `startStub()` and the `tokens-stub` command                                                                            |

React ≥ 19 is an optional peer (only `/react` needs it). Nothing here names a
center: its address is configuration.

```sh
pnpm add @kaperkunde/tokens
```

Money is integer **micro-dollars** (`Micros`, 1 USD = 1,000,000) and fiat is
integer **cents**. An app shows balances in its own unit (`Balance.unit`, e.g.
"credits" at 1,000,000 per dollar, so one token is one micro-dollar).

## Server setup

One client per process, made from configuration:

```ts
// lib/tokens.ts
import { createTokenCenter } from "@kaperkunde/tokens/server"

export const center = createTokenCenter({
  baseUrl: process.env.TOKENS_URL!, // the center, e.g. https://tokens.example.com
  apiKey: process.env.TOKENS_APP_KEY!, // tk_live_… — server side only
})
```

Every method is typed and throws a `TokenCenterError` with the contract's
`code`, the HTTP `status` and the whole `detail`. **A center that cannot be
reached, times out or answers a 5xx with no contract body is
`center_unavailable`: fail closed**, never fall back to calling a provider
directly.

```ts
import { isTokenError } from "@kaperkunde/tokens"

try {
  const balance = await center.balance(user.id)
} catch (error) {
  if (isTokenError(error, "center_unavailable")) {
    /* pause the job, show the message */
  }
  if (isTokenError(error, "insufficient_balance")) {
    /* offer <BuyTokens>; error.action === "buy_tokens" */
  }
}
```

A `TokenCenterError` also exposes `path` (an `invalid_request` refusal names the
offending field, e.g. `tools[0].type` for an unpriced server tool, `amountCents`,
`body`) and `callId` (the `x-token-call-id` of a failed or refused call, so you
can find it in the ledger). A charge on an estimate (`CallCharge.estimated`) is
a call that was cut short; `provider_error` (502) covers a provider failure and
a problem with the center's own provider key, never with the provider's text,
and `forbidden` (403) a test key used where no test provider is set.

Provider refusals: `provider_out_of_credit` (503, `error.provider`, `error.model`) means the
center's own account with that AI provider is out of credit; nothing is charged and asking
again is pointless until an admin tops up, so an app should pause that feature for a while
rather than retry. `provider_rate_limited` (429) and `provider_overloaded` (503) are upstream
conditions worth one retry; `error.retryable` (`RETRYABLE_ERROR_CODES`) says which codes can work again, and
`error.detail.retryAfterSeconds` carries `Retry-After`. A speech answer names the voice it
used in place of the one asked for in `x-token-voice-fallback` (`SpeechResult.voiceFallback`,
`voiceFallbackFromHeaders`).

### Model calls: the gateway

Point an AI SDK provider at the center, with the payer in `x-token-user`:

```ts
import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { gatewayConfig, gatewayHeaders } from "@kaperkunde/tokens/server"

const config = gatewayConfig({
  baseUrl: process.env.TOKENS_URL!,
  apiKey: process.env.TOKENS_APP_KEY!,
  user: owner.id, // who pays: your own user id
  email: owner.verifiedEmail, // optional, stored on the center's user row
})

const anthropic = createAnthropic(config) // /messages, prompt caching untouched
const compatible = createOpenAICompatible({ name: "tokens", ...config })

// Attribution per call, for the ledger and your own correlation:
await generateText({
  model: anthropic("claude-sonnet-5-5"),
  headers: gatewayHeaders({
    user: owner.id,
    attribution: {
      purpose: "storyteller",
      activity: "Telling the next scene",
      scope: world.id,
      job: job.id,
      correlation: usageRow.id, // your own ledger row
    },
  }),
  prompt,
})
```

Attribution values are `encodeURIComponent`-encoded and cut to 200 characters,
as the center expects. `backend: "own"` sends a chat-completions call to the
user's own endpoint; ask `center.route({ userId, model, needs })` which
backend to use and with which model.

What a call cost, from the response headers or the ledger:

```ts
import { chargeFromHeaders, parseTrailer } from "@kaperkunde/tokens/server"

const charge = chargeFromHeaders(result.response.headers) // non-streamed
// { callId, source, model, costMicros, feeMicros, chargedMicros, balanceAfterMicros } (HeaderCharge)
// null for a stream (no cost yet): callIdFromHeaders(headers) gives its id, then wait for the charge.
const call = await center.call(charge.callId, { wait: 10 }) // long-polls ≤ 30 s
// or: gatewayConfig({ …, trailer: true }) and parseTrailer(sseText)
// or, for a multi-step call keyed by your own row:
const { calls, totals } = await center.calls(user.id, {
  correlation: usageRow.id,
})
```

A thrown gateway error is mapped back to the contract's code, whatever the SDK
made of it:

```ts
import { tokenErrorOf } from "@kaperkunde/tokens/server"

try {
  await generateText({ … })
} catch (error) {
  const failure = tokenErrorOf(error) // TokenCenterError | null
  if (failure?.code === "insufficient_balance") pauseJob("cap:tokens")
  else if (failure?.code === "center_unavailable") pauseJob("center")
  else throw error
}
```

Speech is the one gateway call that is not a provider SDK's:
`const { audio, chars, charge } = await center.speech({ user: owner.id }, { input, voice })`.

### Browser routes: `tokenRoutes`

The browser never holds the app key. It calls routes **your app** mounts; they
read your own session, put that user in and call the center. The browser cannot
name another user.

```ts
import { tokenRoutes } from "@kaperkunde/tokens/server"

export const handler = tokenRoutes(center, {
  basePath: "/api/tokens", // where it is mounted (default)
  origin: process.env.APP_ORIGIN, // the origin Stripe returns the browser to
  userOf: async (request) => {
    const session = await auth.api.getSession({ headers: request.headers })
    return session
      ? {
          id: session.user.id,
          email: session.user.emailVerified ? session.user.email : null,
        }
      : null // 401
  },
})
```

It serves `GET app | models | balance | calls | history | sale-prices |
autorefill | own-endpoint | purchase/:id | purchases`, `POST checkout | card |
own-endpoint/test | purchases/:id/refund`, `PUT autorefill | own-endpoint | backend-order` and
`DELETE card | own-endpoint`. The return URLs for Stripe are built from
`origin` and the browser's `returnPath` (only a path on your own origin is
honoured); they must be under the app's registered return origins on the
center. Replace them with `returnUrls`.

**App router** (`app/api/tokens/[...op]/route.ts`):

```ts
import { handler } from "@/lib/tokens-routes"
export { handler as GET, handler as POST, handler as PUT, handler as DELETE }
```

**Pages router** (`pages/api/tokens/[...op].ts`), through the small Node adapter:

```ts
import { nodeHandler } from "@kaperkunde/tokens/server"
import { handler } from "@/utils/tokensRoutes"

export const config = { api: { bodyParser: false } }
export default nodeHandler(handler)
```

`nodeHandler` also takes a body Next already parsed. It trusts
`x-forwarded-proto` and `x-forwarded-host` for the URL it builds; pass
`{ trustForwarded: false }` if no proxy of yours sits in front.

### Refunds

Bought credit that is still unspent can be refunded, in full or in part, to the
card it was paid with. `center.purchases(userId)` lists the paid purchases
(newest first) with `refundableCreditMicros` / `refundableCents` and what has
been refunded; `center.refund(userId, purchaseId, { creditMicros? }, {
idempotencyKey })` refunds all of it when `creditMicros` is left out and answers
a `Refund`: `succeeded` (the center answered 201) or `pending` (202; Stripe has
not confirmed yet and the center settles it, `purchase.refunded` or
`purchase.refund_failed` follows). The **key is yours and required**: reuse it
to retry the same refund after a timeout, never for another. `refundCentsFor(
purchase, creditMicros)` works out the money back (the center's rule: pro rata
of what was paid, tax included, rounded down) to show before asking.

The refusals are a `TokenCenterError`: `refund_not_available` (409; nothing
unspent, or with `action: "wait"` and `retryAfterSeconds` while a call of the
user's is running), `refund_amount_invalid` (400) and
`refund_refused_by_processor` (409, nothing was taken). The first two carry
`error.refundableCreditMicros` (also on `error.detail`).

The browser side, with the signed-in user only: `GET purchases` and `POST
purchases/:id/refund` (body `{ creditMicros? }`, and an `Idempotency-Key`
header, which the route refuses to go without), as `api.purchases()` and
`api.refund(purchaseId, input, idempotencyKey)` on `createTokenApi`. The
`PurchaseList` component lists the purchases with what can be refunded and asks
first, showing the money back, before refunding all of one; `PurchaseHistory`
draws the `refund` history entry.

**Tolerate what you do not know.** The center adds history entry types,
webhook types and error codes. An unknown history entry is skipped, an unknown
webhook type is acknowledged with 200 (`onUnknown` on `webhookRoute` sees it;
`verifyWebhook` and `parseWebhookEvent` return an `UnknownWebhookEvent`, which
`isKnownWebhookEvent` tells from the typed ones), and an unknown error code
becomes its status class's (a 409 is `conflict`) with the center's own message.

### Webhooks

The center posts signed events (`grant.received`, `purchase.completed`,
`purchase.refunded`, `purchase.refund_failed`, `balance.low`, `balance.empty`, `autorefill.failed`, `grant.expired`). Verify
the **raw body**, then handle idempotently on `event.id`: deliveries repeat
and arrive out of order.

```ts
import { webhookRoute } from "@kaperkunde/tokens/server"

export const POST = webhookRoute({
  secret: () => process.env.TOKENS_WEBHOOK_SECRET!, // an array while you rotate
  handlers: {
    "purchase.completed": async (event) => {
      if (await seen(event.id)) return
      await notifyUser(event.data.userId, event.data.purchase)
    },
    "balance.empty": async (event) => pauseWorkFor(event.data.userId),
    "grant.received": async (event) => resumeWorkFor(event.data.userId),
  },
})
```

A bad signature or body answers 400, a throwing handler 500 (the center
retries from one minute to 24 hours), anything else 200. To do it by hand:
`verifyWebhook(rawBody, request.headers.get("token-signature"), secret, {
toleranceSeconds })` returns the typed event or throws a
`WebhookVerificationError` (`reason`: `malformed`, `signature`, `stale`,
`body`); the compare is constant-time and the tolerance 300 s. In the pages
router use `nodeHandler(webhookRoute(…))` with `bodyParser: false`.

## Components

Components read colours, radius, font and spacing only from CSS variables, and
carry stable `tk-*` class names. No Tailwind, no CSS modules. Each takes
`className` (root), `classNames` (per part, e.g. `{ button: "my-button" }`),
`labels` (English strings, all overridable) and `basePath` (default
`/api/tokens`); without data props it loads its own from your mounted routes.

```tsx
import "@kaperkunde/tokens/styles.css" // optional
import {
  TokensProvider,
  TokenBalance,
  BuyTokens,
  AutoRefill,
  UsageList,
  PurchaseHistory,
  PurchaseList,
  OwnModelForm,
} from "@kaperkunde/tokens/react"

;<TokensProvider basePath="/api/tokens" labels={{ buyTitle: "Buy credits" }}>
  <TokenBalance href="/ai/tokens" /> {/* compact pill: "84k credits" */}
  <TokenBalance variant="full" /> {/* breakdown, next expiry, shortfall */}
  <BuyTokens returnPath="/ai/tokens" />{" "}
  {/* the app's packs and bounds come from the center (purchaseOptions); packsOnly hides "Other amount" */}
  <AutoRefill returnPath="/ai/tokens" />
  <UsageList query={{ scope: world.id }} /> {/* cost, cache share, purpose */}
  <PurchaseHistory />
  <PurchaseList /> {/* paid purchases, what is refundable, a confirm step */}
  <OwnModelForm />{" "}
  {/* BYO (also exported as OwnEndpointForm): address, write-only key, models, tool choice, order, test */}
</TokensProvider>
```

- **Forms say what is missing**: a button is never disabled for an empty
  field; pressing it names what is still needed ("Still needed: Address,
  Models.") and the center's own errors are shown in words. `disabled` is only
  for a write in flight.
- **Accessible and narrow**: real labels (with "(needed)"), `aria-pressed`
  segmented controls, `role="alert"` and `role="status"` messages, 44 px tall
  targets, inputs at 16 px under 560 px so iOS does not zoom, and everything
  wraps at 375 px.
- **Hooks**: `useBalance`, `useCalls`, `useHistory`, `useSalePrices`,
  `useAutoRefill`, `useOwnEndpoint`, `usePurchases`, `useAppInfo` return
  `{ data, error, loading, refresh }`, poll while the tab is visible and load
  again on focus; `refreshTokens()` reloads all of them after you spend or buy
  something yourself. `useTokenApi(basePath)` is the typed client of your
  routes (`createTokenApi` outside React).
- **Data in, callbacks out** for testing or a custom screen: `TokenBalance
balance={…}`, `BuyTokens onCheckout={…} onRedirect={…}`, `AutoRefill
value={…} onSave={…}`, `UsageList page={…}`, `OwnModelForm endpoint={…}
onSave={…} onTest={…}`.

## Theming: `--tk-*`

`styles.css` defines every variable for light and dark (`prefers-color-scheme`,
or `data-theme="light|dark"` on `<html>`) on `:where(:root)`, specificity zero,
so any rule of yours wins. Skip the file and style the `tk-*` classes yourself,
or set the variables where you want them:

| Variable         | Used for                                       |
| ---------------- | ---------------------------------------------- |
| `--tk-font`      | font family                                    |
| `--tk-fg`        | text                                           |
| `--tk-muted`     | secondary text                                 |
| `--tk-bg`        | the page behind a panel (inputs, buttons)      |
| `--tk-surface`   | panels, the pill                               |
| `--tk-border`    | lines around panels, inputs and buttons        |
| `--tk-accent`    | primary button, the pressed segment            |
| `--tk-accent-fg` | text on `--tk-accent`                          |
| `--tk-danger`    | errors, destructive buttons, an empty balance  |
| `--tk-ok`        | success notices                                |
| `--tk-focus`     | the focus ring                                 |
| `--tk-radius`    | corner radius                                  |
| `--tk-gap`       | the spacing unit inside a panel                |
| `--tk-tap`       | the least height of anything pressable (44 px) |

```css
/* Map onto your own design tokens */
:root {
  --tk-font: var(--app-font);
  --tk-fg: var(--app-text);
  --tk-muted: var(--app-text-muted);
  --tk-bg: var(--app-bg);
  --tk-surface: var(--app-surface);
  --tk-border: var(--app-border);
  --tk-accent: var(--app-accent);
  --tk-accent-fg: var(--app-accent-ink);
  --tk-danger: var(--app-danger);
}
```

The parts you can address with `classNames` / CSS: `panel`, `title`, `form`,
`field`, `label`, `hint`, `input`, `textarea`, `check`, `switch`, `button`
(`tk-button--primary|danger|quiet`), `actions`, `segmented`, `segment`,
`notice` (`tk-notice--error|ok|info`), `balance` (`tk-balance--pill|full|empty`),
`breakdown`, `list`, `row` (`tk-row__main|title|meta|amount`) and the helper
`tk-hide-narrow` (hides the pill's unit name under 430 px).

## Units

```ts
import {
  formatUnits,
  formatCompact,
  formatMoney,
  unitsOf,
  creditFor,
} from "@kaperkunde/tokens"

formatUnits(8_000_000, unit) // "8,000,000 credits"
formatUnits(84_000, unit, { compact: true }) // "84k credits"
formatCompact(1_234_000) // "1.2M"
formatMoney(1000, "eur") // "€10.00"
creditFor(1000, { centsPerDollar: 100 }) // 10_000_000 micros
```

## Testing against the stub

`@kaperkunde/tokens/stub` is a dependency-free stand-in for the center, the
same one the contract ships: in-memory wallet, the canned or forwarded
provider answers, the app API, signed webhooks and a few test controls. Use it
in an app's end-to-end tests and CI so no network or private service is needed.

```sh
TOKENS_STUB_PORT=4100 \
TOKENS_STUB_OPENAI_UPSTREAM=http://localhost:3009/v1 \
TOKENS_STUB_EXTRA_MODELS=fake-model \
TOKENS_STUB_WEBHOOK_URL=http://localhost:3001/api/tokens/webhook \
  npx tokens-stub
```

```ts
import { startStub } from "@kaperkunde/tokens/stub"

const stub = await startStub({
  port: 0, // any free port
  key: "tk_test_e2e", // the only key accepted (any non-empty key when unset)
  webhookUrl: "http://localhost:3001/api/tokens/webhook",
  webhookSecret: "whsec_e2e",
  upstream: { openai: "http://localhost:3009/v1" }, // forward to your fake LLM
  extraModels: ["fake-model"],
  unitOne: "credit",
  unitMany: "credits",
})
// stub.url, stub.reset(), await stub.close()
```

Options map onto `TOKENS_STUB_PORT`, `_KEY`, `_WEBHOOK_URL`, `_WEBHOOK_SECRET`,
`_ANTHROPIC_UPSTREAM`, `_OPENAI_UPSTREAM`, `_OWN_UPSTREAM`, `_EXTRA_MODELS`,
`_PACKS` / `_PACKS_ONLY` (the app's packs, default 500,1000,2500,5000), `_START_MICROS` (a new user starts with $5), `_FEE_BPS` (2000), `_UNIT_ONE`,
`_UNIT_MANY` and `_REPLY`; an option wins over its variable.

Fixed prices: every model $3 / $15 per million tokens in / out, so a canned
call costs 600 micros (720 charged from purchased, fee included); speech is $15
per million characters. A model id containing `unpriced` answers
`model_not_priced`.

Test controls (no auth; the real center has none of these):

| Call                                                                                                                           | Does                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /stub/reset`                                                                                                             | Forget everything                                                                                                                                                                                                                                                                                                                         |
| `POST /stub/mode {"down":true}`                                                                                                | Every call answers 503 `center_unavailable` (fail-closed tests)                                                                                                                                                                                                                                                                           |
| `POST /stub/mode {"providerError":true}`                                                                                       | Gateway calls answer 502 `provider_error`                                                                                                                                                                                                                                                                                                 |
| `POST /stub/mode {"fail":"out_of_credit"}` (or env `TOKENS_STUB_FAIL`, the `fail` option, or the request header `x-stub-fail`) | Gateway calls answer 503 `provider_out_of_credit` (provider, model, `x-should-retry: false`); `"rate_limited"` 429 `provider_rate_limited` + `Retry-After: 7`; `"overloaded"` 503 `provider_overloaded`; `null` clears it. Speech does not fail: `stub-voice` falls back to `stub-voice-eleven` and answers with `x-token-voice-fallback` |
| `POST /stub/mode {"refundRefused":true}` / `{"refundPending":true}`                                                            | A refund answers `refund_refused_by_processor` (nothing taken) / is left `pending` (202, no webhook)                                                                                                                                                                                                                                      |
| `POST /stub/balance {"userId","purchasedMicros"}`                                                                              | Set purchased (0 → `insufficient_balance` on the next call)                                                                                                                                                                                                                                                                               |
| `POST /stub/grant {"userId","micros","provider"?,"expiresAt"?}`                                                                | Add a lot and send `grant.received`                                                                                                                                                                                                                                                                                                       |
| `POST /stub/expire {"lotId"}`                                                                                                  | Expire a lot, send `grant.expired`                                                                                                                                                                                                                                                                                                        |
| `POST /stub/autorefill-fail {"userId"}`                                                                                        | Turn auto-refill off, send `autorefill.failed`                                                                                                                                                                                                                                                                                            |
| `GET /stub/checkout/:purchaseId`                                                                                               | The "Stripe page": pays, credits, sends `purchase.completed`, 303 back                                                                                                                                                                                                                                                                    |
| `GET /stub/card/:userId?to=`                                                                                                   | Saves a Visa ending 4242 and redirects to `to`                                                                                                                                                                                                                                                                                            |
| `GET /stub/state`                                                                                                              | Every balance and call, for assertions                                                                                                                                                                                                                                                                                                    |

A Playwright test follows the checkout URL the app returns and lands on the
app's success URL with the wallet credited. The stub's webhooks are signed
exactly as the center signs them, so `webhookRoute` can be tested end to end.
Refunds are simulated (the purchase list, `Idempotency-Key` per purchase, the wallet and
`purchase.refunded`); a refund never fails late. Not simulated: the in-flight cap, rate limits, other idempotency keys, Stripe, tax,
auto-refill charges and own-endpoint limits.

## Contract

`CONTRACT_VERSION` (1) names the contract these types and the stub follow. A
change that breaks a client is a new major version of this package.

Speech from the stub is a short run of real, silent MP3 frames, so an audio
element plays it. EUR sells at 121 cents per dollar of credit, USD at 100.
