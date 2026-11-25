---
"@kaperkunde/tokens": patch
---

`PurchaseList` reads the typed partial-refund amount in its `locale`: "250,000" is 250000 tokens in `en`
rather than 250. New pure `parseUnits(text, locale)` in `units` drops the group separator and spaces,
takes the locale's decimal separator as the point, and returns `null` for anything else (the existing
invalid-amount message).
