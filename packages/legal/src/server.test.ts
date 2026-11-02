import { describe, expect, it } from "vitest"

import { gitBlobSha } from "./blob"
import { appRoot, site } from "./fixture.test-helper"
import { getLegalDocsProblem, readLegalDoc } from "./server"

const files = Object.fromEntries(
  site.docs.map((d) => [d.filePath, `# ${d.title}\n`]),
)

describe("gitBlobSha", () => {
  it("matches git hash-object", () => {
    // printf 'hello\n' | git hash-object --stdin
    expect(gitBlobSha("hello\n")).toBe(
      "ce013625030ba8dba906f756967f9e9ca394464a",
    )
  })
})

describe("getLegalDocsProblem", () => {
  it("is happy when every document is there and as recorded", async () => {
    const root = appRoot({ ...files, "legal/hosting/tos.md": "terms\n" })
    const problem = await getLegalDocsProblem({
      docs: site.docs,
      blobShas: { "hosting/tos.md": gitBlobSha("terms\n") },
      root,
    })
    expect(problem).toBeNull()
  })

  it("names a missing document", async () => {
    const root = appRoot({ "legal/privacy.md": "x" })
    expect(await getLegalDocsProblem({ docs: site.docs, root })).toMatch(
      /missing: legal\/pcpgg\/terms\.md/,
    )
  })

  it("names a document that differs from the one recorded", async () => {
    const root = appRoot(files)
    const problem = await getLegalDocsProblem({
      docs: site.docs,
      blobShas: { "pcpgg/terms.md": gitBlobSha("something else") },
      root,
    })
    expect(problem).toMatch(
      /differ from the ones recorded: legal\/pcpgg\/terms\.md/,
    )
  })
})

describe("readLegalDoc", () => {
  it("reads a document from the app root", async () => {
    const root = appRoot(files)
    expect(await readLegalDoc(site.doc("/terms"), root)).toBe(
      "# Terms of Use\n",
    )
  })
})
