---
"@kaperkunde/tokens": minor
---

Token Center refunds of unspent bought credit (contract changes 31-39).

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

**Type-level note:** `verifyWebhook` and `parseWebhookEvent` now return `WebhookEvent |
UnknownWebhookEvent` instead of throwing for a type they do not know; narrow with
`isKnownWebhookEvent(event)` before switching on `event.type`. `webhookRoute` handlers are unchanged.
