import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { compile } from "@tailwindcss/node"
import { describe, expect, it } from "vitest"

const src = path.dirname(fileURLToPath(import.meta.url))
const dist = path.join(src, "..", "dist")

function filesIn(directory: string, pattern: RegExp): string[] {
  return readdirSync(directory, { recursive: true, encoding: "utf8" })
    .filter((file) => pattern.test(file))
    .map((file) => path.join(directory, file))
}

const sources = filesIn(src, /\.(tsx?|css)$/).filter(
  (file) =>
    !file.includes(`${path.sep}themes${path.sep}`) &&
    !/\.test\.tsx?$/.test(file),
)
const components = filesIn(src, /\.tsx?$/).filter(
  (file) => !/\.test\.tsx?$/.test(file),
)
const themes = readdirSync(path.join(src, "themes")).map((file) =>
  path.basename(file, ".css"),
)

/** The variables a theme must set: every `var(--x)` base.css maps without a fallback. */
const requiredTokens = [
  ...readFileSync(path.join(src, "base.css"), "utf8").matchAll(
    /--color-[\w-]+: var\(--([\w-]+)\);/g,
  ),
].map((match) => match[1]!)

/** Every word in the components, as Tailwind's scanner would offer them. */
const candidates = [
  ...new Set(
    components
      .map((file) => readFileSync(file, "utf8"))
      .join(" ")
      .split(/[\s"'`{}]+/),
  ),
]

async function build(theme: string, extra: string[] = []) {
  const compiler = await compile(
    `@import "tailwindcss";\n@import "./base.css";\n@import "./themes/${theme}.css";\n`,
    { base: src, onDependency: () => {} },
  )
  return { css: compiler.build([...candidates, ...extra]), compiler }
}

describe("the token contract", () => {
  it("writes no colour outside a theme", () => {
    const offenders = sources.flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .map((line, index) => ({ line, number: index + 1 }))
        .filter(({ line }) =>
          /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i.test(line),
        )
        .map(({ number }) => `${path.relative(src, file)}:${number}`),
    )
    expect(offenders).toEqual([])
  })

  it.each(themes)("%s sets every base token", (theme) => {
    const css = readFileSync(path.join(src, "themes", `${theme}.css`), "utf8")
    const missing = requiredTokens.filter(
      (token) => !new RegExp(`--${token}:`).test(css),
    )
    expect(missing).toEqual([])
  })
})

describe("Tailwind", () => {
  it.each(themes)("builds the components' classes with %s", async (theme) => {
    const { css, compiler } = await build(theme)
    expect(compiler.sources).toEqual([
      { base: src, pattern: "./", negated: false },
    ])
    for (const rule of [
      ".bg-primary",
      ".h-control-md",
      ".px-control-md-x",
      ".text-control-md",
      ".rounded-control-md",
      ".rounded-badge",
      ".shadow-card",
      ".peer-checked\\:bg-segment-active",
      ".bg-overlay",
      ".px-gutter",
      ".focus-ring",
      ".h-field",
      ".text-card-title",
      ".font-control",
      ".font-control-primary",
      ".font-badge",
      ".text-badge",
      ".px-badge-x",
      ".font-segment",
      ".px-\\(--card-px\\)",
      ".px-\\(--card-slot-px\\)",
      ".border-\\[length\\:var\\(--segment-border-width\\,0px\\)\\]",
    ]) {
      expect(css.includes(`${rule} {`) || css.includes(`${rule}:`), rule).toBe(
        true,
      )
    }
    expect(css).toContain("@media (max-width: 560px)")
    expect(css).toContain("env(safe-area-inset-left, 0px)")
    expect(css).toContain("overflow-wrap: break-word")
  })

  it("lets a theme reshape the controls and the radius scale", async () => {
    const { css } = await build("plekje", ["rounded-xl"])
    expect(css).toContain("--spacing-control-md: 2rem;")
    expect(css).toContain("--card-slots: 1;")
    expect(css).toContain("--font-weight-control-primary: 500;")
    expect(css).toContain("--badge-destructive-tint: 10%;")
    expect(css).toContain("--segment-border-width: 1px;")
    expect(css).toContain("font-weight: var(--font-weight-control-primary)")
    expect(css).toContain(
      "--card-px: calc(var(--card-pad) * (1 - var(--card-slots,0)))",
    )
    expect(css).toContain("border-radius: calc(var(--radius) * 1.4)")
    const pcp = (await build("pcp", ["rounded-xl"])).css
    expect(pcp).toContain("border-radius: calc(var(--radius) * 1.33)")
  })

  it("sets each control's line where the sites had it", async () => {
    for (const theme of themes) {
      const { css } = await build(theme)
      expect(css, theme).toContain(
        "--text-control-xs--line-height: calc(1 / 0.75);",
      )
      expect(css, theme).toContain(
        "line-height: var(--tw-leading, var(--text-control-xs--line-height));",
      )
      expect(css, theme).toContain("--text-control-xl--line-height: 1.5;")
    }
    for (const theme of ["pcp-gg", "plekje"]) {
      const { css } = await build(theme)
      expect(css, theme).toContain(
        "--text-control-md--line-height: calc(1.25 / 0.875);",
      )
      expect(css, theme).toContain(
        "--text-control-lg--line-height: calc(1.25 / 0.875);",
      )
    }
    for (const theme of ["pcp", "studyguild"]) {
      const { css } = await build(theme)
      expect(css, theme).not.toContain("--text-control-md--line-height")
      expect(css, theme).not.toContain("--text-control-lg--line-height")
    }
    expect((await build("plekje")).css).toContain(
      "--text-badge--line-height: calc(1 / 0.75);",
    )
    expect((await build("pcp-gg")).css).not.toContain(
      "--text-badge--line-height",
    )
  })

  it("gives the extra-large button tokens, base-nova's on pcp.gg", async () => {
    const pcp = (await build("pcp")).css
    expect(pcp).toContain("--spacing-control-xl: 3rem;")
    expect(pcp).toContain(".h-control-xl {")
    const pcpGg = (await build("pcp-gg")).css
    expect(pcpGg).toContain("--spacing-control-xl: 2.75rem;")
    expect(pcpGg).toContain("--spacing-control-xl-x: 1.25rem;")
  })

  it("colours a placeholder by a token, 70% of the grey unless set", async () => {
    const { css } = await build("pcp")
    expect(css).toContain(".placeholder\\:text-placeholder::placeholder {")
    expect(css).toContain(
      "--placeholder,\n    color-mix(in oklab, var(--muted-foreground) 70%, transparent)",
    )
  })

  it("keeps the base rules' specificity while letting a field opt out", async () => {
    const { css } = await build("pcp")
    expect(css).toContain("summary:where(:not([data-marker])) {")
    expect(css).toContain(
      "summary:where(:not([data-marker]))::-webkit-details-marker {",
    )
    expect(css).toContain("select:where(:not([data-compact]))")
    expect(css).toContain("textarea:where(:not([data-compact]))")
    expect(css).toMatch(
      /input:not\(\[type="checkbox"\], \[type="radio"\], \[type="range"\]\):where\(\s*:not\(\[data-compact\]\)\s*\)/,
    )
    expect(css).toContain(
      ':is(h1, h2, h3, h4):where([data-slot="card-title"]) {',
    )
    expect(css).toContain("--card-title-tracking,")
    expect(css).toContain("--text-card-description: 13px;")
    expect(css).toContain("gap: var(--card-gap,calc(var(--spacing) * 4));")
    expect(css).toContain("border-width: var(--control-border-width,1px);")
  })

  it("keeps Study Guild's own names", async () => {
    const { css } = await build("studyguild", [
      "bg-paper",
      "text-ink",
      "shadow-brutal",
    ])
    expect(css).toContain("--color-paper: #f3eee3")
    expect(css).toContain(".shadow-brutal {")
  })

  it("lets Study Guild's muted be the paper, its grey the muted text", async () => {
    const { css } = await build("studyguild", ["bg-muted"])
    expect(css).not.toContain("--color-muted:")
    expect(css).toContain("--muted: var(--color-paper)")
    expect(css).toContain("--muted-foreground: #5e5850")
    expect(css).toMatch(/\.bg-muted \{\s*background-color: var\(--muted\);/)
  })

  it("keeps a colour a semantic token points at, used or not", async () => {
    const { css } = await build("studyguild")
    expect(css).toContain("--primary: var(--color-guild)")
    expect(css).toContain("--color-guild: #c9291f")
  })
})

describe.skipIf(!existsSync(dist))("the build", () => {
  const interactive = new Set([
    "copy-button",
    "dialog",
    "menu",
    "radio-group",
    "required-fields",
    "segmented-control",
    "submit-button",
    "tabs",
  ])

  it('keeps "use client" on the interactive files and nowhere else', () => {
    for (const file of filesIn(dist, /\.mjs$/)) {
      const name = path.basename(file, ".mjs")
      const client = readFileSync(file, "utf8").startsWith('"use client";')
      expect(client, name).toBe(interactive.has(name))
    }
  })

  it("ships the CSS beside the code", () => {
    expect(existsSync(path.join(dist, "base.css"))).toBe(true)
    for (const theme of themes) {
      expect(existsSync(path.join(dist, "themes", `${theme}.css`))).toBe(true)
    }
  })
})
