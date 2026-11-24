---
"@kaperkunde/tokens": minor
---

The buyer's own currency on refunds, a typed raw error code, and the resume rule (contract changes 40-41).

- `Purchase` gains optional `presentmentCurrency`, `presentmentTotalCents` and
  `refundablePresentmentCents`; `Refund` gains `presentmentAmountCents` and `presentmentCurrency`.
  `PurchaseList` shows the money back in the buyer's own currency, marked approximate, when they are
  present, and otherwise the purchase currency's figure worded "paid back in the currency you paid
  in, at the rate you paid". New labels `refundableApprox`, `refundConfirmApprox`,
  `refundConfirmButtonApprox`, `refundDoneApprox`, `refundStartedApprox`; `refundable` and
  `refundConfirm` now carry the same-rate wording. `presentmentCentsFor` works out a part refund.
  `formatMoney` honours a currency's own minor unit. The stub simulates it with
  `POST /stub/mode {"presentment":{"currency","rate"}}`.
- An error code the client does not know keeps the center's own string: `error.centerCode`
  (`detail.centerCode`), beside the status-class `code`, `action`, `retryAfterSeconds`,
  `refundableCreditMicros` and the message. A 5xx with such a code stays `center_unavailable` but
  keeps them too.
- `liftsPause(event)` in `@kaperkunde/tokens/server`: `purchase.completed`, `grant.received`, and
  `purchase.refund_failed` with `data.balance.availableMicros > 0` are the events to resume paused
  work on.
