import { describe, expect, it } from "vitest"

import { main } from "./cli-main"
import { makeApp, tempDir } from "./sync/fixture"

const run = (argv: string[]) => {
  const lines: string[] = []
  return { code: main(argv, (l) => lines.push(l)), lines }
}

describe("kk-hasura", () => {
  it("prints usage with no command", () => {
    const { code, lines } = run([])
    expect(code).toBe(0)
    expect(lines.join("\n")).toContain("Usage: kk-hasura sync")
  })

  it("refuses an unknown command or option", () => {
    expect(run(["build"]).code).toBe(2)
    expect(run(["sync", "--nope"]).code).toBe(2)
  })

  it("reports a missing config as an error exit", () => {
    const { code, lines } = run(["sync", "--root", tempDir()])
    expect(code).toBe(1)
    expect(lines.join("\n")).toContain("kaperkunde.json")
  })

  it("exits 1 when a package is not installed", () => {
    const root = tempDir()
    makeApp(root)
    const { code, lines } = run(["sync", "--check", "--root", root])
    expect(code).toBe(1)
    expect(lines.join("\n")).toContain("not installed")
  })
})
