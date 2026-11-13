import { describe, expect, it } from "vitest"

import { isConnectionLost } from "./lost"

describe("isConnectionLost", () => {
  it("reads the socket link's own error", () => {
    expect(isConnectionLost(new Error("Socket closed"))).toBe(true)
    expect(isConnectionLost(new Error("Socket closed with event 1006 "))).toBe(
      true,
    )
  })
  it("reads an ApolloError carrying one as its network error", () => {
    expect(
      isConnectionLost({
        message: "",
        networkError: new Error("Socket closed with event 1011 jwt expired"),
      }),
    ).toBe(true)
  })
  it("leaves everything else where it happened", () => {
    expect(isConnectionLost(new Error("Failed to fetch"))).toBe(false)
    expect(isConnectionLost({ message: "x", networkError: null })).toBe(false)
    expect(isConnectionLost(undefined)).toBe(false)
    expect(isConnectionLost(null)).toBe(false)
  })
})
