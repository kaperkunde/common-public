import { existsSync } from "node:fs"

import { describe, expect, it } from "vitest"

import { appVitestConfig, serverOnlyStub } from "./vitest"

describe("appVitestConfig", () => {
  it("points @ at the root and stubs server-only", () => {
    const config = appVitestConfig({ root: "/app" })
    const alias = config.resolve?.alias as Record<string, string>
    expect(alias["@"]).toBe("/app")
    expect(alias["server-only"]).toBe(serverOnlyStub)
    expect(existsSync(serverOnlyStub)).toBe(true)
    expect(config.test?.environment).toBe("node")
  })

  it("takes the app's own include and overrides", () => {
    const config = appVitestConfig({
      root: "/app",
      include: ["lib/**/*.test.ts"],
      overrides: { test: { environment: "jsdom" } },
    })
    expect(config.test?.include).toEqual(["lib/**/*.test.ts"])
    expect(config.test?.environment).toBe("jsdom")
  })
})
