import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { COMMIT, site } from "./fixture.test-helper"
import { LegalMarkdown } from "./react"

describe("LegalMarkdown", () => {
  it("resolves links, ids headings and wraps tables", () => {
    const html = renderToStaticMarkup(
      <LegalMarkdown
        markdown={
          "## Your rights\n\n[terms](terms.md) [pcp](../pcp/terms.md)\n\n| a |\n| - |\n| b |\n"
        }
        sourcePath="pcpgg/privacy.md"
        commit={COMMIT}
        site={site}
        className="prose"
      />,
    )
    expect(html).toContain('<div class="prose">')
    expect(html).toContain('id="your-rights"')
    expect(html).toContain('href="/terms"')
    expect(html).toContain(
      `href="https://github.com/kaperkunde/legal/blob/${COMMIT}/pcp/terms.md" target="_blank" rel="noopener noreferrer"`,
    )
    expect(html).toContain('style="overflow-x:auto"><table>')
  })
})
