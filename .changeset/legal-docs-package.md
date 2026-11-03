---
"@kaperkunde/legal": minor
---

Read the documents from `@kaperkunde/legal-docs`, the package kaperkunde/legal now publishes, instead of a `legal` submodule. The package is an optional peer, and where it is installed `readLegalDoc`, `getLegalDocsProblem` and `findBrokenLegalLinks` read each document at its `sourcePath` from it. The boot check also holds every document to the blob its manifest records. `readLegalManifest` (server) and `legalDocVersion` (pure, for an imported `manifest.json`) give the commit the package was made from and, for each document, the last commit that changed it, its date and its tag. That covers what the generated version file held, including plek.je's `HOSTING_TOS_COMMIT`. `docsRoot` reads a directory instead, and `resolveFrom` says where to find the package.

Without the package nothing changes: each document is still read at its `filePath` from the working directory, and `kaperkunde-legal sync|check` still writes and checks the version file. So an app moves over in a pull request of its own. `LegalDoc.filePath` is now optional (leave it out once the package is installed). `readLegalDoc` takes `{ sourcePath, filePath? }` rather than `{ filePath }` alone. For Next.js standalone output, see `outputFileTracingIncludes` in the README.
