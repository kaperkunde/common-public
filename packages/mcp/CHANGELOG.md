# @kaperkunde/mcp

## 0.2.0

### Minor Changes

- 28cd704: `awaitPatiently`, `PatienceOptions` and `LongSpec` take the outcome type as a parameter (`Out`, `Outcome` by default), so an app whose tools answer in a shape of its own uses them without a cast.

## 0.1.1

### Patch Changes

- b03b4af: Every export now has a `default` condition beside `import`, so the packages also resolve from CommonJS: a `playwright.config.ts` in an app without `"type": "module"`, or a `next.config` that Next compiles to CommonJS. Node 24 `require()`s the ES module directly, so no second build is shipped.

## 0.1.0

### Minor Changes

- b104c8b: First release: the MCP tool factory (strict zod inputs published as JSON Schema 2020-12, all four annotations, one validator before anything runs, outcomes as kinds, rules across arguments under allOf, aliases, inner tools), the shared write-result shape with `no_change`, long tools with progress and a patient "still going" answer, annotations from a tool's class of action, the owner-by-link helpers (`/owner`), and catalogue checks for tests (`/testing`).
