---
"@kaperkunde/auth": minor
---

A new `@kaperkunde/auth/forms` entry gives the form helpers (`validatePassword`, `withResetPasswordEmail`, `authErrorMessage`, `oauthRedirectFrom` and their constants) without anything server-only, so a client component can import them. The root entry pulls in `node:crypto`.
