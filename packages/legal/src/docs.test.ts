import { rmSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { gitBlobSha } from "./blob"
import {
  appRoot,
  COMMIT,
  DOC_COMMIT,
  docsPackage,
  packageSite,
} from "./fixture.test-helper"
import { isLegalManifest, legalDocVersion } from "./manifest"
import { defineLegalSite } from "./site"
import {
  getLegalDocsProblem,
  legalDocsSource,
  readLegalDoc,
  readLegalManifest,
} from "./server"
import { findBrokenLegalLinks } from "./testing"

const corpus = {
  "pcpgg/terms.md":
    "# Terms of Use\n\nSee [privacy](privacy.md#what-we-keep).\n",
  "pcpgg/privacy.md":
    "# Privacy\n\n## What we keep\n\n[PCP](../pcp/terms.md)\n",
  "pcpgg/subprocessors.md": "# Subprocessors\n",
  "privacy.md": "# Policy\n\n[hosting](hosting/README.md)\n",
  "pcp/terms.md": "# PCP terms\n",
  "hosting/README.md": "# Hosting\n",
  "hosting/tos.md": "# Terms of Service\n",
}

const docs = packageSite.docs

describe("reading from @kaperkunde/legal-docs", () => {
  it("finds the package in the app's node_modules", () => {
    const { app, dir } = docsPackage(corpus)
    const source = legalDocsSource({ resolveFrom: app })
    expect(source).toMatchObject({ kind: "docs", dir, fromPackage: true })
  })

  it("reads a document at its path in the legal repository", async () => {
    const { app } = docsPackage(corpus)
    expect(
      await readLegalDoc(packageSite.doc("/terms"), { resolveFrom: app }),
    ).toBe(corpus["pcpgg/terms.md"])
  })

  it("prefers the package to a submodule beside it", async () => {
    const { app } = docsPackage(corpus)
    const withSubmodule = {
      ...packageSite.doc("/terms"),
      filePath: "legal/pcpgg/terms.md",
    }
    expect(await readLegalDoc(withSubmodule, { resolveFrom: app })).toBe(
      corpus["pcpgg/terms.md"],
    )
  })

  it("hands over each document's version", () => {
    const { app } = docsPackage(corpus)
    const manifest = readLegalManifest({ resolveFrom: app })
    expect(manifest.commit).toBe(COMMIT)
    expect(legalDocVersion(manifest, "hosting/tos.md")).toEqual({
      blob: gitBlobSha(corpus["hosting/tos.md"]),
      commit: DOC_COMMIT,
      date: "2026-09-09T12:20:56+00:00",
      tag: null,
    })
    expect(() => legalDocVersion(manifest, "nope.md")).toThrow(
      /nope\.md is not in the @kaperkunde\/legal-docs manifest/,
    )
  })

  it("refuses a manifest format it does not know", () => {
    const { app } = docsPackage(corpus, (m) => ({ ...m, format: 2 }))
    expect(() => readLegalManifest({ resolveFrom: app })).toThrow(
      /not a format this version/,
    )
  })
})

describe("getLegalDocsProblem against the package", () => {
  it("is happy when every document is there and as the manifest says", async () => {
    const { app } = docsPackage(corpus)
    expect(
      await getLegalDocsProblem({
        docs,
        blobShas: { "hosting/tos.md": gitBlobSha(corpus["hosting/tos.md"]) },
        resolveFrom: app,
      }),
    ).toBeNull()
  })

  it("names a file that did not reach the build", async () => {
    const { app, dir } = docsPackage(corpus)
    rmSync(path.join(dir, "pcpgg/terms.md"))
    expect(await getLegalDocsProblem({ docs, resolveFrom: app })).toMatch(
      /missing from @kaperkunde\/legal-docs@1\.0\.22 .*: pcpgg\/terms\.md .*outputFileTracingIncludes/,
    )
  })

  it("names a document the manifest does not publish", async () => {
    const { app } = docsPackage(corpus, (m) => {
      const { "pcpgg/subprocessors.md": _dropped, ...documents } = m.documents
      return { ...m, documents }
    })
    expect(await getLegalDocsProblem({ docs, resolveFrom: app })).toMatch(
      /not published in @kaperkunde\/legal-docs@1\.0\.22: pcpgg\/subprocessors\.md/,
    )
  })

  it("names a document that differs from the manifest", async () => {
    const { app } = docsPackage(corpus, (m) => ({
      ...m,
      documents: {
        ...m.documents,
        "pcpgg/terms.md": {
          ...m.documents["pcpgg/terms.md"]!,
          blob: gitBlobSha("other words"),
        },
      },
    }))
    expect(await getLegalDocsProblem({ docs, resolveFrom: app })).toMatch(
      /differ from the ones recorded in @kaperkunde\/legal-docs@1\.0\.22: pcpgg\/terms\.md/,
    )
  })

  it("holds an app's own recorded blob as well", async () => {
    const { app } = docsPackage(corpus)
    expect(
      await getLegalDocsProblem({
        docs,
        blobShas: { "hosting/tos.md": gitBlobSha("an older version") },
        resolveFrom: app,
      }),
    ).toMatch(/differ .*: hosting\/tos\.md/)
  })
})

describe("docsRoot", () => {
  it("reads a directory laid out as the legal repository", async () => {
    const root = appRoot(corpus)
    expect(
      await readLegalDoc(packageSite.doc("/privacy"), { docsRoot: root }),
    ).toBe(corpus["pcpgg/privacy.md"])
    expect(
      await getLegalDocsProblem({
        docs,
        blobShas: { "hosting/tos.md": gitBlobSha("changed") },
        docsRoot: root,
      }),
    ).toMatch(/differ from the ones recorded in .*: hosting\/tos\.md/)
  })

  it("has no manifest where the directory holds none", () => {
    expect(() => readLegalManifest({ docsRoot: appRoot(corpus) })).toThrow(
      /no readable manifest\.json/,
    )
  })

  it("wins over an installed package", async () => {
    const { app } = docsPackage(corpus)
    const root = appRoot({ ...corpus, "pcpgg/terms.md": "submodule words\n" })
    expect(
      await readLegalDoc(packageSite.doc("/terms"), {
        docsRoot: root,
        resolveFrom: app,
      }),
    ).toBe("submodule words\n")
  })
})

describe("without the package", () => {
  it("falls back to each document's filePath under the working directory", () => {
    const nowhere = appRoot({ "package.json": "{}" })
    expect(legalDocsSource({ resolveFrom: nowhere })).toEqual({
      kind: "files",
      root: process.cwd(),
    })
  })

  it("says what to install for a document with no filePath", () => {
    const nowhere = appRoot({ "package.json": "{}" })
    expect(() =>
      readLegalDoc(packageSite.doc("/terms"), { resolveFrom: nowhere }),
    ).toThrow(/add @kaperkunde\/legal-docs to the app's dependencies/)
    expect(() => readLegalManifest({ resolveFrom: nowhere })).toThrow(
      /not installed/,
    )
  })

  it("tells an app that has moved over that the package is not in the build", async () => {
    const nowhere = appRoot({ "package.json": "{}" })
    expect(await getLegalDocsProblem({ docs, resolveFrom: nowhere })).toMatch(
      /@kaperkunde\/legal-docs is not installed, or did not reach this build, so pcpgg\/terms\.md, .* cannot be served .*outputFileTracingIncludes/,
    )
  })
})

describe("findBrokenLegalLinks against the package", () => {
  it("passes links to routes, headings and files the package ships", () => {
    const { app } = docsPackage(corpus)
    expect(
      findBrokenLegalLinks({
        site: packageSite,
        commit: COMMIT,
        resolveFrom: app,
      }),
    ).toEqual([])
  })

  it("reports a link to a file the package does not ship", () => {
    const { app } = docsPackage({
      ...corpus,
      "privacy.md": "# Policy\n\n[changes](CHANGELOG.md)\n",
    })
    expect(
      findBrokenLegalLinks({
        site: packageSite,
        commit: COMMIT,
        resolveFrom: app,
      }),
    ).toEqual(["privacy.md: CHANGELOG.md -> CHANGELOG.md is not there"])
  })
})

describe("isLegalManifest", () => {
  it("reads the shape scripts/manifest.mjs writes", () => {
    const manifest = {
      format: 1,
      repository: "kaperkunde/legal",
      commit: COMMIT,
      date: "2026-10-06T12:35:47+00:00",
      documents: {
        "hosting/tos.md": {
          blob: "7556119945320c58717b75907d252b216c49f69c",
          commit: "e1c0df20b05788b164fb5b01a192d02935a82f7d",
          date: "2026-09-09T12:20:56+00:00",
          tag: {
            name: "hosting-tos-2026.3",
            commit: "1367c524beb58c60312d34b33f75211769357220",
            current: false,
          },
        },
      },
    }
    expect(isLegalManifest(manifest)).toBe(true)
    // What an app's JSON import infers is a LegalManifest as it stands.
    expect(legalDocVersion(manifest, "hosting/tos.md").commit).toBe(
      "e1c0df20b05788b164fb5b01a192d02935a82f7d",
    )
    expect(isLegalManifest({ ...manifest, format: 2 })).toBe(false)
    expect(isLegalManifest({ ...manifest, documents: { x: {} } })).toBe(false)
    expect(isLegalManifest(null)).toBe(false)
  })
})

describe("the package installed beside this one", () => {
  // fixtures/legal-docs, linked as the devDependency: what an app gets with
  // `pnpm add @kaperkunde/legal-docs` and no options at all.
  const tos = { sourcePath: "hosting/tos.md" }
  const site = defineLegalSite({
    docs: [
      { path: "/tos", label: "Terms", title: "Terms", description: "", ...tos },
      {
        path: "/privacy",
        sourcePath: "privacy.md",
        label: "Privacy",
        title: "Privacy",
        description: "",
      },
    ],
  })

  it("is found with no options", async () => {
    const manifest = readLegalManifest()
    expect(legalDocVersion(manifest, "hosting/tos.md").commit).toBe(
      "e1c0df20b05788b164fb5b01a192d02935a82f7d",
    )
    expect(await readLegalDoc(tos)).toMatch(/^# Terms of Service\n/)
    expect(await getLegalDocsProblem({ docs: site.docs })).toBeNull()
    expect(findBrokenLegalLinks({ site, commit: manifest.commit })).toEqual([])
  })

  it("is the shape a JSON import of manifest.json has", async () => {
    const { default: manifest } = await import(
      "@kaperkunde/legal-docs/manifest.json",
      { with: { type: "json" } }
    )
    expect(isLegalManifest(manifest)).toBe(true)
    expect(legalDocVersion(manifest, "privacy.md").tag?.name).toBe(
      "privacy-2026.11",
    )
  })
})
