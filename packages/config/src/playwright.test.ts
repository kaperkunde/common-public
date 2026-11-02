import { describe, expect, it } from "vitest"

import { appPlaywrightConfig, chromiumExecutable } from "./playwright"

describe("chromiumExecutable", () => {
  it("reads the one name, then the old one", () => {
    expect(chromiumExecutable({ PLAYWRIGHT_CHROMIUM_EXECUTABLE: " /a " })).toBe(
      "/a",
    )
    expect(chromiumExecutable({ PW_CHROMIUM_PATH: "/b" })).toBe("/b")
    expect(chromiumExecutable({ PLAYWRIGHT_CHROMIUM_EXECUTABLE: "  " })).toBe(
      undefined,
    )
    expect(chromiumExecutable({})).toBe(undefined)
  })
})

describe("appPlaywrightConfig", () => {
  it("launches a preinstalled Chromium when one is named", () => {
    const config = appPlaywrightConfig(
      {},
      { PLAYWRIGHT_CHROMIUM_EXECUTABLE: "/opt/chromium" },
    )
    expect(config.use?.launchOptions?.executablePath).toBe("/opt/chromium")
  })

  it("lets the app override the base, merging use one level down", () => {
    const config = appPlaywrightConfig(
      { workers: 2, use: { baseURL: "http://localhost:3001" } },
      {},
    )
    expect(config.workers).toBe(2)
    expect(config.use?.baseURL).toBe("http://localhost:3001")
    expect(config.use?.trace).toBe("retain-on-failure")
    expect(config.use?.launchOptions).toBeUndefined()
  })
})
