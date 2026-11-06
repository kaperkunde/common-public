---
"@kaperkunde/security": minor
---

A new `@kaperkunde/security/redirect` entry exports `safeCallbackUrl` alone, so a login form in the browser can use it: the root entry pulls in `node:net` and `node:crypto`.
