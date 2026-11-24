# @kaperkunde/tokens

## 0.2.0

### Minor Changes

- d30dfb0: Token Center refunds of unspent bought credit (contract changes 31-39).

  - `center.purchases(userId, { limit?, cursor? })` lists paid purchases; `Purchase` gains the optional
    `refundableCreditMicros`, `refundableCents`, `refundedCreditMicros` and `refundedCents`.
  - `center.refund(userId, purchaseId, { creditMicros? }, { idempotencyKey })` returns a `Refund` (201
    settled, 202 `pending`). The key is the caller's and required. `refundCentsFor` works out the money
    back to show before asking.
  - Error codes `refund_not_available`, `refund_amount_invalid` and `refund_refused_by_processor`;
    `TokenCenterError.refundableCreditMicros` and `TokenErrorDetail.refundableCreditMicros`.
  - The `refund` history entry, and the webhooks `purchase.refunded` and `purchase.refund_failed`.
  - Browser side: `tokenRoutes` serves `GET purchases` and `POST purchases/:id/refund` for the signed-in
    user only (an `Idempotency-Key` header is required), `createTokenApi` gets `purchases()` and
    `refund()`, and `/react` gets `PurchaseList` (what is refundable, a confirm step showing the money
    back), `usePurchases`, `refundProblem` and the `refund` row in `PurchaseHistory`.
  - The stub simulates purchases listing and refunds (`/stub/mode {"refundRefused"|"refundPending"}`).
  - Unknown values never throw: an unknown history entry type is skipped by `PurchaseHistory` (and
    `historyLine` returns `null`), an unknown webhook type is acknowledged with 200 (`webhookRoute`
    `onUnknown`), and an unknown error code becomes its status class's with the center's own message.

  - `PurchaseList` refunds everything or a typed amount in tokens (up to `refundableCreditMicros`), shows
    the money back before confirming, takes a fresh key per confirmation, retries once after a `wait` hint
    and points to support when the processor refuses; all copy overrides through `labels`.

  **Type-level note:** `verifyWebhook` and `parseWebhookEvent` now return `WebhookEvent |
UnknownWebhookEvent` instead of throwing for a type they do not know; callers that narrow the result may need a guard: use
  `isKnownWebhookEvent(event)` before switching on `event.type`. `webhookRoute` handlers are unchanged.

## 0.1.1

### Patch Changes

- 25075a8: Teach the client the Token Center's provider refusals: `provider_out_of_credit` (503, with
  `provider` and `model` in the detail; nothing charged, do not retry until an admin tops up),
  `provider_rate_limited` (429, with `Retry-After`) and `provider_overloaded` (503, retryable), plus
  `TokenCenterError.retryable` and `RETRYABLE_ERROR_CODES`. `SpeechResult.voiceFallback` and `voiceFallbackFromHeaders` expose
  the `x-token-voice-fallback` header. The stub simulates all of them through `fail` (env
  `TOKENS_STUB_FAIL`, `POST /stub/mode`, the `x-stub-fail` header), with a second voice for the speech fallback.

## 0.1.0

### Minor Changes

- 62e4807: New package: the client for the Token Center, the service that meters every
  model call and keeps users' token balances.

  - `@kaperkunde/tokens`: the contract types (v1), error codes and header names,
    `TokenCenterError` with the center's `code`, `status`, `path` and `callId`,
    unit and money formatting, and the browser's client for the routes an app
    mounts.
  - `@kaperkunde/tokens/server`: a typed app API client that fails closed
    (`center_unavailable`), gateway config and per-call attribution headers for AI
    SDK providers, `chargeFromHeaders` / `callIdFromHeaders`, `tokenErrorOf`,
    webhook verification and a `webhookRoute`, and `tokenRoutes`, a Web
    `Request` handler that keeps the app key off the browser, with a Node adapter
    for the Next pages router.
  - `@kaperkunde/tokens/react`: `TokenBalance`, `BuyTokens` (follows the app's
    packs and bounds), `AutoRefill`, `UsageList`, `PurchaseHistory`,
    `OwnModelForm` (with a tool-choice setting) and hooks, on `--tk-*` CSS
    variables with no Tailwind or CSS modules; forms say what is missing instead
    of disabling their button (`BuyTokens` alone disables its button, and only when
    the center says payments are unavailable, with the reason shown beside it).
  - `@kaperkunde/tokens/styles.css`: a neutral light and dark theme.
  - `@kaperkunde/tokens/stub` and the `tokens-stub` command: a stand-in center
    (including playable silent speech audio) for end-to-end tests and CI.
