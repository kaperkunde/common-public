# @kaperkunde/tokens

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
