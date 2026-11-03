# @kaperkunde/stripe

## 0.1.1

### Patch Changes

- b03b4af: Every export now has a `default` condition beside `import`, so the packages also resolve from CommonJS: a `playwright.config.ts` in an app without `"type": "module"`, or a `next.config` that Next compiles to CommonJS. Node 24 `require()`s the ES module directly, so no second build is shipped.

## 0.1.0

### Minor Changes

- 8c0f307: First release: the checked Stripe webhook (signature, fetch-back, app marker) for both routers, and the live-key guard for development deployments.
