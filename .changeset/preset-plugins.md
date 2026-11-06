---
"@kaperkunde/auth": patch
---

`mcpAuthPreset`'s `extraPlugins` is typed as Better Auth plugins and the returned `plugins` is `BetterAuthPlugin[]`, so it type-checks in `betterAuth({…})` without a cast.
