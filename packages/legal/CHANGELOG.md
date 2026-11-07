# @kaperkunde/legal

## 0.3.1

### Patch Changes

- 40d4cc2: Published through npm trusted publishing (OIDC) from the release workflow, with no npm token. No code changes.

## 0.3.0

### Minor Changes

- 28cd704: `LegalMarkdown` takes `bare`, which leaves out its wrapping `<div>` so the document's elements go straight into the caller's container, where a rhythm such as `.prose > * + *` reaches them. The default is unchanged.

## 0.2.0

### Minor Changes

- 5bb07c8: Read the documents from `@kaperkunde/legal-docs`, the package kaperkunde/legal now publishes, instead of a `legal` submodule. The package is an optional peer, and where it is installed `readLegalDoc`, `getLegalDocsProblem` and `findBrokenLegalLinks` read each document at its `sourcePath` from it. The boot check also holds every document to the blob its manifest records. `readLegalManifest` (server) and `legalDocVersion` (pure, for an imported `manifest.json`) give the commit the package was made from and, for each document, the last commit that changed it, its date and its tag. That covers what the generated version file held, including plek.je's `HOSTING_TOS_COMMIT`. `docsRoot` reads a directory instead, and `resolveFrom` says where to find the package.

  Without the package nothing changes: each document is still read at its `filePath` from the working directory, and `kaperkunde-legal sync|check` still writes and checks the version file. So an app moves over in a pull request of its own. `LegalDoc.filePath` is now optional (leave it out once the package is installed). `readLegalDoc` takes `{ sourcePath, filePath? }` rather than `{ filePath }` alone. For Next.js standalone output, see `outputFileTracingIncludes` in the README.

## 0.1.1

### Patch Changes

- b03b4af: Every export now has a `default` condition beside `import`, so the packages also resolve from CommonJS: a `playwright.config.ts` in an app without `"type": "module"`, or a `next.config` that Next compiles to CommonJS. Node 24 `require()`s the ES module directly, so no second build is shipped.

## 0.1.0

### Minor Changes

- e34781a: First numbered release. 0.0.0 went out with the other packages' first release because legal had no changeset of its own; this is the same code under a real version.
