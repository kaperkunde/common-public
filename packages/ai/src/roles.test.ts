import { describe, expect, it } from "vitest"

import { modelRoles, offeredModels } from "./roles"

const roles = modelRoles({
  writer: [],
  checker: ["haiku", "sonnet"],
  briefer: ["sonnet"],
})
const offered = ["claude-opus-5", "claude-sonnet-5", "claude-haiku-5", "local"]

describe("modelRoles", () => {
  it("knows its roles", () => {
    expect(roles.roles).toEqual(["writer", "checker", "briefer"])
  })

  it("falls to the owner's model for a role with no families", () => {
    expect(
      roles.modelForRole("writer", {
        ownerModel: "claude-opus-5",
        settings: [],
        offered,
      }),
    ).toEqual({ model: "claude-opus-5", fallback: undefined, from: "owner" })
  })

  it("falls to the first offered family, with the next family down as its fallback", () => {
    expect(
      roles.modelForRole("checker", {
        ownerModel: "claude-opus-5",
        settings: [],
        offered,
      }),
    ).toEqual({
      model: "claude-haiku-5",
      fallback: "claude-sonnet-5",
      from: "family",
    })
  })

  it("falls to the owner's model when it is the only fallback left", () => {
    expect(
      roles.modelForRole("briefer", {
        ownerModel: "claude-opus-5",
        settings: [],
        offered,
      }),
    ).toEqual({
      model: "claude-sonnet-5",
      fallback: "claude-opus-5",
      from: "family",
    })
  })

  it("uses the admin's row, and its fallback", () => {
    expect(
      roles.modelForRole("checker", {
        ownerModel: "claude-opus-5",
        settings: [
          { role: "checker", model: "local", fallbackModel: "claude-haiku-5" },
        ],
        offered,
      }),
    ).toEqual({ model: "local", fallback: "claude-haiku-5", from: "admin" })
  })

  it("passes over a row naming a model that is no longer offered", () => {
    expect(
      roles.modelForRole("checker", {
        ownerModel: "claude-opus-5",
        settings: [
          { role: "checker", model: "gone", fallbackModel: "gone-too" },
        ],
        offered,
      }).from,
    ).toBe("family")
  })

  it("says what the admin panel's Default shows", () => {
    expect(roles.roleDefaults("checker", null, offered)).toEqual({
      model: "claude-haiku-5",
      fallback: "claude-sonnet-5",
    })
    expect(roles.roleDefaults("writer", null, offered)).toEqual({
      model: "the owner's model",
      fallback: "none",
    })
    expect(roles.roleDefaults("writer", "local", offered).fallback).toBe(
      "the owner's model",
    )
  })
})

describe("offeredModels", () => {
  it("offers the deployment's priced models and the person's own, as the order allows", () => {
    const args = { deployment: ["a", "b"], priced: ["a"], own: ["c", "a"] }
    expect(offeredModels({ ...args, sequence: ["deployment", "own"] })).toEqual(
      ["a", "c"],
    )
    expect(offeredModels({ ...args, sequence: ["own"] })).toEqual(["c", "a"])
    expect(offeredModels({ ...args, sequence: ["deployment"] })).toEqual(["a"])
  })
  it("offers everything the deployment lists when nothing is priced", () => {
    expect(
      offeredModels({ deployment: ["a", "b"], sequence: ["deployment"] }),
    ).toEqual(["a", "b"])
  })
})
