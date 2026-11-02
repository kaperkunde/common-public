import { describe, expect, it } from "vitest"

import { COMMIT, site } from "./fixture.test-helper"
import { isAbsoluteHref, splitTitle } from "./site"

const resolve = (href: string, from: string) =>
  site.resolveHref(href, from, COMMIT)

describe("resolveHref", () => {
  it("leaves absolute links alone", () => {
    for (const href of [
      "https://pcp.gg/security",
      "mailto:privacy@kaperkun.de",
      "tel:+31000000000",
      "//example.com/x",
    ]) {
      expect(isAbsoluteHref(href)).toBe(true)
      expect(resolve(href, "pcpgg/privacy.md")).toBe(href)
    }
  })

  it("keeps a bare fragment on the document's own page", () => {
    expect(resolve("#the-app", "pcpgg/privacy.md")).toBe("/privacy#the-app")
  })

  it("maps sibling documents to their routes", () => {
    expect(resolve("terms.md#7-the-app", "pcpgg/privacy.md")).toBe(
      "/terms#7-the-app",
    )
    expect(resolve("privacy.md", "pcpgg/terms.md")).toBe("/privacy")
  })

  it("walks up and down the repository", () => {
    expect(resolve("../privacy.md#9-your-rights", "pcpgg/privacy.md")).toBe(
      "/privacy/kaperkunde#9-your-rights",
    )
    expect(resolve("./pcpgg/subprocessors.md", "privacy.md")).toBe(
      "/subprocessors",
    )
  })

  it("sends unpublished documents to GitHub at the pinned commit", () => {
    expect(resolve("../pcp/terms.md#2-x", "pcpgg/terms.md")).toBe(
      `https://github.com/kaperkunde/legal/blob/${COMMIT}/pcp/terms.md#2-x`,
    )
  })
})

describe("the document table", () => {
  it("finds a document by route and by source", () => {
    expect(site.doc("/terms").sourcePath).toBe("pcpgg/terms.md")
    expect(site.docByPath("/nope")).toBeUndefined()
    expect(() => site.doc("/nope")).toThrow(/No legal document/)
    expect(site.pathForSource("privacy.md")).toBe("/privacy/kaperkunde")
  })
})

describe("splitTitle", () => {
  it("takes the leading heading off", () => {
    expect(splitTitle("\n# Terms of Use #\n\nBody\n")).toEqual({
      title: "Terms of Use",
      body: "Body\n",
    })
  })

  it("leaves a document without one as it is", () => {
    expect(splitTitle("Body")).toEqual({ title: null, body: "Body" })
  })
})
