import { describe, expect, it } from "vitest"

import { appRoot, COMMIT, site } from "./fixture.test-helper"
import { findBrokenLegalLinks } from "./testing"

describe("findBrokenLegalLinks", () => {
  it("passes links that land on a route, a heading or a real file", () => {
    const root = appRoot({
      "legal/pcpgg/terms.md":
        "# Terms\n\nSee [privacy](privacy.md#what-we-keep) and [PCP](../pcp/terms.md).\n",
      "legal/pcpgg/privacy.md": "# Privacy\n\n## What we keep\n",
      "legal/pcpgg/subprocessors.md": "# Subprocessors\n",
      "legal/privacy.md": "# Policy\n",
      "legal/pcp/terms.md": "# PCP terms\n",
    })
    expect(findBrokenLegalLinks({ site, commit: COMMIT, root })).toEqual([])
  })

  it("reports a missing heading and a missing file", () => {
    const root = appRoot({
      "legal/pcpgg/terms.md": "[a](privacy.md#nope) [b](../pcp/missing.md)\n",
      "legal/pcpgg/privacy.md": "# Privacy\n",
      "legal/pcpgg/subprocessors.md": "# Subprocessors\n",
      "legal/privacy.md": "# Policy\n",
    })
    expect(findBrokenLegalLinks({ site, commit: COMMIT, root })).toEqual([
      "pcpgg/terms.md: privacy.md#nope -> /privacy has no #nope",
      "pcpgg/terms.md: ../pcp/missing.md -> legal/pcp/missing.md is not there",
    ])
  })
})
