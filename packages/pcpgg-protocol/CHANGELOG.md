# @kaperkunde/pcpgg-protocol

## 0.1.1

### Patch Changes

- b03b4af: Every export now has a `default` condition beside `import`, so the packages also resolve from CommonJS: a `playwright.config.ts` in an app without `"type": "module"`, or a `next.config` that Next compiles to CommonJS. Node 24 `require()`s the ES module directly, so no second build is shipped.

## 0.1.0

### Minor Changes

- bff554e: First release: pcp.gg's tunnel protocol (frames, mux, control), the connector PCP embeds (targets may be functions), and the relay with its Directory interface.
