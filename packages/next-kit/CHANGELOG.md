# @kaperkunde/next-kit

## 0.1.2

### Patch Changes

- 40d4cc2: Published through npm trusted publishing (OIDC) from the release workflow, with no npm token. No code changes.

## 0.1.1

### Patch Changes

- b03b4af: Every export now has a `default` condition beside `import`, so the packages also resolve from CommonJS: a `playwright.config.ts` in an app without `"type": "module"`, or a `next.config` that Next compiles to CommonJS. Node 24 `require()`s the ES module directly, so no second build is shipped.

## 0.1.0

### Minor Changes

- 47fe6af: First release: Result and ActionState, site and operator helpers, robots/sitemap/llms.txt, dates and LocalDate, text and code utilities, Prisma (MariaDB) helpers with the migration check, and the once-per-run scheduler.
