---
"@kaperkunde/tokens": minor
---

New package: the client for the Token Center. The contract types and error
codes, a typed app API client that fails closed, gateway config for AI SDK
providers with per-call attribution, charges read from response headers,
webhook verification, `tokenRoutes` for the browser (Web handler, with a Node
adapter for the Next pages router), React components for the balance, buying,
auto-refill, usage, history and a user's own model on `--tk-*` CSS variables,
and a stand-in center for end-to-end tests.

Follows contract changes 1-16: `HeaderCharge`, an own endpoint that is `null` instead of 404, `toolChoice`, the cache-write 5m/1h split, and the app's purchase options (packs, `packsOnly`, bounds) which `BuyTokens` follows.
