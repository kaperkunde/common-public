# @kaperkunde/legal

## 0.1.1

### Patch Changes

- b03b4af: Every export now has a `default` condition beside `import`, so the packages also resolve from CommonJS: a `playwright.config.ts` in an app without `"type": "module"`, or a `next.config` that Next compiles to CommonJS. Node 24 `require()`s the ES module directly, so no second build is shipped.

## 0.1.0

### Minor Changes

- e34781a: First numbered release. 0.0.0 went out with the other packages' first release because legal had no changeset of its own; this is the same code under a real version.
