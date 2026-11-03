# @kaperkunde/security

## 0.1.1

### Patch Changes

- b03b4af: Every export now has a `default` condition beside `import`, so the packages also resolve from CommonJS: a `playwright.config.ts` in an app without `"type": "module"`, or a `next.config` that Next compiles to CommonJS. Node 24 `require()`s the ES module directly, so no second build is shipped.

## 0.1.0

### Minor Changes

- 47bc746: First release: rate limiting, client IP behind trusted proxies, safe redirects, same-origin checks, constant-time secret compares, signed link tokens, the admin check, the secret box boot checks, and `/net`: fetches that only reach public addresses, checked as the socket connects.
