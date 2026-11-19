import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8")
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8")

const defined = (block: string) =>
  new Set([...block.matchAll(/(--tk-[a-z-]+)\s*:/g)].map((m) => m[1]!))

describe("styles.css", () => {
  const light = css.slice(
    css.indexOf(":where(:root) {"),
    css.indexOf("@media (prefers-color-scheme: dark)"),
  )
  const darkMedia = css.slice(
    css.indexOf("@media (prefers-color-scheme: dark)"),
    css.indexOf(':where(:root[data-theme="dark"])'),
  )
  const darkAttr = css.slice(
    css.indexOf(':where(:root[data-theme="dark"])'),
    css.indexOf(".tk-panel,"),
  )
  const all = defined(light)

  it("defines every variable it uses, and documents each in the README", () => {
    const used = new Set(
      [...css.matchAll(/var\((--tk-[a-z-]+)\)/g)].map((m) => m[1]!),
    )
    for (const name of used)
      expect(all.has(name), `${name} undefined`).toBe(true)
    for (const name of all)
      expect(readme.includes(`\`${name}\``), `${name} undocumented`).toBe(true)
  })

  it("redefines every colour for dark, by media query and by attribute", () => {
    const colours = [...all].filter((n) => !/(radius|gap|tap|font)$/.test(n))
    for (const name of colours) {
      expect(
        defined(darkMedia).has(name),
        `${name} missing in dark media`,
      ).toBe(true)
      expect(
        defined(darkAttr).has(name),
        `${name} missing in data-theme=dark`,
      ).toBe(true)
    }
  })

  it("keeps inputs at 16px on a phone", () => {
    expect(css).toMatch(/max-width: 560px\)[\s\S]*font-size: 16px/)
  })
})
