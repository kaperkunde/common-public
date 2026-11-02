import { describe, expect, it } from "vitest"

// @ts-expect-error: a plain .mjs preset without types
import { DEFAULT_IGNORES, nextConfig } from "../eslint.mjs"

type Entry = { ignores?: string[]; rules?: Record<string, unknown> }

describe("nextConfig", () => {
  it("ignores build output and the app's own extras, with its rules last", () => {
    const config = nextConfig({
      ignores: ["sandbox/**"],
      extra: [{ rules: { "no-console": "error" } }],
    }) as Entry[]
    const ignores = config.flatMap((entry) => entry.ignores ?? [])
    expect(ignores).toEqual(
      expect.arrayContaining([...DEFAULT_IGNORES, "sandbox/**"]),
    )
    const withConsole = config.findIndex(
      (entry) => entry.rules?.["no-console"] === "error",
    )
    const withSemi = config.findIndex((entry) => entry.rules?.semi)
    expect(withConsole).toBeGreaterThan(withSemi)
  })
})
