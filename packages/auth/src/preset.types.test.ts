import { betterAuth } from "better-auth"
import { describe, expect, it } from "vitest"

import { mcpAuthPreset } from "./preset"

// Types only: nothing here builds an auth instance.
const _make = () =>
  betterAuth({
    ...mcpAuthPreset({
      urls: {
        issuer: "https://example.com",
        resource: "https://example.com/mcp",
      },
      scopes: ["read"],
    }),
  })
type Api = ReturnType<typeof _make>["api"]

describe("mcpAuthPreset's plugins", () => {
  it("spread into betterAuth without a cast, keeping their endpoints", () => {
    const endpoints: Array<keyof Api> = ["getJwks"]
    expect(endpoints).toHaveLength(1)
  })
})
