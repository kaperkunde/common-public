---
"@kaperkunde/auth": minor
---

`mcpAuthPreset` types its plugins one by one (`McpPresetPlugins`), with any `extraPlugins` after them, so `betterAuth({...mcpAuthPreset(…)})` takes them without a cast and `auth.api` knows the endpoints they add (`getJwks`, the consent calls). 0.2.1 had widened them to `BetterAuthPlugin[]`, which lost those endpoints.
