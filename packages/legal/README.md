# @kaperkunde/legal

Rendering and checking the [kaperkunde/legal](https://github.com/kaperkunde/legal)
documents a site publishes. The words come from `@kaperkunde/legal-docs`, which
kaperkunde/legal publishes on every change as `1.0.<n>`: the markdown at its
paths in that repository, and a `manifest.json` saying where each document
stands (its blob SHA, the last commit that changed it, that commit's date, its
latest release tag). Renovate merges a new patch like any other.

| Export                             | Does                                                                              |
| ---------------------------------- | --------------------------------------------------------------------------------- |
| `defineLegalSite`                  | The site's table of documents: route, `sourcePath`, label, title; link resolution |
| `legalDocVersion`, `LegalManifest` | One document's blob, last-changed commit, date and tag, from the manifest (pure)  |
| `splitTitle`, `gitBlobSha`         | The leading `# Title` off a document; git's blob hash                             |
| `/server` `readLegalDoc`           | A document's markdown, read once per process                                      |
| `/server` `readLegalManifest`      | The installed package's manifest                                                  |
| `/server` `getLegalDocsProblem`    | Boot check: every document there and exactly what the manifest records            |
| `/react` `LegalMarkdown`           | The markdown drawn with the site's links, heading ids and scrolling tables        |
| `/testing` `findBrokenLegalLinks`  | Every relative link in the documents that lands nowhere                           |

```sh
pnpm add @kaperkunde/legal @kaperkunde/legal-docs
```

`@kaperkunde/legal-docs` is an optional peer: the app depends on it directly, so
the version it serves is in its own lockfile.

## Using it

```ts
// lib/legal/docs.ts
export const legalSite = defineLegalSite({
  docs: [
    { path: "/terms", sourcePath: "pcpgg/terms.md", label: "Terms", title: "Terms of Use", description: "…" },
    { path: "/privacy/kaperkunde", sourcePath: "privacy.md", label: "Kaperkunde policy", title: "…", description: "…" },
  ],
})

// app/terms/page.tsx
const doc = legalSite.doc("/terms")
const { body } = splitTitle(await readLegalDoc(doc))
return <LegalMarkdown markdown={body} sourcePath={doc.sourcePath} commit={readLegalManifest().commit} site={legalSite} />

// instrumentation.ts
await runBootChecks([() => getLegalDocsProblem({ docs: legalSite.docs })])
```

`manifest.commit` takes the place of the generated `LEGAL_COMMIT`. It is the
commit the package was made from, and links to documents the site does not
publish go to GitHub at that commit.

### An acceptance that follows one document

What an app records acceptance against is the last commit that changed that
document. Corrections to the other documents leave it where it is. For plek.je's
Terms of Service, the manifest can be imported outright. A bundler inlines it,
so this also works in client code and needs no file tracing:

```ts
import { legalDocVersion } from "@kaperkunde/legal"
import manifest from "@kaperkunde/legal-docs/manifest.json" with { type: "json" }

/** What HOSTING_TOS_COMMIT was: `git log -1 -- hosting/tos.md` in kaperkunde/legal. */
export const HOSTING_TOS_COMMIT = legalDocVersion(
  manifest,
  "hosting/tos.md",
).commit
```

The manifest's `blob` replaces `HOSTING_TOS_BLOB_SHA`, and `getLegalDocsProblem`
already holds every document to it.

### Next.js standalone output

Standalone output copies only the files it sees a module import. The markdown is
read from disk, so `next.config` has to name the package:

```ts
// next.config.ts
outputFileTracingIncludes: {
  // "*", not "/*": the keys match route names, and "/*" misses "/".
  "*": ["./node_modules/@kaperkunde/legal-docs/**/*"],
},
```

This was checked with Next 16.3 (Turbopack), a pnpm-style symlinked
`node_modules` and the app's own `node_modules` removed at run time. Without the
entry the image has no documents, and `getLegalDocsProblem` says so at boot. A
document read only at build time (`getStaticProps`, a fully static page)
needs no entry. Nothing is ever fetched at run time.

## Moving over from the `legal` submodule

Without `@kaperkunde/legal-docs` installed, everything reads each document's
`filePath` from the working directory, as before, so an app moves over in a
pull request of its own:

1. Add `@kaperkunde/legal-docs` (and the `outputFileTracingIncludes` entry).
2. Drop `filePath` from the site's table. Take the commit from
   `readLegalManifest().commit` or the JSON import, and a tracked document's
   commit from `legalDocVersion`.
3. Delete the submodule (`git rm legal`, and its `.gitmodules` entry), the
   generated version file, `legal.config.json`, the `legal:sync` and
   `legal:check` scripts and their CI step, the Dockerfile's fallback clone,
   and the tests that compared the version file with the submodule pointer.

Where the package is installed it wins over a submodule beside it. `docsRoot`
reads a directory laid out as the legal repository instead, such as a submodule
checkout or a test fixture. `resolveFrom` says where to look for the package;
it defaults to the working directory and then this module.

### The submodule path

`kaperkunde-legal sync|check` writes and verifies the generated version file
from a `legal` submodule (configured in `legal.config.json`). An app that reads
the package needs neither.
