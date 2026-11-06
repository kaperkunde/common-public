# @kaperkunde/config

## 0.1.2

### Patch Changes

- 372d63e: The lint-staged preset passes `--no-warn-ignored` to ESLint, so a staged file the ESLint config ignores (generated code, say) no longer fails `--max-warnings 0`.

## 0.1.1

### Patch Changes

- b03b4af: Every export now has a `default` condition beside `import`, so the packages also resolve from CommonJS: a `playwright.config.ts` in an app without `"type": "module"`, or a `next.config` that Next compiles to CommonJS. Node 24 `require()`s the ES module directly, so no second build is shipped.

## 0.1.0

### Minor Changes

- 596a1eb: First release: ESLint (Next 16 flat), Prettier, tsconfig, Vitest, Playwright and lint-staged presets, and the shared Renovate preset.
