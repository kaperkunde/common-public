---
"@kaperkunde/auth": patch
"@kaperkunde/config": patch
"@kaperkunde/legal": patch
"@kaperkunde/mail": patch
"@kaperkunde/mcp": patch
"@kaperkunde/next-kit": patch
"@kaperkunde/pcpgg-protocol": patch
"@kaperkunde/security": patch
"@kaperkunde/stripe": patch
"@kaperkunde/ui": patch
---

Every export now has a `default` condition beside `import`, so the packages also resolve from CommonJS: a `playwright.config.ts` in an app without `"type": "module"`, or a `next.config` that Next compiles to CommonJS. Node 24 `require()`s the ES module directly, so no second build is shipped.
