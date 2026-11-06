# @kaperkunde/auth

## 0.1.1

### Patch Changes

- b03b4af: Every export now has a `default` condition beside `import`, so the packages also resolve from CommonJS: a `playwright.config.ts` in an app without `"type": "module"`, or a `next.config` that Next compiles to CommonJS. Node 24 `require()`s the ES module directly, so no second build is shipped.

## 0.1.0

### Minor Changes

- 60acb69: First release: the Better Auth MCP preset and discovery routes, MCP URLs, scope and consent checks, bearer challenges, opaque access tokens, and the auth forms' password rule, reset link and error messages.
